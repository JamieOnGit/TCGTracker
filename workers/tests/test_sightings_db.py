"""Member sightings through the real alert pipeline, against a migrated
database (supabase/tests/run.sh leaves one behind). Skipped unless
TEST_DATABASE_URL is set; CI sets it.

A confirmed sighting becomes a drop_event with no retail product; the
dispatcher must still claim and render its deliveries."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.config import Env
from tcgworkers.drops.dispatcher import PUSH_NOT_CONFIGURED, run_dispatcher
from tcgworkers.jobs.registry import expire_sightings, send_release_reminders

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

Conn = psycopg.Connection[dict[str, Any]]
SUPABASE = "https://ref.supabase.co"
ENV = Env.from_environ({})


@pytest.fixture
def conn() -> Iterator[Conn]:
    assert URL
    with psycopg.connect(URL, row_factory=dict_row) as c:
        yield c


@pytest.fixture
def members(conn: Conn) -> Iterator[dict[str, str]]:
    """A reporter (Free) and a Premium member with a push subscription."""
    users = {"reporter": str(uuid.uuid4()), "premium": str(uuid.uuid4())}
    for uid in users.values():
        conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, f"{uid[:8]}@example.test"))
    conn.execute(
        "update public.profile_private set tier_override = 'premium' where user_id = %s", (users["premium"],)
    )
    # This member wants every drop (new members start on "only what I follow").
    conn.execute(
        "update public.drop_alert_filters set mode = 'everything' where user_id = %s", (users["premium"],)
    )
    conn.execute(
        """insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
           values (%s, %s, 'p256dh', 'auth')""",
        (users["premium"], f"https://fcm.googleapis.com/fcm/send/{users['premium']}"),
    )
    conn.commit()
    yield users
    conn.rollback()
    conn.execute("delete from auth.users where id = any(%s::uuid[])", (list(users.values()),))
    conn.commit()


def _sighting(conn: Conn, user: str, **extra: Any) -> int:
    row = conn.execute(
        """insert into public.sightings (user_id, retailer_id, channel, state, suburb, store_name, game, product,
                                         price_aud, quantity, purchase_limit, photo_path, note, created_at)
           select %(user)s, id, 'in_store', 'VIC', 'Chadstone', 'Chadstone Shopping Centre', 'pokemon',
                  'Pokémon booster bundles', 45, 'some', 2, %(photo)s, 'Behind the service desk',
                  coalesce(%(created)s, now())
             from public.retailers where slug = 'kmart'
           returning id""",
        {"user": user, "photo": f"{user}/shelf.jpg", "created": extra.get("created_at")},
    ).fetchone()
    assert row
    return int(row["id"])


def test_confirmed_sighting_is_claimed_and_rendered(conn: Conn, members: dict[str, str]) -> None:
    sighting = _sighting(conn, members["reporter"])
    conn.execute("select public.confirm_sighting(%s, null)", (sighting,))
    conn.commit()
    event = conn.execute("select id from public.drop_events where sighting_id = %s", (sighting,)).fetchone()
    assert event
    premium = members["premium"]
    queued = {
        r["channel"]
        for r in conn.execute(
            "select channel from public.drop_alert_deliveries where drop_event_id = %s and user_id = %s",
            (event["id"], premium),
        )
    }
    assert {"email", "onsite", "push"} <= queued

    run_dispatcher(
        conn,
        site_url="https://tcgtracker.com.au",
        discord_webhook_url=None,
        admin_email=None,
        push_sender=None,
        supabase_url=SUPABASE,
    )

    status = {
        r["channel"]: (r["status"], r["error"])
        for r in conn.execute(
            "select channel, status, error from public.drop_alert_deliveries where drop_event_id = %s and user_id = %s",
            (event["id"], premium),
        )
    }
    assert status["onsite"] == ("sent", None) and status["email"] == ("sent", None)
    assert status["push"] == ("skipped", PUSH_NOT_CONFIGURED)

    note = conn.execute(
        "select title, body, url, data from public.notifications where user_id = %s and type = 'drop'",
        (premium,),
    ).fetchone()
    assert note
    kmart = conn.execute("select name from public.retailers where slug = 'kmart'").fetchone()
    assert kmart
    place = f"{kmart['name']} Chadstone, VIC"  # the registry migration renamed it "Kmart Australia"
    assert note["title"] == f"In store: Pokémon booster bundles at {place}"
    assert note["body"].startswith("A$45.00") and "Limit 2 per customer" in note["body"]
    assert note["url"] == "/drops/vic/" and note["data"]["sighting_id"] == sighting

    email = conn.execute(
        "select data from public.email_outbox where user_id = %s and template = 'drop'", (premium,)
    ).fetchone()
    assert email
    data = email["data"]
    assert data["source"] == "member" and data["place"] == place
    assert (
        data["photo_url"]
        == f"{SUPABASE}/storage/v1/object/public/sighting-photos/{members['reporter']}/shelf.jpg"
    )
    assert data["purchase_limit"] == 2 and data["quantity"] == "some"
    alerted = conn.execute(
        "select alerted_at from public.drop_events where id = %s", (event["id"],)
    ).fetchone()
    assert alerted and alerted["alerted_at"] is not None


def test_expire_sightings_job(conn: Conn, members: dict[str, str]) -> None:
    from datetime import UTC, datetime

    old = _sighting(conn, members["reporter"], created_at=datetime.now(UTC) - timedelta(hours=7))
    conn.commit()
    assert expire_sightings(conn, ENV) >= 1
    row = conn.execute("select status from public.sightings where id = %s", (old,)).fetchone()
    assert row and row["status"] == "expired"


def test_release_reminders_job(conn: Conn, members: dict[str, str]) -> None:
    user = members["premium"]
    slug = f"test-{uuid.uuid4().hex[:8]}"
    tomorrow = (
        conn.execute("select (now() at time zone 'Australia/Sydney')::date + 1 as d").fetchone() or {}
    ).get("d")
    assert isinstance(tomorrow, date)
    rel = conn.execute(
        """insert into public.release_events (game, lang, slug, title, release_date)
           values ('pokemon', 'en', %s, 'Test Release', %s) returning id""",
        (slug, tomorrow),
    ).fetchone()
    assert rel
    conn.execute(
        "insert into public.release_reminders (user_id, release_event_id) values (%s, %s)", (user, rel["id"])
    )
    conn.commit()
    try:
        send_release_reminders(conn, ENV)
        email = conn.execute(
            "select template, data from public.email_outbox where user_id = %s and template = 'release'",
            (user,),
        ).fetchone()
        assert email and email["data"]["title"] == "Test Release is out tomorrow"
        run = conn.execute(
            "select status from public.pipeline_runs where job = 'release_reminders' order by id desc limit 1"
        ).fetchone()
        assert run and run["status"] == "succeeded"
    finally:
        conn.rollback()
        conn.execute("delete from public.release_events where slug = %s", (slug,))
        conn.commit()
