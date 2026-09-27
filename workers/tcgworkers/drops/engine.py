"""One monitoring cycle for one retailer: fetch -> filter -> diff -> tag -> store.

Storage is behind ``DropStore`` so the engine is tested with an in-memory
store and runs against Postgres in production.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import datetime
from decimal import Decimal
from typing import Protocol

from tcgworkers.config import Rules
from tcgworkers.drops import rrp as rrp_mod
from tcgworkers.drops.filters import DEFAULT_WATCHLIST, WatchRule, classify
from tcgworkers.drops.models import DropEvent, Observation, ProductState
from tcgworkers.drops.state import diff, state_changed, to_state


class DropStore(Protocol):
    def last_state(self, retailer: str, sku: str) -> ProductState | None: ...
    def save_observation(
        self,
        obs: Observation,
        game: str | None,
        product_type: str | None,
        set_code: str | None,
        changed: bool,
    ) -> None: ...
    def save_event(self, event: DropEvent) -> bool:
        """Insert; return False when the dedupe_key already exists."""
        ...

    def record_health(
        self, retailer: str, *, ok: bool, products: int, error: str | None, at: datetime
    ) -> Health: ...


@dataclass
class Health:
    consecutive_errors: int = 0
    zero_product_cycles: int = 0

    def needs_alert(self, threshold: int) -> bool:
        return self.consecutive_errors >= threshold or self.zero_product_cycles >= threshold


@dataclass
class InMemoryStore:
    states: dict[tuple[str, str], ProductState] = field(default_factory=dict)
    history: list[tuple[Observation, bool]] = field(default_factory=list)
    events: dict[str, DropEvent] = field(default_factory=dict)
    health: dict[str, Health] = field(default_factory=dict)

    def last_state(self, retailer: str, sku: str) -> ProductState | None:
        return self.states.get((retailer, sku))

    def save_observation(
        self,
        obs: Observation,
        game: str | None,
        product_type: str | None,
        set_code: str | None,
        changed: bool,
    ) -> None:
        self.history.append((obs, changed))
        if changed:
            self.states[(obs.retailer, obs.sku)] = to_state(obs)

    def save_event(self, event: DropEvent) -> bool:
        if event.dedupe_key in self.events:
            return False
        self.events[event.dedupe_key] = event
        return True

    def record_health(
        self, retailer: str, *, ok: bool, products: int, error: str | None, at: datetime
    ) -> Health:
        h = self.health.setdefault(retailer, Health())
        h.consecutive_errors = 0 if ok else h.consecutive_errors + 1
        if ok:
            h.zero_product_cycles = h.zero_product_cycles + 1 if products == 0 else 0
        return h


@dataclass(frozen=True)
class CycleResult:
    retailer: str
    seen: int
    tcg: int
    new_events: list[DropEvent]
    health: Health
    alert_admin: bool
    error: str | None = None


def run_cycle(
    retailer: str,
    observations: Iterable[Observation] | Exception,
    store: DropStore,
    *,
    rules: Rules,
    rrp_entries: Iterable[rrp_mod.RrpEntry] = (),
    watchlist: Iterable[WatchRule] = DEFAULT_WATCHLIST,
    now: datetime,
) -> CycleResult:
    """Process one poll's observations (or the exception the adapter raised)."""
    if isinstance(observations, Exception):
        health = store.record_health(retailer, ok=False, products=0, error=str(observations), at=now)
        return CycleResult(
            retailer,
            0,
            0,
            [],
            health,
            health.needs_alert(rules.drops_zero_product_alert_cycles),
            str(observations),
        )

    watch = list(watchlist)
    entries = list(rrp_entries)
    seen = tcg = 0
    new_events: list[DropEvent] = []
    for obs in observations:
        seen += 1
        c = classify(obs.title, watch)
        if not c.is_tcg:
            continue
        tcg += 1
        previous = store.last_state(obs.retailer, obs.sku)
        changed = state_changed(previous, obs)
        store.save_observation(obs, c.game, c.product_type, c.set_code, changed)
        if not changed:
            continue
        rrp = (
            rrp_mod.lookup_rrp(entries, game=c.game, product_type=c.product_type, set_code=c.set_code)
            if c.game
            else None
        )
        tag, delta = rrp_mod.tag(obs.price_aud, rrp, tolerance_pct=rules.drops_rrp_tolerance_pct)
        suppress = rrp_mod.should_suppress(
            is_marketplace_seller=obs.is_marketplace_seller,
            delta_pct=delta,
            suppress_above_pct=rules.drops_suppress_above_rrp_pct,
        )
        for event in diff(previous, obs):
            event = replace(
                event,
                rrp_aud=rrp,
                rrp_tag=tag,
                rrp_delta_pct=delta,
                game=c.game,
                suppressed=suppress is not None,
                suppressed_reason=suppress,
            )
            if store.save_event(event):
                new_events.append(event)

    health = store.record_health(retailer, ok=True, products=tcg, error=None, at=now)
    return CycleResult(
        retailer, seen, tcg, new_events, health, health.needs_alert(rules.drops_zero_product_alert_cycles)
    )


def alertable(events: Iterable[DropEvent]) -> list[DropEvent]:
    """Events that should reach Premium members right now."""
    return [e for e in events if not e.suppressed]


def price_str(value: Decimal | None) -> str:
    return "—" if value is None else f"A${value:,.2f}"
