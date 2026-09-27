"""Scheduled jobs.

| job         | cadence (setting)                   | status                                  |
|-------------|-------------------------------------|-----------------------------------------|
| fx          | market.fx_refresh_hours (24h)       | live (RBA F11, CC BY 4.0)               |
| population  | market.population_refresh_hours     | waiting on a licensed source (14.1)     |
| prices      | market.floor_refresh_hours (4h)     | waiting on pricing approval (14.2)      |
| floors      | market.floor_refresh_hours (4h)     | ready; needs price data                 |
| snapshots   | daily                               | ready; needs population + floors        |
| drops:<r>   | retailers.watch_interval_seconds    | waiting on ToS sign-off per retailer    |
| expiry      | hourly                              | ready                                   |
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
import psycopg

from tcgworkers.db import pipeline_run
from tcgworkers.sources.fx.rba import F11_URL, parse_f11
from tcgworkers.sources.population.base import SourceNotApproved

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]


@dataclass(frozen=True)
class Job:
    name: str
    every_hours_setting: str | None
    every_hours_default: float
    run: Callable[[Conn, str], None]


def refresh_fx(conn: Conn, user_agent: str) -> None:
    with pipeline_run(conn, "fx") as stats:
        r = httpx.get(F11_URL, headers={"User-Agent": user_agent}, timeout=30)
        r.raise_for_status()
        rates = parse_f11(r.text)
        for rate in rates:
            conn.execute(
                """insert into public.fx_rates (currency, date, rate_to_aud, source)
                   values (%s, %s, %s, %s)
                   on conflict (currency, date) do update set rate_to_aud = excluded.rate_to_aud,
                     fetched_at = now()""",
                (rate.currency, rate.date, rate.rate_to_aud, rate.source),
            )
        stats["currencies"] = len(rates)
        stats["date"] = max((r.date for r in rates), default=None)


def refresh_floors(conn: Conn, user_agent: str) -> None:
    """Recompute floor_prices from price_points + active listings.

    Marketplace asks come straight from active listings; external points from
    price_points. See tcgworkers.market.floor for the rules."""
    from datetime import UTC, datetime

    from tcgworkers.db import load_rules
    from tcgworkers.market.floor import PricePoint, compute_floor

    rules = load_rules(conn)
    now = datetime.now(UTC)
    with pipeline_run(conn, "floors") as stats:
        rows = conn.execute(
            """select card_id::text, grade_key, type::text, price_aud, source, observed_at, is_excluded
                 from public.price_points where observed_at > now() - interval '120 days'
               union all
               select card_id::text, grade_key, 'ask', price_aud, 'marketplace', coalesce(approved_at, now()), false
                 from public.listings where status = 'active' and card_id is not null"""
        ).fetchall()
        grouped: dict[tuple[str, str], list[PricePoint]] = {}
        for r in rows:
            grouped.setdefault((r["card_id"], r["grade_key"]), []).append(
                PricePoint(
                    r["card_id"],
                    r["grade_key"],
                    r["type"],
                    r["price_aud"],
                    r["source"],
                    r["observed_at"],
                    r["is_excluded"],
                )
            )
        written = 0
        for points in grouped.values():
            f = compute_floor(points, now=now, rules=rules)
            if f is None:
                continue
            conn.execute(
                """insert into public.floor_prices (card_id, grade_key, floor_aud, basis, source, sample_size,
                     outliers_ignored, last_sold_aud, last_sold_at, median_sold_30d_aud, observed_at, computed_at)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
                   on conflict (card_id, grade_key) do update set floor_aud=excluded.floor_aud,
                     basis=excluded.basis, source=excluded.source, sample_size=excluded.sample_size,
                     outliers_ignored=excluded.outliers_ignored, last_sold_aud=excluded.last_sold_aud,
                     last_sold_at=excluded.last_sold_at, median_sold_30d_aud=excluded.median_sold_30d_aud,
                     observed_at=excluded.observed_at, computed_at=now()""",
                (
                    f.card_id,
                    f.grade_key,
                    f.floor_aud,
                    f.basis.value,
                    f.source,
                    f.sample_size,
                    f.outliers_ignored,
                    f.last_sold_aud,
                    f.last_sold_at,
                    f.median_sold_30d_aud,
                    f.observed_at,
                ),
            )
            written += 1
        stats["floors"] = written


def snapshot_market_caps(conn: Conn, user_agent: str) -> None:
    """Daily market cap snapshot = latest population x current floor."""
    with pipeline_run(conn, "snapshots") as stats:
        cur = conn.execute(
            """insert into public.market_cap_snapshots
                 (card_id, grade_key, date, population, floor_aud, basis, market_cap_aud, fx_date)
               select p.card_id, p.grade_key, (now() at time zone 'Australia/Melbourne')::date, p.population,
                      f.floor_aud, f.basis, round(p.population * f.floor_aud, 2),
                      (select max(date) from public.fx_rates)
                 from public.population_current p
                 join public.floor_prices f on f.card_id = p.card_id and f.grade_key = p.grade_key
               on conflict (card_id, grade_key, date) do update set population = excluded.population,
                 floor_aud = excluded.floor_aud, basis = excluded.basis,
                 market_cap_aud = excluded.market_cap_aud, fx_date = excluded.fx_date"""
        )
        stats["rows"] = cur.rowcount
        conn.execute("refresh materialized view concurrently public.market_cap_rankings")


def expire_listings(conn: Conn, user_agent: str) -> None:
    with pipeline_run(conn, "expiry") as stats:
        cur = conn.execute(
            "update public.listings set status = 'expired' where status = 'active' and expires_at < now()"
        )
        stats["expired"] = cur.rowcount


def not_approved(what: str) -> Callable[[Conn, str], None]:
    def run(conn: Conn, user_agent: str) -> None:
        raise SourceNotApproved(f"{what} source not approved yet - see docs/research")

    return run


JOBS: tuple[Job, ...] = (
    Job("fx", "market.fx_refresh_hours", 24, refresh_fx),
    Job("population", "market.population_refresh_hours", 24, not_approved("population")),
    Job("prices", "market.floor_refresh_hours", 4, not_approved("pricing")),
    Job("floors", "market.floor_refresh_hours", 4, refresh_floors),
    Job("snapshots", None, 24, snapshot_market_caps),
    Job("expiry", None, 1, expire_listings),
)
