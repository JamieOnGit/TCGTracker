from __future__ import annotations

from collections.abc import Iterable
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest

from tcgworkers.drops import dispatcher as dispatcher_mod
from tcgworkers.drops.dispatcher import (
    MAX_DELIVERY_ATTEMPTS,
    PUSH_NOT_CONFIGURED,
    Delivery,
    EventInfo,
    Recipient,
    discord_payload,
    dispatch_due,
    email_data,
    notification,
    push_message,
    sighting_photo_url,
)
from tcgworkers.drops.push import PushGone, PushSubscription
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
    subs: dict[str, list[PushSubscription]] = field(default_factory=dict)
    push_ok: dict[int, int] = field(default_factory=dict)
    push_failures: dict[int, int] = field(default_factory=dict)
    deleted_subs: list[int] = field(default_factory=list)

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

    def push_subscriptions(self, user_ids: list[str]) -> dict[str, list[PushSubscription]]:
        return {u: list(self.subs[u]) for u in user_ids if u in self.subs}

    def push_result(self, subscription: PushSubscription, ok: bool) -> None:
        target = self.push_ok if ok else self.push_failures
        target[subscription.id] = target.get(subscription.id, 0) + 1

    def delete_push_subscription(self, subscription: PushSubscription) -> None:
        self.deleted_subs.append(subscription.id)
        self.subs[subscription.user_id] = [s for s in self.subs[subscription.user_id] if s != subscription]

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


def test_premium_and_free_email_tier_text() -> None:
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


def test_email_data_carries_everything_the_template_needs() -> None:
    data = email_data(EVENT, "premium")
    assert (
        data["price_aud"] == "89.00" and data["retailer"] == "JB Hi-Fi" and data["event_type"] == "IN_STOCK"
    )
    assert data["rrp_tag"] == "ABOVE_RRP" and data["rrp_delta_pct"] == "12.5"


def test_onsite_notification_rows_and_tier_text() -> None:
    store = _store(Delivery(1, "prem", "onsite", 10), Delivery(2, "free", "onsite", 10))
    dispatch_due(store, now=NOW)
    notes = {d.user_id: (title, body, url) for d, title, body, url, _ in store.notes}
    assert notes["prem"][0] == "IN STOCK: Pokémon TCG: Surging Sparks Elite Trainer Box"
    assert notes["prem"][1] == "JB Hi-Fi · A$89.00 · ABOVE RRP (+12.5%)"
    assert "24 hours after Premium" in notes["free"][1] and "24 hours" not in notes["prem"][1]
    assert notes["prem"][2] == "/drops/"
    assert notification(EVENT, "free", "https://tcgtrade.com.au")[3]["tier"] == "free"


def test_discord_posts_once_per_event_for_premium_members_only() -> None:
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


def test_discord_payload_shape() -> None:
    p = discord_payload(EVENT)
    assert p["content"].startswith("**IN STOCK**")
    assert p["embeds"][0]["url"] == EVENT.url
    assert {"name": "Price", "value": "A$89.00", "inline": True} in p["embeds"][0]["fields"]
    assert p["allowed_mentions"] == {"parse": []}


def test_discord_without_webhook_is_skipped_with_reason() -> None:
    store = _store(Delivery(1, "prem", "discord", 10))
    dispatch_due(store, discord_webhook_url=None, now=NOW)
    assert store.status[1] == ("skipped", "DISCORD_DROPS_WEBHOOK_URL is not set")


def test_discord_failure_retries_with_backoff_then_fails_and_alerts() -> None:
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


def test_preference_turned_off_after_enqueue_skips() -> None:
    store = _store(Delivery(1, "prem", "email", 10))
    store.people["prem"] = Recipient("prem", "premium", "p@example.com", wants={"email": False})
    dispatch_due(store, now=NOW)
    assert store.status[1][0] == "skipped" and not store.emails


def test_suspended_member_and_missing_email_are_skipped() -> None:
    store = _store(Delivery(1, "prem", "email", 10), Delivery(2, "free", "email", 10))
    store.people["prem"] = Recipient("prem", "premium", "p@example.com", active=False)
    store.people["free"] = Recipient("free", "free", None)
    dispatch_due(store, now=NOW)
    assert store.status[1] == ("skipped", "member account is not active")
    assert store.status[2] == ("skipped", "member has no email address")


def test_suppressed_or_missing_event_is_skipped() -> None:
    store = _store(Delivery(1, "prem", "email", 10), Delivery(2, "prem", "email", 99))
    store.event_map[10] = EventInfo(**{**EVENT.__dict__, "suppressed": True})
    dispatch_due(store, now=NOW)
    assert store.status[1] == ("skipped", "event suppressed")
    assert store.status[2] == ("skipped", "drop event no longer exists")
    assert not store.alerted


def test_one_broken_event_does_not_block_others() -> None:
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


def test_nothing_due_commits_and_returns() -> None:
    store = _store()
    assert dispatch_due(store, now=NOW).claimed == 0 and store.commits == 1


# ------------------------------------------------------------ member sightings
PHOTO = "https://ref.supabase.co/storage/v1/object/public/sighting-photos/u1/shelf%20photo.jpg"
SIGHTING = EventInfo(
    id=20,
    event_type="IN_STOCK",
    product_title="Pokémon booster bundles",
    retailer="Kmart",
    retailer_slug="kmart",
    url=None,
    price_aud=Decimal("45.00"),
    occurred_at=NOW,
    rrp_aud=Decimal("45.00"),
    rrp_tag="AT_RRP",
    rrp_delta_pct=Decimal("0"),
    game="pokemon",
    source="member",
    sighting_id=7,
    channel="in_store",
    state="VIC",
    suburb="Chadstone",
    store_name="Chadstone Shopping Centre",
    quantity="some",
    purchase_limit=2,
    photo_url=PHOTO,
    note="Behind the service desk",
    confirm_count=3,
)
ONLINE = EventInfo(
    **{
        **SIGHTING.__dict__,
        "id": 21,
        "channel": "online",
        "state": None,
        "suburb": None,
        "store_name": None,
        "url": "https://www.kmart.com.au/product/bundle/",
        "photo_url": None,
        "note": None,
        "confirm_count": 1,
    }
)


def test_photo_url_is_the_public_storage_url() -> None:
    assert sighting_photo_url("https://ref.supabase.co/", "u1/shelf photo.jpg") == PHOTO
    assert sighting_photo_url(None, "u1/p.jpg") is None and sighting_photo_url("https://x", None) is None


def test_sighting_email_data_and_render() -> None:
    data = email_data(SIGHTING, "premium")
    assert data["source"] == "member" and data["place"] == "Kmart Chadstone, VIC"
    assert data["title"] == "In store: Pokémon booster bundles at Kmart Chadstone, VIC"
    assert data["photo_url"] == PHOTO and data["drops_path"] == "/drops/vic/" and data["url"] is None
    r = render("drop", data, RenderContext(unsubscribe_token="t"))
    assert r.subject == "In store: Pokémon booster bundles at Kmart Chadstone, VIC — A$45.00"
    assert "Confirmed by 3 members." in r.text and PHOTO in r.text
    assert "Purchase limit: Limit 2 per customer" in r.text and "Stock: Some in stock" in r.text
    assert "24 hours after Premium" not in r.text
    assert UPGRADE in render("drop", email_data(SIGHTING, "free"), RenderContext()).text
    assert email_data(EVENT, "premium")["source"] == "monitor" and "place" not in email_data(EVENT, "premium")


def test_sighting_onsite_notification() -> None:
    title, body, url, data = notification(SIGHTING, "premium", "https://tcgtrade.com.au")
    assert title == "In store: Pokémon booster bundles at Kmart Chadstone, VIC"
    assert body == "A$45.00 · AT RRP · Some in stock · Limit 2 per customer · Confirmed by 3 members"
    assert url == "/drops/vic/" and data["source"] == "member" and data["sighting_id"] == 7
    title, body, url, _ = notification(ONLINE, "free", "https://tcgtrade.com.au")
    assert title == "Online: Pokémon booster bundles at Kmart"
    assert url == "/drops/kmart/" and "24 hours after Premium" in body
    # Monitors keep their format.
    assert notification(EVENT, "premium", "https://tcgtrade.com.au")[2] == "/drops/"


def test_sighting_discord_card() -> None:
    p = discord_payload(SIGHTING, "https://tcgtrade.com.au")
    embed = p["embeds"][0]
    fields = {f["name"]: f["value"] for f in embed["fields"]}
    assert p["content"] == "**IN STORE** Pokémon booster bundles — Kmart Chadstone, VIC"
    assert embed["title"] == "In store: Pokémon booster bundles at Kmart Chadstone, VIC"
    assert embed["url"] == "https://tcgtrade.com.au/drops/vic/"
    assert embed["image"] == {"url": PHOTO}
    assert embed["description"] == "“Behind the service desk”"
    assert embed["color"] == 0x3DDC97
    assert fields["Price"] == "A$45.00" and fields["RRP"] == "A$45.00 · AT RRP"
    assert fields["Store"] == "Chadstone Shopping Centre (Kmart Chadstone, VIC)"
    assert fields["Stock"] == "Some in stock" and fields["Limit"] == "Limit 2 per customer"
    assert fields["Source"] == "Member sighting · confirmed by 3 members"
    assert fields["Seen"] == f"<t:{int(NOW.timestamp())}:R>"
    assert p["allowed_mentions"] == {"parse": []}

    online = discord_payload(ONLINE)["embeds"][0]
    assert online["url"] == "https://www.kmart.com.au/product/bundle/" and "image" not in online

    monitor = discord_payload(EVENT)
    mfields = {f["name"]: f["value"] for f in monitor["embeds"][0]["fields"]}
    assert mfields["Source"] == "Retailer monitor" and "Store" not in mfields
    assert monitor["embeds"][0]["title"] == EVENT.product_title
    assert (
        discord_payload(EVENT.__class__(**{**EVENT.__dict__, "event_type": "PRICE_CHANGE"}))["embeds"][0][
            "color"
        ]
        == 0xFFB84D
    )


def test_sighting_dispatch_end_to_end_with_fakes() -> None:
    posts: list[dict[str, Any]] = []
    store = FakeDispatchStore(
        queue=[
            Delivery(1, "prem", "email", 20),
            Delivery(2, "prem", "onsite", 20),
            Delivery(3, "prem", "discord", 20),
        ],
        event_map={20: SIGHTING},
        people={"prem": Recipient("prem", "premium", "p@example.com")},
    )
    result = dispatch_due(
        store, discord_webhook_url="https://discord.test/hook", poster=lambda u, p: posts.append(p), now=NOW
    )
    assert result.sent == 3 and store.alerted == {20}
    assert store.emails[0][2]["source"] == "member"
    assert store.notes[0][3] == "/drops/vic/"
    assert posts[0]["embeds"][0]["image"] == {"url": PHOTO}


# ------------------------------------------------------------------- web push
def _sub(i: int, user: str = "prem") -> PushSubscription:
    return PushSubscription(i, user, f"https://push.example/{i}", "p256dh", "auth")


def _push_store(*deliveries: Delivery) -> FakeDispatchStore:
    store = _store(*deliveries)
    store.event_map[SIGHTING.id] = SIGHTING
    return store


def test_push_is_sent_to_every_device_with_the_payload() -> None:
    sent: list[tuple[int, dict[str, Any]]] = []
    store = _push_store(Delivery(1, "prem", "push", 20), Delivery(2, "free", "push", 20))
    store.subs = {"prem": [_sub(1), _sub(2)], "free": [_sub(3, "free")]}
    result = dispatch_due(store, push_sender=lambda s, p: sent.append((s.id, p)), now=NOW)
    assert result.sent == 2 and result.pushes == 2
    assert [i for i, _ in sent] == [1, 2, 3]
    payload = dict(sent[0][1])
    assert payload == {
        "title": "In store: Pokémon booster bundles at Kmart Chadstone, VIC",
        "body": "A$45.00 · AT RRP · Some in stock · Limit 2 per customer · Confirmed by 3 members · Member sighting",
        "url": "/drops/vic/",
        "tag": "drop-20",
    }
    assert "Premium members got this 24 hours earlier" in sent[2][1]["body"]
    assert store.push_ok == {1: 1, 2: 1, 3: 1} and store.alerted == {20}


def test_push_monitor_payload() -> None:
    p = push_message(EVENT, "premium")
    assert p["title"] == "IN STOCK: Pokémon TCG: Surging Sparks Elite Trainer Box"
    assert p["body"] == "JB Hi-Fi · A$89.00 · ABOVE RRP (+12.5%)" and p["url"] == "/drops/"


def test_push_410_prunes_the_subscription() -> None:
    def sender(sub: PushSubscription, payload: dict[str, Any]) -> None:
        if sub.id == 1:
            raise PushGone("push HTTP 410")

    store = _push_store(Delivery(1, "prem", "push", 20))
    store.subs = {"prem": [_sub(1), _sub(2)]}
    dispatch_due(store, push_sender=sender, now=NOW)
    assert store.deleted_subs == [1] and store.status[1] == ("sent", None)

    # Every device gone: nothing to retry.
    store.queue.append(Delivery(2, "prem", "push", 20))
    store.subs = {"prem": [_sub(3)]}
    dispatch_due(store, push_sender=lambda s, p: (_ for _ in ()).throw(PushGone("404")), now=NOW)
    assert store.deleted_subs == [1, 3]
    assert store.status[2] == ("skipped", "member has no push subscriptions")


def test_push_error_retries_with_backoff_then_fails() -> None:
    def boom(sub: PushSubscription, payload: dict[str, Any]) -> None:
        raise RuntimeError("push HTTP 500")

    store = _push_store(Delivery(1, "prem", "push", 20))
    store.subs = {"prem": [_sub(1)]}
    result = dispatch_due(store, push_sender=boom, now=NOW)
    assert result.retried == 1 and store.status[1][0] == "queued"
    assert "push HTTP 500" in (store.status[1][1] or "")
    assert (store.retries[1] - NOW).total_seconds() == 30
    assert store.push_failures == {1: 1} and not store.deleted_subs and not store.alerted

    store.queue.append(Delivery(1, "prem", "push", 20, attempts=MAX_DELIVERY_ATTEMPTS - 1))
    result = dispatch_due(store, push_sender=boom, now=NOW)
    assert result.failed == 1 and store.alerts == ["drop-delivery-failed:push"]


def test_push_partly_delivered_counts_as_sent() -> None:
    def sender(sub: PushSubscription, payload: dict[str, Any]) -> None:
        if sub.id == 1:
            raise RuntimeError("push HTTP 503")

    store = _push_store(Delivery(1, "prem", "push", 20))
    store.subs = {"prem": [_sub(1), _sub(2)]}
    dispatch_due(store, push_sender=sender, now=NOW)
    assert store.status[1] == ("sent", None)
    assert store.push_failures == {1: 1} and store.push_ok == {2: 1}


def test_push_not_configured_is_skipped_and_logged_once(caplog: pytest.LogCaptureFixture) -> None:
    dispatcher_mod._push_warned = False
    store = _push_store(Delivery(1, "prem", "push", 20), Delivery(2, "free", "push", 20))
    with caplog.at_level("WARNING"):
        dispatch_due(store, push_sender=None, now=NOW)
        store.queue.append(Delivery(3, "prem", "push", 20))
        dispatch_due(store, push_sender=None, now=NOW)
    assert store.status[1] == store.status[2] == store.status[3] == ("skipped", PUSH_NOT_CONFIGURED)
    assert sum("VAPID" in r.message for r in caplog.records) == 1
    assert not store.retries


def test_push_turned_off_by_member_is_skipped() -> None:
    store = _push_store(Delivery(1, "prem", "push", 20))
    store.people["prem"] = Recipient("prem", "premium", "p@example.com", wants={"push": False})
    dispatch_due(store, push_sender=lambda s, p: None, now=NOW)
    assert store.status[1] == ("skipped", "member turned off drop alerts by push")
