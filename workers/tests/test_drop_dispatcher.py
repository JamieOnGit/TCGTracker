from __future__ import annotations

from collections.abc import Iterable
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from tcgworkers.drops.dispatcher import (
    MAX_DELIVERY_ATTEMPTS,
    Delivery,
    EventInfo,
    Recipient,
    discord_payload,
    dispatch_due,
    email_data,
    notification,
)
from tcgworkers.email.templates import RenderContext, render

NOW = datetime(2026, 9, 28, 1, 0, tzinfo=UTC)
UPGRADE = "You're seeing this 24 hours after Premium members. Upgrade for instant alerts: https://tcgtrade.com.au/premium/"

EVENT = EventInfo(
    id=10,
    event_type="IN_STOCK",
    product_title="Pokémon TCG: Surging Sparks Elite Trainer Box",
    retailer="JB Hi-Fi",
    retailer_slug="jb-hi-fi",
    url="https://www.jbhifi.com.au/products/surging-sparks-etb",
    price_aud=Decimal("89.00"),
    occurred_at=NOW,
    rrp_aud=Decimal("79.11"),
    rrp_tag="ABOVE_RRP",
    rrp_delta_pct=Decimal("12.5"),
    game="pokemon",
)


@dataclass
class FakeDispatchStore:
    queue: list[Delivery] = field(default_factory=list)
    event_map: dict[int, EventInfo] = field(default_factory=dict)
    people: dict[str, Recipient] = field(default_factory=dict)
    emails: list[tuple[Delivery, str, dict[str, Any]]] = field(default_factory=list)
    notes: list[tuple[Delivery, str, str, str, dict[str, Any]]] = field(default_factory=list)
    status: dict[int, tuple[str, str | None]] = field(default_factory=dict)
    retries: dict[int, datetime] = field(default_factory=dict)
    posted: list[int] = field(default_factory=list)
    alerted: set[int] = field(default_factory=set)
    alerts: list[str] = field(default_factory=list)
    commits: int = 0

    def claim(self, limit: int) -> list[Delivery]:
        out, self.queue = self.queue[:limit], self.queue[limit:]
        return out

    def events(self, ids: list[int]) -> dict[int, EventInfo]:
        return {i: self.event_map[i] for i in ids if i in self.event_map}

    def recipients(self, user_ids: list[str]) -> dict[str, Recipient]:
        return {u: self.people[u] for u in user_ids if u in self.people}

    def enqueue_emails(self, rows: list[tuple[Delivery, str, dict[str, Any]]]) -> None:
        self.emails.extend(rows)

    def add_notifications(self, rows: list[tuple[Delivery, str, str, str, dict[str, Any]]]) -> None:
        self.notes.extend(rows)

    def mark(self, deliveries: list[Delivery], status: str, error: str | None = None) -> None:
        for d in deliveries:
            self.status[d.id] = (status, error)

    def mark_retry(self, delivery: Delivery, error: str, deliver_at: datetime) -> None:
        self.retries[delivery.id] = deliver_at
        self.status[delivery.id] = ("queued", error)

    def mark_discord_posted(self, event_id: int) -> None:
        self.event_map[event_id] = EventInfo(**{**self.event_map[event_id].__dict__, "discord_posted": True})

    def mark_alerted(self, event_ids: Iterable[int]) -> None:
        self.alerted.update(event_ids)

    def admin_alert(self, key: str, title: str, body: str, details: dict[str, Any]) -> None:
        self.alerts.append(key)

    def commit(self) -> None:
        self.commits += 1

    def event_scope(self) -> AbstractContextManager[object]:
        return nullcontext()


def _store(*deliveries: Delivery, tiers: dict[str, str] | None = None) -> FakeDispatchStore:
    tiers = tiers or {"prem": "premium", "free": "free"}
    return FakeDispatchStore(
        queue=list(deliveries),
        event_map={EVENT.id: EVENT},
        people={u: Recipient(u, t, f"{u}@example.com") for u, t in tiers.items()},
    )


def test_premium_and_free_email_tier_text():
    store = _store(Delivery(1, "prem", "email", 10), Delivery(2, "free", "email", 10))
    result = dispatch_due(store, now=NOW)
    assert result.sent == 2 and result.emails_queued == 2
    by_user = {d.user_id: (to, data) for d, to, data in store.emails}
    assert by_user["prem"][1]["tier"] == "premium" and by_user["free"][1]["tier"] == "free"
    ctx = RenderContext(unsubscribe_token="t")
    premium_email = render("drop", by_user["prem"][1], ctx)
    free_email = render("drop", by_user["free"][1], ctx)
    assert UPGRADE not in premium_email.text
    assert UPGRADE in free_email.text
    for email in (premium_email, free_email):
        assert (
            email.subject == "IN STOCK: Pokémon TCG: Surging Sparks Elite Trainer Box at JB Hi-Fi — A$89.00"
        )
        assert "[ABOVE RRP (+12.5%)]" in email.text
        assert "https://www.jbhifi.com.au/products/surging-sparks-etb" in email.text
    assert store.alerted == {10} and store.commits == 1


def test_email_data_carries_everything_the_template_needs():
    data = email_data(EVENT, "premium")
    assert (
        data["price_aud"] == "89.00" and data["retailer"] == "JB Hi-Fi" and data["event_type"] == "IN_STOCK"
    )
    assert data["rrp_tag"] == "ABOVE_RRP" and data["rrp_delta_pct"] == "12.5"


def test_onsite_notification_rows_and_tier_text():
    store = _store(Delivery(1, "prem", "onsite", 10), Delivery(2, "free", "onsite", 10))
    dispatch_due(store, now=NOW)
    notes = {d.user_id: (title, body, url) for d, title, body, url, _ in store.notes}
    assert notes["prem"][0] == "IN STOCK: Pokémon TCG: Surging Sparks Elite Trainer Box"
    assert notes["prem"][1] == "JB Hi-Fi · A$89.00 · ABOVE RRP (+12.5%)"
    assert "24 hours after Premium" in notes["free"][1] and "24 hours" not in notes["prem"][1]
    assert notes["prem"][2] == "/drops/"
    assert notification(EVENT, "free", "https://tcgtrade.com.au")[3]["tier"] == "free"


def test_discord_posts_once_per_event_for_premium_members_only():
    posts: list[tuple[str, dict[str, Any]]] = []
    store = _store(
        Delivery(1, "prem", "discord", 10),
        Delivery(2, "prem2", "discord", 10),
        Delivery(3, "free", "discord", 10),
        tiers={"prem": "premium", "prem2": "premium", "free": "free"},
    )
    result = dispatch_due(
        store,
        discord_webhook_url="https://discord.test/hook",
        poster=lambda u, p: posts.append((u, p)),
        now=NOW,
    )
    assert len(posts) == 1 and result.discord_posts == 1
    assert store.status[1][0] == store.status[2][0] == "sent"
    assert store.status[3] == ("skipped", "the Discord drops channel is Premium-only")

    # A later delivery for the same event doesn't post again.
    store.queue.append(Delivery(4, "prem", "discord", 10))
    dispatch_due(
        store,
        discord_webhook_url="https://discord.test/hook",
        poster=lambda u, p: posts.append((u, p)),
        now=NOW,
    )
    assert len(posts) == 1 and store.status[4][0] == "sent"


def test_discord_payload_shape():
    p = discord_payload(EVENT)
    assert p["content"].startswith("**IN STOCK**")
    assert p["embeds"][0]["url"] == EVENT.url
    assert {"name": "Price", "value": "A$89.00", "inline": True} in p["embeds"][0]["fields"]
    assert p["allowed_mentions"] == {"parse": []}


def test_discord_without_webhook_is_skipped_with_reason():
    store = _store(Delivery(1, "prem", "discord", 10))
    dispatch_due(store, discord_webhook_url=None, now=NOW)
    assert store.status[1] == ("skipped", "DISCORD_DROPS_WEBHOOK_URL is not set")


def test_discord_failure_retries_with_backoff_then_fails_and_alerts():
    def boom(url: str, payload: dict[str, Any]) -> None:
        raise RuntimeError("discord 502")

    store = _store(Delivery(1, "prem", "discord", 10, attempts=0))
    result = dispatch_due(store, discord_webhook_url="https://discord.test/hook", poster=boom, now=NOW)
    assert result.retried == 1 and store.status[1][0] == "queued"
    assert (store.retries[1] - NOW).total_seconds() == 30
    assert not store.alerted  # nothing delivered yet

    store.queue.append(Delivery(1, "prem", "discord", 10, attempts=MAX_DELIVERY_ATTEMPTS - 1))
    result = dispatch_due(store, discord_webhook_url="https://discord.test/hook", poster=boom, now=NOW)
    assert result.failed == 1 and store.status[1][0] == "failed"
    assert store.alerts == ["drop-delivery-failed:discord"]


def test_preference_turned_off_after_enqueue_skips():
    store = _store(Delivery(1, "prem", "email", 10))
    store.people["prem"] = Recipient("prem", "premium", "p@example.com", wants={"email": False})
    dispatch_due(store, now=NOW)
    assert store.status[1][0] == "skipped" and not store.emails


def test_suspended_member_and_missing_email_are_skipped():
    store = _store(Delivery(1, "prem", "email", 10), Delivery(2, "free", "email", 10))
    store.people["prem"] = Recipient("prem", "premium", "p@example.com", active=False)
    store.people["free"] = Recipient("free", "free", None)
    dispatch_due(store, now=NOW)
    assert store.status[1] == ("skipped", "member account is not active")
    assert store.status[2] == ("skipped", "member has no email address")


def test_suppressed_or_missing_event_is_skipped():
    store = _store(Delivery(1, "prem", "email", 10), Delivery(2, "prem", "email", 99))
    store.event_map[10] = EventInfo(**{**EVENT.__dict__, "suppressed": True})
    dispatch_due(store, now=NOW)
    assert store.status[1] == ("skipped", "event suppressed")
    assert store.status[2] == ("skipped", "drop event no longer exists")
    assert not store.alerted


def test_one_broken_event_does_not_block_others():
    other = EventInfo(**{**EVENT.__dict__, "id": 11})

    class Flaky(FakeDispatchStore):
        def enqueue_emails(self, rows: list[tuple[Delivery, str, dict[str, Any]]]) -> None:
            if any(d.drop_event_id == 10 for d, _, _ in rows):
                raise RuntimeError("bad row")
            super().enqueue_emails(rows)

    store = Flaky(
        queue=[Delivery(1, "prem", "email", 10), Delivery(2, "prem", "email", 11)],
        event_map={10: EVENT, 11: other},
        people={"prem": Recipient("prem", "premium", "p@example.com")},
    )
    result = dispatch_due(store, now=NOW)
    assert store.status[1][0] == "queued" and store.status[2][0] == "sent"
    assert result.retried == 1 and result.sent == 1 and store.alerted == {11}


def test_nothing_due_commits_and_returns():
    store = _store()
    assert dispatch_due(store, now=NOW).claimed == 0 and store.commits == 1
