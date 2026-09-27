"""Transition-only drop events (brief 9.3).

An alert fires only when a product's state CHANGES. Polling the same in-stock
page every 90 seconds produces one IN_STOCK event, not forty. Each event's
dedupe_key is derived from the transition (product + event + the state it
came from), so two workers processing the same transition can't double-alert
(drop_events.dedupe_key is unique).
"""

from __future__ import annotations

import hashlib

from tcgworkers.drops.models import Availability, DropEvent, EventType, Observation, ProductState


def _key(obs: Observation, event: EventType, previous: ProductState | None) -> str:
    basis = previous.observed_at.isoformat() if previous else "first-seen"
    digest = hashlib.sha1(f"{obs.retailer}|{obs.sku}|{event}|{basis}".encode()).hexdigest()[:16]
    return f"{obs.retailer}:{obs.sku}:{event}:{digest}"


def diff(previous: ProductState | None, obs: Observation) -> list[DropEvent]:
    """Events implied by moving from ``previous`` (None = never seen) to ``obs``."""
    events: list[EventType] = []
    was = previous.availability if previous else None

    if previous is None:
        events.append(EventType.NEW_LISTING)
    if obs.availability is Availability.PREORDER and was is not Availability.PREORDER:
        events.append(EventType.PREORDER_OPEN)
    if obs.availability.in_stock and not (was is not None and was.in_stock):
        events.append(EventType.IN_STOCK)
    if (
        previous is not None
        and previous.price_aud is not None
        and obs.price_aud is not None
        and previous.price_aud != obs.price_aud
    ):
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
