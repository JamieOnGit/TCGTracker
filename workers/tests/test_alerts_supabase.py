"""Integration: drop event -> dispatcher -> outbox -> SMTP -> Mailpit.

Runs against the local Supabase stack (``supabase start``): the migrated DB
and its Mailpit fake inbox. Skipped unless TEST_SUPABASE_DB_URL is set, e.g.

    TEST_SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \\
      uv run pytest tests/test_alerts_supabase.py

MAILPIT_URL (default http://127.0.0.1:54324) and MAILPIT_SMTP_HOST /
MAILPIT_SMTP_PORT (default 127.0.0.1:54325, which needs ``smtp_port = 54325``
under ``[local_smtp]`` in supabase/config.toml) point at the inbox.
"""

from __future__ import annotations

import os
import time
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.alerts import queue_admin_alert
from tcgworkers.config import Rules
from tcgworkers.drops.dispatcher import run_dispatcher
from tcgworkers.drops.engine import run_cycle
from tcgworkers.drops.models import Availability, Observation
from tcgworkers.drops.store import PostgresDropStore, load_rrp_entries, load_watch_rules
from tcgworkers.email.providers import EmailSendError, OutgoingEmail, SmtpProvider
from tcgworkers.email.sender import PostgresOutboxStore, run_sender, send_due

URL = os.environ.get("TEST_SUPABASE_DB_URL")
MAILPIT = os.environ.get("MAILPIT_URL", "http://127.0.0.1:54324").rstrip("/")
SMTP_HOST = os.environ.get("MAILPIT_SMTP_HOST", "127.0.0.1")
SMTP_PORT = int(os.environ.get("MAILPIT_SMTP_PORT", "54325"))
SITE = "https://tcgtracker.com.au"
UPGRADE = "You're seeing this 5 minutes after Premium members. Upgrade for instant alerts: https://tcgtracker.com.au/premium/"

pytestmark = pytest.mark.skipif(not URL, reason="TEST_SUPABASE_DB_URL not set")


@pytest.fixture
def conn():
    with psycopg.connect(URL, row_factory=dict_row) as c:
        yield c


@pytest.fixture
def members(conn):
    """A Premium and a Free member with unique addresses; removed afterwards."""
    tag = uuid.uuid4().hex[:10]
    users = {
        "premium": (str(uuid.uuid4()), f"prem-{tag}@example.test"),
        "free": (str(uuid.uuid4()), f"free-{tag}@example.test"),
    }
    for tier, (uid, email) in users.items():
        conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
        if tier == "premium":
            conn.execute(
                "update public.profile_private set tier_override = 'premium' where user_id = %s", (uid,)
            )
    conn.commit()
    yield users
    conn.rollback()
    conn.execute("delete from auth.users where id = any(%s::uuid[])", ([u for u, _ in users.values()],))
    conn.commit()


@pytest.fixture
def product(conn):
    retailer = conn.execute("select id::text as id from public.retailers where slug = 'jb-hi-fi'").fetchone()
    sku = f"TEST-{uuid.uuid4().hex[:8]}"
    yield retailer["id"], sku
    conn.rollback()
    conn.execute("delete from public.retail_products where sku = %s", (sku,))
    conn.commit()


def _mailpit_messages(to: str, expect: int, timeout: float = 10.0) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout
    found: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        r = httpx.get(f"{MAILPIT}/api/v1/search", params={"query": f'to:"{to}"'}, timeout=5)
        r.raise_for_status()
        found = r.json().get("messages", [])
        if len(found) >= expect:
            return found
        time.sleep(0.2)
    return found


def _mailpit_full(message_id: str) -> tuple[dict[str, Any], dict[str, list[str]]]:
    msg = httpx.get(f"{MAILPIT}/api/v1/message/{message_id}", timeout=5).json()
    headers = httpx.get(f"{MAILPIT}/api/v1/message/{message_id}/headers", timeout=5).json()
    return msg, headers


def _smtp() -> SmtpProvider:
    return SmtpProvider(SMTP_HOST, SMTP_PORT, starttls=False)


def test_drop_event_reaches_premium_and_free_inboxes(conn, members, product):
    retailer_id, sku = product
    # A monitor cycle through the real store: the product appears in stock.
    store = PostgresDropStore(conn, retailer_id)
    observed = datetime.now(UTC).replace(microsecond=0)
    obs = Observation(
        retailer="jb-hi-fi",
        sku=sku,
        url=f"https://www.jbhifi.com.au/products/{sku.lower()}",
        title="Pokemon TCG: Surging Sparks Elite Trainer Box",
        availability=Availability.IN_STOCK_ONLINE,
        price_aud=Decimal("89.00"),
        observed_at=observed,
    )
    result = run_cycle(
        "jb-hi-fi",
        [obs],
        store,
        rules=Rules(),
        rrp_entries=load_rrp_entries(conn),
        watchlist=load_watch_rules(conn, retailer_id),
        now=observed,
    )
    conn.commit()
    assert {e.event_type.value for e in result.new_events} == {"IN_STOCK"}

    # Re-running the same observation is transition-only: no new events.
    again = run_cycle("jb-hi-fi", [obs], PostgresDropStore(conn, retailer_id), rules=Rules(), now=observed)
    conn.commit()
    assert again.new_events == []

    # Age the events past the Free delay so both tiers are due now.
    conn.execute(
        """update public.drop_events set occurred_at = now() - interval '25 hours'
            where retail_product_id = (select id from public.retail_products where sku = %s)""",
        (sku,),
    )
    conn.execute(
        """update public.drop_alert_deliveries d set deliver_at = e.occurred_at
                + case when d.tier_at_enqueue = 'premium' then interval '0' else interval '1440 minutes' end
             from public.drop_events e
            where e.id = d.drop_event_id and e.retail_product_id = (select id from public.retail_products where sku = %s)""",
        (sku,),
    )
    # Only the IN_STOCK event for our members (keep the inbox check simple).
    conn.execute(
        """update public.drop_alert_deliveries d set status = 'skipped', error = 'test'
             from public.drop_events e
            where e.id = d.drop_event_id and e.event_type <> 'IN_STOCK'
              and e.retail_product_id = (select id from public.retail_products where sku = %s)""",
        (sku,),
    )
    conn.commit()

    dispatched = run_dispatcher(conn, site_url=SITE, discord_webhook_url=None, admin_email=None)
    assert dispatched.emails_queued >= 2

    ids = [u for u, _ in members.values()]
    rows = conn.execute(
        """select d.user_id::text as user_id, d.channel, d.status, d.error from public.drop_alert_deliveries d
             join public.drop_events e on e.id = d.drop_event_id
            where d.user_id = any(%s::uuid[]) and e.event_type = 'IN_STOCK'""",
        (ids,),
    ).fetchall()
    assert {(r["channel"], r["status"]) for r in rows} == {("email", "sent"), ("onsite", "sent")}
    assert len(rows) == 4
    alerted = conn.execute(
        """select alerted_at from public.drop_events e join public.retail_products p on p.id = e.retail_product_id
            where p.sku = %s and e.event_type = 'IN_STOCK'""",
        (sku,),
    ).fetchone()
    assert alerted["alerted_at"] is not None
    bell = conn.execute(
        "select count(*) as n from public.notifications where user_id = any(%s::uuid[]) and type = 'drop'",
        (ids,),
    ).fetchone()
    assert bell["n"] == 2

    sent = run_sender(conn, _smtp(), site_url=SITE, from_override=None, admin_email=None)
    assert sent.sent >= 2 and sent.failed == 0

    for tier, (uid, email) in members.items():
        messages = _mailpit_messages(email, 1)
        assert len(messages) == 1, f"{tier} member got {len(messages)} emails"
        msg, headers = _mailpit_full(messages[0]["ID"])
        assert (
            msg["Subject"] == "IN STOCK: Pokemon TCG: Surging Sparks Elite Trainer Box at JB Hi-Fi — A$89.00"
        )
        assert msg["From"]["Address"] == "alerts@tcgtracker.com.au" and msg["From"]["Name"] == "TCGTracker"
        assert f"https://www.jbhifi.com.au/products/{sku.lower()}" in msg["Text"]
        assert (UPGRADE in msg["Text"]) is (tier == "free")
        token = conn.execute(
            "select token from public.unsubscribe_tokens where user_id = %s and alert_type = 'drop'", (uid,)
        ).fetchone()["token"]
        unsub = f"{SITE}/unsubscribe/?t={token}"
        assert unsub in msg["Text"]
        assert headers["List-Unsubscribe"] == [f"<{unsub}>"]
        assert headers["List-Unsubscribe-Post"] == ["List-Unsubscribe=One-Click"]
        log = conn.execute(
            "select status, provider_message_id from public.email_log where user_id = %s and template = 'drop'",
            (uid,),
        ).fetchall()
        assert [r["status"] for r in log] == ["sent"] and log[0]["provider_message_id"]


def test_outbox_suppression_retry_and_admin_alert_dedupe(conn, members):
    uid, email = members["premium"]
    conn.execute(
        """insert into public.email_outbox (user_id, to_email, template, data, dedupe_key) values
             (%s, %s, 'wishlist', '{"title": "Now listed: Charizard"}', %s),
             (%s, %s, 'message', '{"title": "New message"}', %s)""",
        (uid, email, f"t-wish-{uid}", uid, email, f"t-msg-{uid}"),
    )
    # The member switches wishlist emails off after the alert was queued.
    conn.execute(
        """insert into public.notification_preferences (user_id, alert_type, channel, enabled)
           values (%s, 'wishlist', 'email', false)""",
        (uid,),
    )
    conn.commit()

    class Down:
        name = "down"

        def send(self, email: OutgoingEmail) -> str:
            raise EmailSendError("provider down")

    store = PostgresOutboxStore(conn)
    result = send_due(store, Down(), site_url=SITE)
    assert result.suppressed >= 1 and result.retried >= 1

    rows = {
        r["template"]: r
        for r in conn.execute(
            "select template, status, attempts, send_after > now() as later, last_error from public.email_outbox where user_id = %s",
            (uid,),
        )
    }
    assert rows["wishlist"]["status"] == "suppressed"
    assert (
        rows["message"]["status"] == "queued"
        and rows["message"]["attempts"] == 1
        and rows["message"]["later"]
    )
    assert "provider down" in rows["message"]["last_error"]
    logged = {
        (r["template"], r["status"])
        for r in conn.execute("select template, status from public.email_log where user_id = %s", (uid,))
    }
    assert logged == {("wishlist", "suppressed"), ("message", "failed")}

    # Admin alerts are deduplicated per key within the window.
    key = f"test:{uid}"
    assert queue_admin_alert(conn, "admin@example.test", key=key, title="t", body="b")
    assert not queue_admin_alert(conn, "admin@example.test", key=key, title="t", body="b")
    n = conn.execute(
        "select count(*) as n from public.email_outbox where template = 'admin_alert' and data ->> 'alert_key' = %s",
        (key,),
    ).fetchone()["n"]
    assert n == 1
    conn.execute("delete from public.email_outbox where data ->> 'alert_key' = %s", (key,))
    conn.commit()


def test_first_scan_of_a_retailer_is_a_silent_baseline(conn, members):
    """Switching a retailer on must not alert members about its whole range."""
    from tcgworkers.drops.base import RetailerAdapter
    from tcgworkers.drops.http import PoliteClient
    from tcgworkers.drops.runner import PostgresCycle, RetailerConfig

    slug = f"test-shop-{uuid.uuid4().hex[:6]}"
    rid = conn.execute(
        """insert into public.retailers (slug, name, base_url, adapter, enabled)
           values (%s, 'Test Shop', 'https://shop.example', 'test_shop', false) returning id::text as id""",
        (slug,),
    ).fetchone()["id"]
    conn.commit()
    state = {"availability": Availability.OUT_OF_STOCK}

    class Shop(RetailerAdapter):
        name = "Test Shop"

        def discover(self, client):
            return [
                Observation(
                    slug,
                    "etb-1",
                    "https://shop.example/etb-1",
                    "Pokemon TCG Surging Sparks Elite Trainer Box",
                    state["availability"],
                    Decimal("89.00"),
                    datetime.now(UTC),
                ),
                Observation(
                    slug,
                    "bb-1",
                    "https://shop.example/bb-1",
                    "One Piece Card Game OP-09 Booster Box",
                    Availability.IN_STOCK_ONLINE,
                    Decimal("199.00"),
                    datetime.now(UTC),
                ),
            ]

    Shop.slug = slug
    cfg = RetailerConfig(rid, slug, "Test Shop", "test_shop", 90, 300)
    cycle = PostgresCycle(URL)
    ids = [u for u, _ in members.values()]
    deliveries = lambda: conn.execute(  # noqa: E731
        """select count(*) as n from public.drop_alert_deliveries d join public.drop_events e on e.id = d.drop_event_id
             join public.retail_products p on p.id = e.retail_product_id
            where p.retailer_id = %s and d.user_id = any(%s::uuid[])""",
        (rid, ids),
    ).fetchone()["n"]
    try:
        first = cycle(cfg, "discovery", Shop(), PoliteClient(user_agent="test"))
        assert first.error is None and len(first.new_events) == 2  # one event per new product
        events = conn.execute(
            """select suppressed, suppressed_reason from public.drop_events e
                 join public.retail_products p on p.id = e.retail_product_id where p.retailer_id = %s""",
            (rid,),
        ).fetchall()
        assert all(e["suppressed"] and e["suppressed_reason"].startswith("baseline") for e in events)
        assert deliveries() == 0

        state["availability"] = Availability.IN_STOCK_ONLINE  # a real restock on the next cycle
        second = cycle(cfg, "discovery", Shop(), PoliteClient(user_agent="test"))
        assert [e.event_type.value for e in second.new_events] == ["IN_STOCK"]
        assert deliveries() > 0
    finally:
        conn.rollback()
        conn.execute("delete from public.retailers where id = %s", (rid,))
        conn.commit()
