"""The ``prices`` job: PriceCharting -> catalogue + price_points.

Runs every market.floor_refresh_hours (4h), but downloads each category's
CSV at most once a day (PriceCharting regenerates them every 24 hours), with
10 minutes between the two downloads. If a category's CSV fails (e.g. the
URL template is wrong), that is logged as an ERROR (Sentry) and the JSON API
is used instead for that game, at 1 call/second and at most
``pricecharting.max_api_calls`` calls:

* ``/api/product?id=`` for products already linked to our cards;
* ``/api/products?q=`` with the remaining budget, for catalogue cards that
  have no PriceCharting link yet.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from tcgworkers.config import Env
from tcgworkers.db import load_rules, pipeline_run
from tcgworkers.sources.population.base import SourceNotApproved
from tcgworkers.sources.pricing.ingest import PcIngestor, latest_usd_fx, stats_dict
from tcgworkers.sources.pricing.pricecharting import (
    CATEGORIES,
    DEFAULT_CSV_URL_TEMPLATE,
    PcProduct,
    PriceChartingClient,
    PriceChartingError,
    PriceChartingSource,
    parse_console,
    parse_csv,
)

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]
CSV_FRESH_FOR = timedelta(hours=20)
GAME_OF_CATEGORY = {"pokemon-cards": "pokemon", "one-piece-cards": "one-piece"}


def _setting_int(rules_extra: dict[str, Any], key: str, default: int) -> int:
    try:
        return int(rules_extra.get(key, default))
    except (TypeError, ValueError):
        return default


def api_fallback(client: PriceChartingClient, conn: Conn, games: list[str], budget: int) -> list[PcProduct]:
    products: dict[str, PcProduct] = {}
    ids = [
        r["external_id"]
        for r in conn.execute(
            """select e.external_id from public.card_external_ids e join public.cards c on c.id = e.card_id
                where e.source = 'pricecharting' and c.game = any(%s) order by random() limit %s""",
            (games, budget),
        )
    ]
    unmapped = conn.execute(
        """select c.name, c.number, c.game, c.lang from public.cards c
            where c.game = any(%s) and not c.auto_created
              and not exists (select 1 from public.card_external_ids e where e.card_id = c.id and e.source = 'pricecharting')
            order by random() limit %s""",
        (games, max(budget - len(ids), 0)),
    ).fetchall()
    conn.commit()  # don't hold a transaction open through a slow, rate-limited loop
    try:
        for pc_id in ids:
            try:
                p = client.product(pc_id)
            except PriceChartingError as exc:
                if exc.status in (401, 403, 429):
                    raise
                log.warning("pricecharting: product %s: %s", pc_id, exc)
                continue
            if p:
                products[p.id] = p
        for card in unmapped:
            for p in client.search(f"{card['name']} {card['number']}"):
                info = parse_console(p.console_name)
                if (info.game, info.lang) == (card["game"], card["lang"]):
                    products.setdefault(p.id, p)
    except PriceChartingError as exc:
        log.error("pricecharting: API fallback stopped after %d calls: %s", client.api_calls, exc)
    return list(products.values())


def refresh_prices(conn: Conn, env: Env, *, client: PriceChartingClient | None = None) -> dict[str, Any]:
    if not env.pricecharting_token and client is None:
        raise SourceNotApproved("PRICECHARTING_TOKEN is not set (PriceCharting Legendary plan)")
    rules = load_rules(conn)
    now = datetime.now(UTC)
    client = client or PriceChartingClient(
        env.pricecharting_token or "",
        env.pricecharting_csv_url_template or DEFAULT_CSV_URL_TEMPLATE,
        user_agent=env.user_agent,
    )
    source = PriceChartingSource(client)
    with pipeline_run(conn, "prices") as stats:
        stats["source"] = "pricecharting"
        stats["licence"] = asdict(source.licence)
        last = conn.execute(
            """select finished_at from public.pipeline_runs
                where job = 'prices' and status = 'succeeded' and stats ->> 'mode' = 'csv'
                order by finished_at desc limit 1"""
        ).fetchone()
        if last and last["finished_at"] and now - last["finished_at"] < CSV_FRESH_FOR:
            stats["mode"] = "skipped"
            stats["reason"] = f"CSV already ingested at {last['finished_at'].isoformat()}"
            return stats
        fx = latest_usd_fx(
            conn, max_age_days=_setting_int(rules.extra, "pricecharting.fx_max_age_days", 7), today=now.date()
        )
        conn.commit()

        products: list[PcProduct] = []
        failed: list[str] = []
        errors: dict[str, str] = {}
        for category in CATEGORIES:
            try:
                products.extend(parse_csv(client.download_csv(category)))
            except (PriceChartingError, ValueError) as exc:
                log.error("pricecharting: CSV for %s failed; falling back to the API: %s", category, exc)
                failed.append(category)
                errors[category] = str(exc)[:500]
        if failed:
            budget = _setting_int(rules.extra, "pricecharting.max_api_calls", 300)
            products.extend(api_fallback(client, conn, [GAME_OF_CATEGORY[c] for c in failed], budget))
            stats["csv_errors"] = errors
        stats["mode"] = "csv" if not failed else ("api" if len(failed) == len(CATEGORIES) else "csv+api")
        stats["api_calls"] = client.api_calls

        ingestor = PcIngestor(conn, rules=rules, now=now)
        ingestor.ingest(products, fx)
        stats.update(stats_dict(ingestor.stats))
        stats["fx_date"] = fx.date.isoformat()
        stats["usd_to_aud"] = str(fx.rate_to_aud)
        log.info("pricecharting: %s", {k: v for k, v in stats.items() if k != "licence"})
    return stats
