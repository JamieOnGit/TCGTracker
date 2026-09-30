"""Drop-alert dispatcher (runs every 15s).

``public.claim_due_drop_alerts()`` returns the deliveries that are due, with
the tier rule re-applied (a member who is no longer Premium is pushed back to
the Free schedule), and locks them for this transaction. They are grouped per
drop event, so each event's content is built once, then:

* ``email``   -> an ``email_outbox`` row (template ``drop``, dedupe
  ``drop:<delivery id>``); the outbox sender delivers it with retries.
  Free members' emails carry the "24 hours after Premium" upgrade line.
* ``onsite``  -> a ``notifications`` row (the bell).
* ``discord`` -> one post per event to the Premium channel webhook
  (DISCORD_DROPS_WEBHOOK_URL). Free members' Discord deliveries are skipped:
  that channel is Premium-only.
* ``push``    -> a web push to each of the member's browsers / phones
  (``drops.push``; VAPID_PRIVATE_KEY + VAPID_SUBJECT). Free members get push
  too, on the Free schedule.

Events come from a retailer monitor (``retail_product_id``) or a confirmed
member sighting (``sighting_id``, no retail product): sightings carry the
store's location, quantity, purchase limit, photo and how many members
confirmed them, and every channel says it is a member report.

Each delivery ends ``sent``, ``skipped`` (with the reason), or stays
``queued`` with exponential back-off after a failure; after
``MAX_DELIVERY_ATTEMPTS`` it is ``failed`` and an admin alert is queued.
``drop_events.alerted_at`` is set when an event is first delivered.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from collections.abc import Callable, Iterable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Protocol
from urllib.parse import quote

import httpx
import psycopg

from tcgworkers.alerts import queue_admin_alert
from tcgworkers.config import DEFAULT_SITE_URL
from tcgworkers.drops.push import PushGone, PushSender, PushSubscription, push_payload
from tcgworkers.email.templates import (
    FREE_DELAY_LINE,
    PREMIUM_PATH,
    absolute_url,
    confirmed_label,
    drop_event_label,
    format_aud,
    limit_label,
    quantity_label,
    rrp_label,
    sighting_headline,
)

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]

MAX_DELIVERY_ATTEMPTS = 6
BASE_BACKOFF_SECONDS = 30
CLAIM_LIMIT = 500
PUSH_NOT_CONFIGURED = "push not configured"
SIGHTING_PHOTO_BUCKET = "sighting-photos"

# Embed colours per event type (Discord wants an int).
EVENT_COLOURS: dict[str, int] = {
    "IN_STOCK": 0x3DDC97,
    "PREORDER_OPEN": 0x6D5DF6,
    "NEW_LISTING": 0x3EC6FF,
    "PRICE_CHANGE": 0xFFB84D,
    "QUEUE_LIVE": 0xFF6AD5,
}
DEFAULT_COLOUR = 0x9D8CFF

_push_warned = False


def delivery_backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(BASE_BACKOFF_SECONDS * 2 ** max(attempts - 1, 0), 1800))


@dataclass(frozen=True)
class Delivery:
    id: int
    user_id: str
    channel: str
    drop_event_id: int
    attempts: int = 0


@dataclass(frozen=True)
class EventInfo:
    id: int
    event_type: str
    product_title: str
    retailer: str
    retailer_slug: str
    url: str | None  # the product page (monitors, online sightings); None in store
    price_aud: Decimal | None
    occurred_at: datetime
    previous_price_aud: Decimal | None = None
    rrp_aud: Decimal | None = None
    rrp_tag: str = "UNKNOWN"
    rrp_delta_pct: Decimal | None = None
    game: str | None = None
    suppressed: bool = False
    discord_posted: bool = False
    # Member sightings only (source = 'member').
    source: str = "monitor"
    sighting_id: int | None = None
    channel: str | None = None  # in_store | online
    state: str | None = None
    suburb: str | None = None
    store_name: str | None = None
    quantity: str | None = None  # few | some | plenty
    purchase_limit: int | None = None
    photo_url: str | None = None
    note: str | None = None
    confirm_count: int = 0

    @property
    def is_sighting(self) -> bool:
        return self.source == "member"

    @property
    def in_store(self) -> bool:
        return self.is_sighting and self.channel == "in_store"

    @property
    def place(self) -> str:
        """'Kmart Chadstone, VIC' in store; the retailer's name otherwise."""
        if self.in_store and self.suburb:
            return f"{self.retailer} {self.suburb}" + (f", {self.state}" if self.state else "")
        return self.retailer

    @property
    def site_path(self) -> str:
        """Where the bell / push notification opens on the site."""
        if self.in_store and self.state:
            return f"/drops/{self.state.lower()}/"
        if self.is_sighting:
            return f"/drops/{self.retailer_slug}/"
        return "/drops/"


@dataclass(frozen=True)
class Recipient:
    user_id: str
    tier: str
    email: str | None
    active: bool = True
    wants: dict[str, bool] = field(default_factory=dict)

    def wants_channel(self, channel: str) -> bool:
        return self.wants.get(channel, True)


class DispatchStore(Protocol):
    def claim(self, limit: int) -> list[Delivery]: ...
    def events(self, ids: list[int]) -> dict[int, EventInfo]: ...
    def recipients(self, user_ids: list[str]) -> dict[str, Recipient]: ...
    def enqueue_emails(self, rows: list[tuple[Delivery, str, dict[str, Any]]]) -> None: ...
    def add_notifications(self, rows: list[tuple[Delivery, str, str, str, dict[str, Any]]]) -> None: ...
    def mark(self, deliveries: list[Delivery], status: str, error: str | None = None) -> None: ...
    def mark_retry(self, delivery: Delivery, error: str, deliver_at: datetime) -> None: ...
    def mark_discord_posted(self, event_id: int) -> None: ...
    def push_subscriptions(self, user_ids: list[str]) -> dict[str, list[PushSubscription]]: ...
    def push_result(self, subscription: PushSubscription, ok: bool) -> None:
        """ok: last_success_at = now, failures = 0; else failures + 1."""
        ...

    def delete_push_subscription(self, subscription: PushSubscription) -> None: ...
    def mark_alerted(self, event_ids: Iterable[int]) -> None: ...
    def admin_alert(self, key: str, title: str, body: str, details: dict[str, Any]) -> None: ...
    def commit(self) -> None: ...
    def event_scope(self) -> AbstractContextManager[object]:
        """Isolates one event's writes (a savepoint in Postgres)."""
        ...


DiscordPoster = Callable[[str, dict[str, Any]], None]


def sighting_photo_url(supabase_url: str | None, path: str | None) -> str | None:
    """Public URL of a sighting photo (Storage bucket ``sighting-photos``)."""
    if not supabase_url or not path:
        return None
    return (
        f"{supabase_url.rstrip('/')}/storage/v1/object/public/{SIGHTING_PHOTO_BUCKET}/{quote(path, safe='/')}"
    )


def post_discord(webhook_url: str, payload: dict[str, Any]) -> None:
    r = httpx.post(webhook_url, json=payload, timeout=10)
    if r.status_code >= 400:
        raise RuntimeError(f"discord HTTP {r.status_code}: {r.text[:300]}")


@dataclass
class DispatchResult:
    claimed: int = 0
    sent: int = 0
    skipped: int = 0
    retried: int = 0
    failed: int = 0
    emails_queued: int = 0
    discord_posts: int = 0
    pushes: int = 0

    def merge(self, other: DispatchResult) -> None:
        for name in ("sent", "skipped", "retried", "failed", "emails_queued", "discord_posts", "pushes"):
            setattr(self, name, getattr(self, name) + getattr(other, name))


# ------------------------------------------------------------ content builders
def _dec(value: Decimal | None) -> str | None:
    return None if value is None else str(value)


def headline(event: EventInfo) -> str:
    """'IN STOCK: <product>' for monitors; 'In store: <product> at Kmart
    Chadstone, VIC' / 'Online: <product> at Kmart' for member sightings."""
    if event.is_sighting:
        return sighting_headline(event.channel, event.product_title, event.place)
    return f"{drop_event_label(event.event_type)}: {event.product_title}"


def email_data(event: EventInfo, tier: str) -> dict[str, Any]:
    """The ``data`` for a ``drop`` email_outbox row (see templates._drop)."""
    data: dict[str, Any] = {
        "drop_event_id": event.id,
        "event_type": event.event_type,
        "product_title": event.product_title,
        "title": headline(event),
        "retailer": event.retailer,
        "retailer_slug": event.retailer_slug,
        "price_aud": _dec(event.price_aud),
        "previous_price_aud": _dec(event.previous_price_aud),
        "rrp_aud": _dec(event.rrp_aud),
        "rrp_tag": event.rrp_tag,
        "rrp_delta_pct": _dec(event.rrp_delta_pct),
        "url": event.url,
        "occurred_at": event.occurred_at.isoformat(),
        "game": event.game,
        "tier": tier,
        "source": event.source,
    }
    if event.is_sighting:
        data.update(
            {
                "sighting_id": event.sighting_id,
                "channel": event.channel,
                "state": event.state,
                "suburb": event.suburb,
                "store_name": event.store_name,
                "place": event.place,
                "quantity": event.quantity,
                "purchase_limit": event.purchase_limit,
                "confirm_count": event.confirm_count,
                "photo_url": event.photo_url,
                "note": event.note,
                "drops_path": event.site_path,
            }
        )
    return data


def summary_line(event: EventInfo) -> str:
    """Monitors: 'JB Hi-Fi · A$89.00 · ABOVE RRP (+12.5%)'. Sightings add
    stock, limit and confirmations: 'A$45.00 · AT RRP · Some in stock ·
    Limit 2 per customer · Confirmed by 3 members'."""
    parts = [] if event.is_sighting else [event.retailer]
    if not event.is_sighting or event.price_aud is not None:
        parts.append(format_aud(event.price_aud))
    tag = rrp_label(event.rrp_tag, event.rrp_delta_pct)
    if tag:
        parts.append(tag)
    if event.is_sighting:
        stock = quantity_label(event.quantity)
        if stock:
            parts.append(stock)
        limit = limit_label(event.purchase_limit)
        if limit:
            parts.append(limit)
        parts.append(confirmed_label(event.confirm_count))
    return " · ".join(parts)


def notification(event: EventInfo, tier: str, site_url: str) -> tuple[str, str, str, dict[str, Any]]:
    title = headline(event)[:200]
    body = summary_line(event)
    if tier != "premium":
        body += ". " + FREE_DELAY_LINE.format(url=absolute_url(site_url, PREMIUM_PATH))
    data: dict[str, Any] = {
        "drop_event_id": event.id,
        "retailer_url": event.url,
        "event_type": event.event_type,
        "tier": tier,
    }
    if event.is_sighting:
        data.update({"source": "member", "sighting_id": event.sighting_id, "photo_url": event.photo_url})
    return title, body, event.site_path, data


def push_message(event: EventInfo, tier: str) -> dict[str, Any]:
    """The web push payload: short, no links in the text (the tap opens url)."""
    body = summary_line(event)
    if event.is_sighting:
        body = f"{body} · Member sighting"
    if tier != "premium":
        body += " · Premium members got this 24 hours earlier"
    return push_payload(headline(event), body, event.site_path, f"drop-{event.id}")


def discord_payload(event: EventInfo, site_url: str = DEFAULT_SITE_URL) -> dict[str, Any]:
    """One alert card: what, where, price vs RRP, stock, limit, source, when,
    a link (the product page, or the state's sightings page in store) and
    the member's photo when there is one."""
    label = drop_event_label(event.event_type)
    fields = [
        {"name": "Retailer", "value": event.retailer[:1024], "inline": True},
        {"name": "Price", "value": format_aud(event.price_aud), "inline": True},
    ]
    tag = rrp_label(event.rrp_tag, event.rrp_delta_pct)
    if tag:
        rrp = f"{format_aud(event.rrp_aud)} · {tag}" if event.rrp_aud is not None else tag
        fields.append({"name": "RRP", "value": rrp[:1024], "inline": True})
    if event.in_store:
        where = event.place if not event.store_name else f"{event.store_name} ({event.place})"
        fields.append({"name": "Store", "value": where[:1024], "inline": False})
    stock = quantity_label(event.quantity)
    if stock:
        fields.append({"name": "Stock", "value": stock, "inline": True})
    limit = limit_label(event.purchase_limit)
    if limit:
        fields.append({"name": "Limit", "value": limit, "inline": True})
    source = (
        f"Member sighting · {confirmed_label(event.confirm_count).lower()}"
        if event.is_sighting
        else "Retailer monitor"
    )
    fields.append({"name": "Source", "value": source, "inline": True})
    fields.append({"name": "Seen", "value": f"<t:{int(event.occurred_at.timestamp())}:R>", "inline": True})
    embed: dict[str, Any] = {
        "title": headline(event)[:256] if event.is_sighting else event.product_title[:256],
        "url": event.url or absolute_url(site_url, event.site_path),
        "color": EVENT_COLOURS.get(event.event_type, DEFAULT_COLOUR),
        "fields": fields,
        "timestamp": event.occurred_at.isoformat(),
        "footer": {"text": "TCGTracker · Premium instant alert"},
    }
    if event.note:
        embed["description"] = f"“{event.note[:500]}”"
    if event.photo_url:
        embed["image"] = {"url": event.photo_url}
    content = f"**{'IN STORE' if event.in_store else label}** {event.product_title}"
    if event.in_store:
        content += f" — {event.place}"
    return {
        "username": "TCGTracker Drops",
        "content": content[:2000],
        "embeds": [embed],
        "allowed_mentions": {"parse": []},
    }


# ------------------------------------------------------------------ dispatch
def dispatch_due(
    store: DispatchStore,
    *,
    site_url: str = DEFAULT_SITE_URL,
    discord_webhook_url: str | None = None,
    poster: DiscordPoster = post_discord,
    push_sender: PushSender | None = None,
    now: datetime | None = None,
    limit: int = CLAIM_LIMIT,
) -> DispatchResult:
    """``push_sender`` None means VAPID isn't configured: push deliveries are
    skipped (not retried)."""
    now = now or datetime.now(UTC)
    result = DispatchResult()
    deliveries = store.claim(limit)
    result.claimed = len(deliveries)
    if not deliveries:
        store.commit()
        return result

    events = store.events(sorted({d.drop_event_id for d in deliveries}))
    people = store.recipients(sorted({d.user_id for d in deliveries}))
    by_event: dict[int, list[Delivery]] = defaultdict(list)
    for d in deliveries:
        by_event[d.drop_event_id].append(d)

    delivered_events: set[int] = set()
    for event_id, group in by_event.items():
        event = events.get(event_id)
        if event is None:
            _skip(store, result, group, "drop event no longer exists")
            continue
        if event.suppressed:
            _skip(store, result, group, "event suppressed")
            continue
        # Counted separately so a rolled-back event doesn't inflate the totals.
        partial = DispatchResult()
        try:
            with store.event_scope():
                delivered = _dispatch_event(
                    store,
                    partial,
                    event,
                    group,
                    people,
                    site_url,
                    discord_webhook_url,
                    poster,
                    now,
                    push_sender=push_sender,
                )
            result.merge(partial)
            if delivered:
                delivered_events.add(event_id)
        except Exception as exc:  # one bad event must not block the others
            log.exception("drop dispatch: event %s failed", event_id)
            for d in group:
                _retry_or_fail(store, result, d, f"{type(exc).__name__}: {exc}", now)

    if delivered_events:
        store.mark_alerted(delivered_events)
    store.commit()
    log.info(
        "drops dispatch: claimed=%d sent=%d skipped=%d retry=%d failed=%d emails=%d discord=%d push=%d",
        result.claimed,
        result.sent,
        result.skipped,
        result.retried,
        result.failed,
        result.emails_queued,
        result.discord_posts,
        result.pushes,
    )
    return result


def _skip(store: DispatchStore, result: DispatchResult, group: list[Delivery], reason: str) -> None:
    if group:
        store.mark(group, "skipped", reason)
        result.skipped += len(group)


def _retry_or_fail(
    store: DispatchStore, result: DispatchResult, d: Delivery, error: str, now: datetime
) -> None:
    attempts = d.attempts + 1
    if attempts >= MAX_DELIVERY_ATTEMPTS:
        store.mark([d], "failed", f"gave up after {attempts} attempts: {error}"[:1000])
        result.failed += 1
        log.error("drop delivery %s (%s) failed permanently: %s", d.id, d.channel, error)
        store.admin_alert(
            f"drop-delivery-failed:{d.channel}",
            f"Drop alert {d.channel} delivery failed",
            f"Delivery {d.id} for drop event {d.drop_event_id} failed after {attempts} attempts: {error}",
            {"delivery_id": d.id, "drop_event_id": d.drop_event_id, "channel": d.channel, "error": error},
        )
        return
    store.mark_retry(d, error[:1000], now + delivery_backoff(attempts))
    result.retried += 1


def _dispatch_event(
    store: DispatchStore,
    result: DispatchResult,
    event: EventInfo,
    group: list[Delivery],
    people: dict[str, Recipient],
    site_url: str,
    discord_webhook_url: str | None,
    poster: DiscordPoster,
    now: datetime,
    *,
    push_sender: PushSender | None = None,
) -> bool:
    emails: list[tuple[Delivery, str, dict[str, Any]]] = []
    notes: list[tuple[Delivery, str, str, str, dict[str, Any]]] = []
    discord_premium: list[Delivery] = []
    pushes: list[tuple[Delivery, str]] = []  # (delivery, tier)
    sent: list[Delivery] = []
    skipped: dict[str, list[Delivery]] = defaultdict(list)

    for d in group:
        who = people.get(d.user_id)
        if who is None or not who.active:
            skipped["member account is not active"].append(d)
            continue
        if not who.wants_channel(d.channel):
            skipped[f"member turned off drop alerts by {d.channel}"].append(d)
            continue
        if d.channel == "email":
            if not who.email:
                skipped["member has no email address"].append(d)
                continue
            emails.append((d, who.email, email_data(event, who.tier)))
        elif d.channel == "onsite":
            title, body, url, data = notification(event, who.tier, site_url)
            notes.append((d, title, body, url, data))
        elif d.channel == "discord":
            if who.tier != "premium":
                skipped["the Discord drops channel is Premium-only"].append(d)
            elif not discord_webhook_url:
                skipped["DISCORD_DROPS_WEBHOOK_URL is not set"].append(d)
            else:
                discord_premium.append(d)
        elif d.channel == "push":
            if push_sender is None:
                skipped[PUSH_NOT_CONFIGURED].append(d)
            else:
                pushes.append((d, who.tier))
        else:
            skipped[f"unknown channel {d.channel}"].append(d)

    if emails:
        store.enqueue_emails(emails)
        result.emails_queued += len(emails)
        sent.extend(d for d, _, _ in emails)
    if notes:
        store.add_notifications(notes)
        sent.extend(n[0] for n in notes)
    if discord_premium and discord_webhook_url:
        if event.discord_posted:
            sent.extend(discord_premium)  # already in the channel
        else:
            try:
                poster(discord_webhook_url, discord_payload(event, site_url))
            except Exception as exc:
                log.warning("drop dispatch: Discord post for event %s failed: %s", event.id, exc)
                for d in discord_premium:
                    _retry_or_fail(store, result, d, f"discord: {exc}", now)
            else:
                store.mark_discord_posted(event.id)
                result.discord_posts += 1
                sent.extend(discord_premium)
    if pushes and push_sender is not None:
        subs = store.push_subscriptions(sorted({d.user_id for d, _ in pushes}))
        for d, tier in pushes:
            outcome = _push(store, push_sender, subs.get(d.user_id, []), push_message(event, tier))
            if outcome is None:
                sent.append(d)
                result.pushes += 1
            elif outcome.startswith("skip:"):
                skipped[outcome.removeprefix("skip:")].append(d)
            else:
                _retry_or_fail(store, result, d, outcome, now)

    if sent:
        store.mark(sent, "sent")
        result.sent += len(sent)
    for reason, ds in skipped.items():
        if reason.startswith("DISCORD_DROPS_WEBHOOK_URL"):
            log.warning("drop dispatch: %d Discord deliveries skipped: %s", len(ds), reason)
        if reason == PUSH_NOT_CONFIGURED:
            _warn_push_not_configured()
        _skip(store, result, ds, reason)
    return bool(sent)


def _warn_push_not_configured() -> None:
    global _push_warned
    if not _push_warned:
        _push_warned = True
        log.warning("drop dispatch: push deliveries skipped: set VAPID_PRIVATE_KEY and VAPID_SUBJECT")


def _push(
    store: DispatchStore, sender: PushSender, subs: list[PushSubscription], payload: dict[str, Any]
) -> str | None:
    """Sends one push delivery to every device of the member. None = sent to
    at least one; 'skip:<reason>' = nothing left to send to; otherwise the
    error to retry with."""
    delivered = 0
    errors: list[str] = []
    for sub in subs:
        try:
            sender(sub, payload)
        except PushGone:
            store.delete_push_subscription(sub)  # unsubscribed / expired in the browser
        except Exception as exc:
            store.push_result(sub, ok=False)
            errors.append(f"{type(exc).__name__}: {exc}")
        else:
            store.push_result(sub, ok=True)
            delivered += 1
    if delivered:
        return None
    if errors:
        return "push: " + "; ".join(errors)[:900]
    return "skip:member has no push subscriptions"


# ------------------------------------------------------------------ postgres
class PostgresDispatchStore:
    """All work happens in one transaction: the claim's row locks are held
    until ``commit()``, so two dispatchers can never send the same delivery."""

    def __init__(
        self, conn: Conn, *, admin_email: str | None = None, supabase_url: str | None = None
    ) -> None:
        self.conn = conn
        self.admin_email = admin_email
        self.supabase_url = supabase_url
        self._alerts: list[tuple[str, str, str, dict[str, Any]]] = []

    def claim(self, limit: int) -> list[Delivery]:
        rows = self.conn.execute(
            """select c.delivery_id, c.user_id::text as user_id, c.channel, c.drop_event_id, d.attempts
                 from public.claim_due_drop_alerts(%s) c
                 join public.drop_alert_deliveries d on d.id = c.delivery_id""",
            (limit,),
        ).fetchall()
        return [
            Delivery(r["delivery_id"], r["user_id"], r["channel"], r["drop_event_id"], r["attempts"])
            for r in rows
        ]

    def events(self, ids: list[int]) -> dict[int, EventInfo]:
        # A monitor event has a retail product; a member sighting has none, so
        # the retailer comes from drop_events.retailer_id (filled by trigger).
        rows = self.conn.execute(
            """select e.id, e.event_type::text as event_type, e.price_aud, e.previous_price_aud, e.rrp_aud,
                      e.rrp_tag::text as rrp_tag, e.rrp_delta_pct, e.occurred_at, e.suppressed,
                      e.discord_posted_at is not null as discord_posted,
                      coalesce(p.title, s.product) as title, coalesce(p.url, s.url) as url,
                      coalesce(e.game, p.game, s.game) as game, r.name as retailer, r.slug as retailer_slug,
                      s.id as sighting_id, s.channel, s.state::text as state, s.suburb, s.store_name,
                      s.quantity, s.purchase_limit, s.photo_path, s.note, s.confirm_count
                 from public.drop_events e
                 left join public.retail_products p on p.id = e.retail_product_id
                 left join public.sightings s on s.id = e.sighting_id
                 join public.retailers r on r.id = coalesce(e.retailer_id, p.retailer_id, s.retailer_id)
                where e.id = any(%s)""",
            (ids,),
        ).fetchall()
        return {
            r["id"]: EventInfo(
                id=r["id"],
                event_type=r["event_type"],
                product_title=r["title"],
                retailer=r["retailer"],
                retailer_slug=r["retailer_slug"],
                url=r["url"],
                price_aud=r["price_aud"],
                occurred_at=r["occurred_at"],
                previous_price_aud=r["previous_price_aud"],
                rrp_aud=r["rrp_aud"],
                rrp_tag=r["rrp_tag"],
                rrp_delta_pct=r["rrp_delta_pct"],
                game=r["game"],
                suppressed=r["suppressed"],
                discord_posted=r["discord_posted"],
                source="member" if r["sighting_id"] is not None else "monitor",
                sighting_id=r["sighting_id"],
                channel=r["channel"],
                state=r["state"],
                suburb=r["suburb"],
                store_name=r["store_name"],
                quantity=r["quantity"],
                purchase_limit=r["purchase_limit"],
                photo_url=sighting_photo_url(self.supabase_url, r["photo_path"]),
                note=r["note"],
                confirm_count=r["confirm_count"] or 0,
            )
            for r in rows
        }

    def recipients(self, user_ids: list[str]) -> dict[str, Recipient]:
        rows = self.conn.execute(
            """select u.id::text as user_id, public.effective_tier(u.id)::text as tier,
                      public.user_email(u.id) as email,
                      coalesce(pp.status::text, 'active') = 'active' as active,
                      public.wants_notification(u.id, 'drop', 'email') as w_email,
                      public.wants_notification(u.id, 'drop', 'onsite') as w_onsite,
                      public.wants_notification(u.id, 'drop', 'discord') as w_discord,
                      public.wants_notification(u.id, 'drop', 'push') as w_push
                 from unnest(%s::uuid[]) as u(id)
                 left join public.profile_private pp on pp.user_id = u.id""",
            (user_ids,),
        ).fetchall()
        return {
            r["user_id"]: Recipient(
                user_id=r["user_id"],
                tier=r["tier"] or "free",
                email=r["email"],
                active=bool(r["active"]),
                wants={
                    "email": r["w_email"],
                    "onsite": r["w_onsite"],
                    "discord": r["w_discord"],
                    "push": r["w_push"],
                },
            )
            for r in rows
        }

    def enqueue_emails(self, rows: list[tuple[Delivery, str, dict[str, Any]]]) -> None:
        with self.conn.cursor() as cur:
            cur.executemany(
                """insert into public.email_outbox (user_id, to_email, template, data, dedupe_key)
                   values (%s, %s, 'drop', %s::jsonb, %s)
                   on conflict (dedupe_key) do nothing""",
                [
                    (d.user_id, email, json.dumps(data, default=str), f"drop:{d.id}")
                    for d, email, data in rows
                ],
            )

    def add_notifications(self, rows: list[tuple[Delivery, str, str, str, dict[str, Any]]]) -> None:
        with self.conn.cursor() as cur:
            cur.executemany(
                """insert into public.notifications (user_id, type, title, body, url, data)
                   values (%s, 'drop', %s, %s, %s, %s::jsonb)""",
                [(d.user_id, t, b, u, json.dumps(data, default=str)) for d, t, b, u, data in rows],
            )

    def mark(self, deliveries: list[Delivery], status: str, error: str | None = None) -> None:
        self.conn.execute(
            """update public.drop_alert_deliveries
                  set status = %s, error = %s, attempts = attempts + 1,
                      sent_at = case when %s = 'sent' then now() else sent_at end
                where id = any(%s)""",
            (status, error, status, [d.id for d in deliveries]),
        )

    def mark_retry(self, delivery: Delivery, error: str, deliver_at: datetime) -> None:
        self.conn.execute(
            """update public.drop_alert_deliveries
                  set attempts = attempts + 1, error = %s, deliver_at = %s
                where id = %s""",
            (error, deliver_at, delivery.id),
        )

    def mark_discord_posted(self, event_id: int) -> None:
        self.conn.execute(
            "update public.drop_events set discord_posted_at = now() where id = %s", (event_id,)
        )

    def push_subscriptions(self, user_ids: list[str]) -> dict[str, list[PushSubscription]]:
        rows = self.conn.execute(
            """select id, user_id::text as user_id, endpoint, p256dh, auth
                 from public.push_subscriptions where user_id = any(%s::uuid[]) order by id""",
            (user_ids,),
        ).fetchall()
        out: dict[str, list[PushSubscription]] = defaultdict(list)
        for r in rows:
            out[r["user_id"]].append(
                PushSubscription(r["id"], r["user_id"], r["endpoint"], r["p256dh"], r["auth"])
            )
        return dict(out)

    def push_result(self, subscription: PushSubscription, ok: bool) -> None:
        if ok:
            self.conn.execute(
                "update public.push_subscriptions set last_success_at = now(), failures = 0 where id = %s",
                (subscription.id,),
            )
        else:
            self.conn.execute(
                "update public.push_subscriptions set failures = failures + 1 where id = %s",
                (subscription.id,),
            )

    def delete_push_subscription(self, subscription: PushSubscription) -> None:
        self.conn.execute("delete from public.push_subscriptions where id = %s", (subscription.id,))

    def mark_alerted(self, event_ids: Iterable[int]) -> None:
        self.conn.execute(
            "update public.drop_events set alerted_at = now() where id = any(%s) and alerted_at is null",
            (list(event_ids),),
        )

    def admin_alert(self, key: str, title: str, body: str, details: dict[str, Any]) -> None:
        # Queued after commit so the alert's own commit can't release the claim locks early.
        self._alerts.append((key, title, body, details))

    def event_scope(self) -> AbstractContextManager[object]:
        return self.conn.transaction()  # a savepoint inside the claim's transaction

    def commit(self) -> None:
        self.conn.commit()
        alerts, self._alerts = self._alerts, []
        for key, title, body, details in alerts:
            queue_admin_alert(self.conn, self.admin_email, key=key, title=title, body=body, details=details)


def run_dispatcher(
    conn: Conn,
    *,
    site_url: str,
    discord_webhook_url: str | None,
    admin_email: str | None,
    poster: DiscordPoster = post_discord,
    push_sender: PushSender | None = None,
    supabase_url: str | None = None,
) -> DispatchResult:
    store = PostgresDispatchStore(conn, admin_email=admin_email, supabase_url=supabase_url)
    try:
        return dispatch_due(
            store,
            site_url=site_url,
            discord_webhook_url=discord_webhook_url,
            poster=poster,
            push_sender=push_sender,
        )
    except Exception:
        conn.rollback()
        raise
