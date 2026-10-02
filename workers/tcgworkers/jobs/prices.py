"""The ``prices`` job: card prices -> catalogue + price_points.

JustTCG is the source when ``JUSTTCG_API_KEY`` is set (its paid plans allow
public display; see ``refresh_justtcg``). PriceCharting remains as a
fallback for a deployment that only has ``PRICECHARTING_TOKEN``.

PriceCharting:

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

import json
import logging
from collections import Counter
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from tcgworkers.config import Env
from tcgworkers.db import load_rules, pipeline_run
from tcgworkers.sources.population.base import SourceNotApproved
from tcgworkers.sources.pricing.ingest import PcIngestor, latest_usd_fx, stats_dict
from tcgworkers.sources.pricing.justtcg import (
    DEFAULT_COMPANIES,
    BudgetExhausted,
    JtGame,
    JustTcgClient,
    JustTcgError,
    games_from_setting,
    parse_card,
)
from tcgworkers.sources.pricing.justtcg import licence as justtcg_licence
from tcgworkers.sources.pricing.justtcg_ingest import FxHistory, JtIngestor
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


def refresh_pricecharting(
    conn: Conn, env: Env, *, client: PriceChartingClient | None = None
) -> dict[str, Any]:
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


# ------------------------------------------------------------------ JustTCG
HISTORY_WINDOWS = ("7d", "30d", "90d", "180d", "1y")


def refresh_prices(conn: Conn, env: Env, *, client: Any = None) -> dict[str, Any]:
    """The scheduled job: JustTCG when configured, else PriceCharting."""
    if isinstance(client, JustTcgClient) or (client is None and env.justtcg_api_key):
        return refresh_justtcg(conn, env, client=client)
    if isinstance(client, PriceChartingClient) or env.pricecharting_token:
        return refresh_pricecharting(conn, env, client=client)
    raise SourceNotApproved("JUSTTCG_API_KEY is not set (JustTCG paid plan)")


def _companies(value: Any) -> tuple[str, ...]:
    if isinstance(value, list):
        out = tuple(
            str(c).upper() for c in value if str(c).upper() in ("PSA", "BGS", "CGC", "SGC", "BCCG", "BVG")
        )
        if out:
            return out
    return DEFAULT_COMPANIES


def _due_sets(
    conn: Conn,
    games: tuple[JtGame, ...],
    listed: dict[str, list[dict[str, Any]]],
    refresh_hours: int,
    now: datetime,
) -> list[tuple[JtGame, dict[str, Any], bool]]:
    """(game, set, needs history backfill) for every set due a refresh, stalest first."""
    known: dict[tuple[str, str], tuple[datetime | None, datetime | None, bool]] = {}
    # Until JustTCG has stored a single price, every set is due (with history):
    # a run that fetched sets but stored nothing must not hold them back.
    priced = conn.execute(
        "select exists (select 1 from public.price_points where source = 'justtcg') as e"
    ).fetchone()
    if not (priced["e"] if isinstance(priced, dict) else priced[0]):
        for game in games:
            for s in listed.get(game.api_id, []):
                known.setdefault((game.api_id, s["id"]), (None, None, False))
        excluded_rows = conn.execute(
            "select justtcg_game, justtcg_set_id from public.justtcg_sets group by 1, 2 having bool_and(excluded)"
        ).fetchall()
        excluded = {
            (r["justtcg_game"], r["justtcg_set_id"]) if isinstance(r, dict) else (r[0], r[1])
            for r in excluded_rows
        }
        return [
            (g, s, True)
            for g in games
            for s in listed.get(g.api_id, [])
            if (g.api_id, s["id"]) not in excluded
        ]
    for r in conn.execute(
        """select justtcg_game, justtcg_set_id, max(refreshed_at) as refreshed_at,
                  max(history_backfilled_at) as backfilled_at, bool_and(excluded) as excluded
             from public.justtcg_sets group by justtcg_game, justtcg_set_id"""
    ):
        known[(r["justtcg_game"], r["justtcg_set_id"])] = (
            r["refreshed_at"],
            r["backfilled_at"],
            r["excluded"],
        )
    epoch = datetime.min.replace(tzinfo=UTC)
    due: list[tuple[datetime, JtGame, dict[str, Any], bool]] = []
    for game in games:
        for s in listed.get(game.api_id, []):
            refreshed, backfilled, excluded = known.get((game.api_id, s["id"]), (None, None, False))
            if excluded:
                continue
            if refreshed is None or now - refreshed >= timedelta(hours=refresh_hours):
                due.append((refreshed or epoch, game, s, backfilled is None))
    due.sort(key=lambda x: x[0])
    return [(g, s, b) for _, g, s, b in due]


def _mark_refreshed(conn: Conn, game: JtGame, s: dict[str, Any], *, backfilled: bool, now: datetime) -> None:
    """Record the fetch, including sets that produced no priced records yet
    (a placeholder row with no set, so they aren't fetched again until due)."""
    updated = conn.execute(
        """update public.justtcg_sets set refreshed_at = %(now)s,
                  history_backfilled_at = case when %(bf)s then coalesce(history_backfilled_at, %(now)s)
                                               else history_backfilled_at end
            where justtcg_game = %(g)s and justtcg_set_id = %(s)s""",
        {"now": now, "bf": backfilled, "g": game.api_id, "s": s["id"]},
    ).rowcount
    if not updated:
        conn.execute(
            """insert into public.justtcg_sets (justtcg_set_id, justtcg_game, game, lang, set_name, refreshed_at,
                 history_backfilled_at)
               values (%s, %s, %s, %s, %s, %s, %s) on conflict (justtcg_set_id, lang) do nothing""",
            (
                s["id"],
                game.api_id,
                game.game,
                game.lang or "en",
                str(s.get("name") or s["id"]),
                now,
                now if backfilled else None,
            ),
        )


def refresh_justtcg(
    conn: Conn, env: Env, *, client: JustTcgClient | None = None, now: datetime | None = None
) -> dict[str, Any]:
    """Fetch the stalest JustTCG sets within the run's request budget.

    Each run (every 4 hours) lists every game's sets, then fetches the sets
    whose prices are older than ``justtcg.refresh_hours`` (20), oldest first,
    until ``justtcg.max_requests_per_run`` is used. A set's first fetch also
    brings ``justtcg.history_window`` of price history to backfill charts.
    Work is committed set by set, so a stopped run loses nothing."""
    if client is None and not env.justtcg_api_key:
        raise SourceNotApproved("JUSTTCG_API_KEY is not set (JustTCG paid plan)")
    rules = load_rules(conn)
    extra = rules.extra
    now = now or datetime.now(UTC)
    games = games_from_setting(extra.get("justtcg.games"))
    companies = _companies(extra.get("justtcg.companies"))
    raw = extra.get("justtcg.raw_prices") is True
    window = extra.get("justtcg.history_window", "1y")
    window = window if window in HISTORY_WINDOWS else "1y"
    refresh_hours = _setting_int(extra, "justtcg.refresh_hours", 20)
    client = client or JustTcgClient(
        env.justtcg_api_key or "",
        user_agent=env.user_agent,
        max_requests=_setting_int(extra, "justtcg.max_requests_per_run", 1500),
    )
    with pipeline_run(conn, "prices") as stats:
        stats["source"] = "justtcg"
        stats["licence"] = asdict(justtcg_licence())
        fx = latest_usd_fx(
            conn, max_age_days=_setting_int(extra, "justtcg.fx_max_age_days", 7), today=now.date()
        )
        fx_history = FxHistory.load(conn)
        conn.commit()

        listed: dict[str, list[dict[str, Any]]] = {}
        errors: dict[str, str] = {}
        for game in games:
            try:
                listed[game.api_id] = client.sets(game.api_id)
            except BudgetExhausted:
                break
            except JustTcgError as exc:
                if exc.status in (401, 403) or exc.code in ("DAILY_LIMIT_EXCEEDED", "REQUEST_LIMIT_EXCEEDED"):
                    raise
                # e.g. a game id JustTCG doesn't recognise: skip it, keep the others.
                log.error("justtcg: listing sets for %s failed: %s", game.api_id, exc)
                errors[game.api_id] = str(exc)[:300]
        due = _due_sets(conn, games, listed, refresh_hours, now)
        stats["sets_listed"] = sum(len(v) for v in listed.values())
        stats["sets_due"] = len(due)

        ingestor = JtIngestor(conn, rules=rules, now=now)
        ingestor.load()
        done = 0
        stopped = None
        # What came back, so an empty import says why (no cards vs no graded variants vs no prices).
        cards_seen = 0
        variants_seen: Counter[str] = Counter()
        logged_sample = False
        for game, s, backfill in due:
            try:
                cards = list(
                    client.cards(game.api_id, s["id"], history=window if backfill else None, raw=raw)
                )
            except BudgetExhausted:
                stopped = "request budget used"
                break
            except JustTcgError as exc:
                if exc.status in (401, 403) or exc.code in ("DAILY_LIMIT_EXCEEDED", "REQUEST_LIMIT_EXCEEDED"):
                    stopped = str(exc)[:300]
                    log.error("justtcg: stopping: %s", exc)
                    break
                log.warning("justtcg: set %s/%s failed: %s", game.api_id, s["id"], exc)
                errors[f"{game.api_id}/{s['id']}"] = str(exc)[:300]
                conn.rollback()
                continue
            cards_seen += len(cards)
            for card in cards:
                for v in card.get("variants") or []:
                    if isinstance(v, dict):
                        variants_seen[str(v.get("type"))] += 1
            records = [(rec, game) for card in cards for rec in parse_card(card, game, companies)]
            if cards and not records and not logged_sample:
                # Cards came back but none parsed: show one (trimmed) so the cause is visible in the logs.
                logged_sample = True
                log.warning(
                    "justtcg: %s/%s returned %d cards but no usable prices; first card: %s",
                    game.api_id,
                    s["id"],
                    len(cards),
                    json.dumps(cards[0], default=str)[:1500],
                )
            ingestor.ingest(records, fx, fx_history=fx_history if backfill else None)
            # History counts as backfilled only once the set produced prices.
            _mark_refreshed(conn, game, s, backfilled=backfill and bool(records), now=now)
            conn.commit()
            done += 1
        stats["sets_refreshed"] = done
        stats["sets_remaining"] = len(due) - done
        stats["requests"] = client.requests
        stats["cards_seen"] = cards_seen
        stats["variants_seen"] = dict(variants_seen)
        if done and not cards_seen:
            log.warning(
                "justtcg: %d sets returned no cards; run python -m tcgworkers.sources.pricing.justtcg_probe",
                done,
            )
        if stopped:
            stats["stopped"] = stopped
        if errors:
            stats["errors"] = errors
        stats.update(stats_dict(ingestor.stats))
        stats["history"] = asdict(ingestor.history)
        stats["fx_date"] = fx.date.isoformat()
        stats["usd_to_aud"] = str(fx.rate_to_aud)
        log.info("justtcg: %s", {k: v for k, v in stats.items() if k != "licence"})
    return stats
