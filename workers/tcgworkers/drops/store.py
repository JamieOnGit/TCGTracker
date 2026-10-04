"""``DropStore`` on Postgres: retail_products, retail_product_states,
drop_events and the retailers health columns.

Inserting a drop_events row fires ``enqueue_drop_alerts()`` (a DB trigger),
which fans the event out into drop_alert_deliveries for the dispatcher. The
store never commits by itself; the runner commits once per cycle.

With a ``Catalogue``, a listing seen for the first time (or whose title
changed) is run through the product matcher (``drops.products``) before its
state and events are written, so drop_events pick up the sealed product.
Inserting a retail_product_states row keeps retail_products.current_* up to
date (DB trigger).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import replace
from datetime import datetime
from typing import Any

import psycopg

from tcgworkers.drops.engine import Health
from tcgworkers.drops.filters import WatchRule
from tcgworkers.drops.models import Availability, DropEvent, Observation, ProductState
from tcgworkers.drops.products import Catalogue, apply_match
from tcgworkers.drops.rrp import RrpEntry

Conn = psycopg.Connection[dict[str, Any]]


BASELINE_REASON = "baseline: first scan of this retailer, so existing stock is not a drop"


class PostgresDropStore:
    """``baseline=True`` (the retailer's first ever scan) stores products,
    states and events as usual but marks every event suppressed, so switching
    a retailer on doesn't alert members about its whole existing range."""

    def __init__(
        self,
        conn: Conn,
        retailer_id: str,
        *,
        baseline: bool = False,
        catalogue: Catalogue | None = None,
        rrp_entries: Sequence[RrpEntry] = (),
    ) -> None:
        self.conn = conn
        self.retailer_id = retailer_id
        self.baseline = baseline
        self.catalogue = catalogue
        self.rrp_entries = rrp_entries
        self._product_ids: dict[str, int] = {}
        self._titles: dict[str, str] = {}

    def last_state(self, retailer: str, sku: str) -> ProductState | None:
        row = self.conn.execute(
            """select p.id, p.title, s.availability::text as availability, s.price_aud, s.queue_live, s.observed_at
                 from public.retail_products p
                 left join lateral (
                   select availability, price_aud, queue_live, observed_at
                     from public.retail_product_states
                    where retail_product_id = p.id
                    order by observed_at desc, id desc
                    limit 1) s on true
                where p.retailer_id = %s and p.sku = %s""",
            (self.retailer_id, sku),
        ).fetchone()
        if row is None:
            return None
        self._product_ids[sku] = row["id"]
        self._titles[sku] = row["title"]
        if row["availability"] is None:
            return None
        return ProductState(
            availability=Availability(row["availability"]),
            price_aud=row["price_aud"],
            queue_live=row["queue_live"],
            observed_at=row["observed_at"],
        )

    def save_observation(
        self,
        obs: Observation,
        game: str | None,
        product_type: str | None,
        set_code: str | None,
        changed: bool,
    ) -> None:
        row = self.conn.execute(
            """insert into public.retail_products
                 (retailer_id, sku, url, title, game, product_type, set_code, is_marketplace_seller, last_seen_at,
                  image_url, cart_url)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (retailer_id, sku) do update set
                 url = excluded.url, title = excluded.title,
                 game = coalesce(excluded.game, retail_products.game),
                 product_type = coalesce(excluded.product_type, retail_products.product_type),
                 set_code = coalesce(excluded.set_code, retail_products.set_code),
                 is_marketplace_seller = excluded.is_marketplace_seller,
                 last_seen_at = excluded.last_seen_at,
                 image_url = coalesce(excluded.image_url, retail_products.image_url),
                 cart_url = excluded.cart_url
               returning id""",
            (
                self.retailer_id,
                obs.sku,
                obs.url,
                obs.title[:500],
                game,
                product_type,
                set_code,
                obs.is_marketplace_seller,
                obs.observed_at,
                _image(obs.image_url),
                obs.cart_url if obs.cart_url and obs.cart_url.startswith("https://") else None,
            ),
        ).fetchone()
        assert row is not None
        self._product_ids[obs.sku] = row["id"]
        title = obs.title[:500]
        if self.catalogue is not None and self._titles.get(obs.sku) != title:
            apply_match(
                self.conn,
                row["id"],
                title,
                self.catalogue,
                self.rrp_entries,
                game_hint=game or obs.game_hint,
                lang_hint=obs.lang_hint,
                price_aud=obs.price_aud,
                now=obs.observed_at,
            )
        self._titles[obs.sku] = title
        if changed:
            self.conn.execute(
                """insert into public.retail_product_states
                     (retail_product_id, availability, price_aud, queue_live, observed_at, raw)
                   values (%s, %s::public.availability, %s, %s, %s, %s::jsonb)""",
                (
                    row["id"],
                    obs.availability.value,
                    obs.price_aud,
                    obs.queue_live,
                    obs.observed_at,
                    json.dumps(obs.raw, default=str) if obs.raw else None,
                ),
            )

    def save_event(self, event: DropEvent) -> bool:
        if self.baseline:
            event = replace(event, suppressed=True, suppressed_reason=BASELINE_REASON)
        product_id = self._product_ids.get(event.sku)
        if product_id is None:  # the engine always saves the observation first
            found = self.conn.execute(
                "select id from public.retail_products where retailer_id = %s and sku = %s",
                (self.retailer_id, event.sku),
            ).fetchone()
            if found is None:
                raise LookupError(f"no retail_products row for {event.retailer}/{event.sku}")
            product_id = found["id"]
        row = self.conn.execute(
            """insert into public.drop_events
                 (retail_product_id, event_type, price_aud, previous_price_aud, rrp_aud, rrp_tag, rrp_delta_pct,
                  dedupe_key, occurred_at, suppressed, suppressed_reason)
               values (%s, %s::public.drop_event_type, %s, %s, %s, %s::public.rrp_tag, %s, %s, %s, %s, %s)
               on conflict (dedupe_key) do nothing
               returning id""",
            (
                product_id,
                event.event_type.value,
                event.price_aud,
                event.previous_price_aud,
                event.rrp_aud,
                event.rrp_tag.value,
                event.rrp_delta_pct,
                event.dedupe_key,
                event.occurred_at,
                event.suppressed,
                event.suppressed_reason,
            ),
        ).fetchone()
        return row is not None

    def record_health(
        self, retailer: str, *, ok: bool, products: int, error: str | None, at: datetime
    ) -> Health:
        row = self.conn.execute(
            """update public.retailers set
                 consecutive_errors = case when %(ok)s then 0 else consecutive_errors + 1 end,
                 zero_product_cycles = case when not %(ok)s then zero_product_cycles
                                            when %(products)s = 0 then zero_product_cycles + 1 else 0 end,
                 last_success_at = case when %(ok)s then %(at)s else last_success_at end,
                 last_error_at = case when %(ok)s then last_error_at else %(at)s end,
                 last_error = case when %(ok)s then last_error else %(error)s end
               where id = %(id)s
               returning consecutive_errors, zero_product_cycles""",
            {"ok": ok, "products": products, "at": at, "error": (error or "")[:2000], "id": self.retailer_id},
        ).fetchone()
        if row is None:
            return Health()
        return Health(
            consecutive_errors=row["consecutive_errors"], zero_product_cycles=row["zero_product_cycles"]
        )


def _image(url: str | None) -> str | None:
    return url if url and url.startswith("https://") and len(url) <= 1000 else None


KEEP = object()  # mark_checked: leave blocked_reason as it is


def mark_checked(conn: Conn, retailer_id: str, *, at: datetime, blocked_reason: object = KEEP) -> None:
    """Every cycle: retailers.last_checked_at, and blocked_reason set (the
    adapter raised AdapterBlocked / robots disallow), cleared (a clean cycle)
    or kept (a transient error such as backing off)."""
    if blocked_reason is KEEP:
        conn.execute("update public.retailers set last_checked_at = %s where id = %s", (at, retailer_id))
        return
    reason = None if blocked_reason is None else str(blocked_reason)[:200]
    conn.execute(
        "update public.retailers set last_checked_at = %s, blocked_reason = %s where id = %s",
        (at, reason, retailer_id),
    )


def is_first_scan(conn: Conn, retailer_id: str) -> bool:
    row = conn.execute(
        "select not exists (select 1 from public.retail_products where retailer_id = %s) as first",
        (retailer_id,),
    ).fetchone()
    return bool(row and row["first"])


def load_rrp_entries(conn: Conn) -> list[RrpEntry]:
    rows = conn.execute(
        "select game, lang, product_type, set_code, rrp_aud from public.rrp_reference"
    ).fetchall()
    return [RrpEntry(r["game"], r["product_type"], r["rrp_aud"], r["lang"], r["set_code"]) for r in rows]


def load_watch_rules(conn: Conn, retailer_id: str) -> list[WatchRule]:
    """Enabled global rules plus this retailer's own rules."""
    rows = conn.execute(
        """select kind, value, game, priority from public.watchlist
            where enabled and (retailer_id is null or retailer_id = %s)
            order by id""",
        (retailer_id,),
    ).fetchall()
    return [WatchRule(r["kind"], r["value"], r["game"], r["priority"]) for r in rows]
