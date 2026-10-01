"""Transition-only drop events (brief 9.3).

An alert fires only when a product's state CHANGES. Polling the same in-stock
page every 90 seconds produces one IN_STOCK event, not forty. Each event's
dedupe_key is derived from the transition (product + event + the state it
came from), so two workers processing the same transition can't double-alert
(drop_events.dedupe_key is unique).

PRICE_CHANGE fires only for a drop of at least ``drops.price_drop_pct`` (5%)
from the last stored price; every price change is still stored as a state
row, so retail_products.current_price_aud stays exact.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal

from tcgworkers.drops.models import Availability, DropEvent, EventType, Observation, ProductState


def _key(obs: Observation, event: EventType, previous: ProductState | None) -> str:
    basis = previous.observed_at.isoformat() if previous else "first-seen"
    digest = hashlib.sha1(f"{obs.retailer}|{obs.sku}|{event}|{basis}".encode()).hexdigest()[:16]
    return f"{obs.retailer}:{obs.sku}:{event}:{digest}"


PRICE_DROP_PCT = Decimal("5")


def price_dropped(previous: Decimal | None, current: Decimal | None, min_drop_pct: Decimal) -> bool:
    """A price drop worth an alert: at least ``min_drop_pct`` below the last
    price. Rises and small wobbles are stored (retail_product_states) but not
    alerted; the RRP tag on later events still shows an above-RRP price."""
    if previous is None or current is None or previous <= 0 or current >= previous:
        return False
    return (previous - current) / previous * 100 >= min_drop_pct


def diff(
    previous: ProductState | None, obs: Observation, *, min_price_drop_pct: Decimal = PRICE_DROP_PCT
) -> list[DropEvent]:
    """Events implied by moving from ``previous`` (None = never seen) to ``obs``."""
    events: list[EventType] = []
    was = previous.availability if previous else None

    if previous is None:
        # A product seen for the first time gets ONE event, the most useful
        # one to a shopper: buyable now > pre-order > merely listed.
        if obs.availability.in_stock:
            events.append(EventType.IN_STOCK)
        elif obs.availability is Availability.PREORDER:
            events.append(EventType.PREORDER_OPEN)
        else:
            events.append(EventType.NEW_LISTING)
    else:
        if obs.availability is Availability.PREORDER and was is not Availability.PREORDER:
            events.append(EventType.PREORDER_OPEN)
        if obs.availability.in_stock and not (was is not None and was.in_stock):
            events.append(EventType.IN_STOCK)
    if previous is not None and price_dropped(previous.price_aud, obs.price_aud, min_price_drop_pct):
        events.append(EventType.PRICE_CHANGE)
    if obs.queue_live and not (previous is not None and previous.queue_live):
        events.append(EventType.QUEUE_LIVE)

    return [
        DropEvent(
            retailer=obs.retailer,
            sku=obs.sku,
            url=obs.url,
            title=obs.title,
            event_type=e,
            price_aud=obs.price_aud,
            previous_price_aud=previous.price_aud if previous else None,
            occurred_at=obs.observed_at,
            dedupe_key=_key(obs, e, previous),
        )
        for e in events
    ]


def state_changed(previous: ProductState | None, obs: Observation) -> bool:
    """Whether a new retail_product_states row should be written."""
    return previous is None or (previous.availability, previous.price_aud, previous.queue_live) != (
        obs.availability,
        obs.price_aud,
        obs.queue_live,
    )


def to_state(obs: Observation) -> ProductState:
    return ProductState(obs.availability, obs.price_aud, obs.queue_live, obs.observed_at)
