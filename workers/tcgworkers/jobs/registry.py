"""Scheduled jobs.

| job         | cadence (setting)                   | status                                  |
|-------------|-------------------------------------|-----------------------------------------|
| fx          | market.fx_refresh_hours (24h)       | live (RBA F11 with history, CC BY 4.0)  |
| population  | market.population_refresh_hours     | waiting on a licensed source (14.1)     |
| prices      | market.floor_refresh_hours (4h)     | JustTCG (needs JUSTTCG_API_KEY)          |
| floors      | market.floor_refresh_hours (4h)     | ready; needs price data                 |
| snapshots   | daily                               | ready; needs population + floors        |
| releases    | every 6h                            | release calendar: Bandai OC + AU retailer dates |
| images      | daily                               | Scrydex (SCRYDEX_API_KEY + SCRYDEX_TEAM_ID) |
| expiry      | hourly                              | ready                                   |
| listing_expiring | hourly                         | renewal reminders (listings.expiry_warning_days) |
| email       | every 20s                           | email_outbox sender (tcgworkers.email)  |
| drops_dispatch | every 15s                        | drop alert fan-out (drops.dispatcher)   |
| expire_sightings | every 5 min                     | pending member sightings expire (6h)    |
| release_reminders | daily 08:00 Australia/Sydney   | "out tomorrow" release reminders        |
| deals       | every 30 min                        | eBay Browse API deal finder (deals.enabled + EBAY_CLIENT_*) |

The drop monitors themselves are not scheduled jobs: they run continuously
in tcgworkers.drops.runner (one thread per enabled retailer).
"""

from __future__ import annotations

import functools
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx
import psycopg

from tcgworkers.config import Env
from tcgworkers.db import load_rules, pipeline_run
from tcgworkers.drops import kick
from tcgworkers.drops.push import PushSender, sender_from_env
from tcgworkers.email.providers import EmailProvider, provider_from_env
from tcgworkers.sources.ebay_deals import RUN_EVERY_MINUTES, BrowseClient, DealFinder
from tcgworkers.sources.fx.rba import F11_URL, parse_f11, parse_f11_history
from tcgworkers.sources.population.base import SourceNotApproved

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]


@dataclass(frozen=True)
class Job:
    name: str
    every_hours_setting: str | None
    every_hours_default: float
    run: Callable[[Conn, Env], object]
    every_seconds: float | None = None  # sub-hour jobs (email, drop dispatch)
    heartbeat_max_age: float | None = None  # seconds without success before the heartbeat fails
    # Fixed time of day instead of an interval: APScheduler cron fields, e.g.
    # {"hour": 8, "minute": 0, "timezone": "Australia/Sydney"}.
    cron: dict[str, Any] | None = None
    # Run as soon as this is set (and at least every ``every_seconds``), on its own thread.
    wake: threading.Event | None = None
    # Big batch jobs run in a child process (see main._run_isolated): their
    # memory is returned when they finish, and if one ever runs out of memory
    # only it is killed, never the drop monitor or the alert sender.
    isolated: bool = False


def refresh_fx(conn: Conn, user_agent: str) -> None:
    with pipeline_run(conn, "fx") as stats:
        r = httpx.get(F11_URL, headers={"User-Agent": user_agent}, timeout=30)
        r.raise_for_status()
        history = parse_f11_history(r.text)
        rates = parse_f11(r.text)
        with conn.cursor() as cur:
            # Past days once (historical prices convert at their own day's rate)...
            cur.executemany(
                """insert into public.fx_rates (currency, date, rate_to_aud, source)
                   values (%s, %s, %s, %s) on conflict (currency, date) do nothing""",
                [(x.currency, x.date, x.rate_to_aud, x.source) for x in history],
            )
            # ...and the latest day refreshed, in case the RBA revised it.
            cur.executemany(
                """insert into public.fx_rates (currency, date, rate_to_aud, source)
                   values (%s, %s, %s, %s)
                   on conflict (currency, date) do update set rate_to_aud = excluded.rate_to_aud,
                     fetched_at = now()""",
                [(x.currency, x.date, x.rate_to_aud, x.source) for x in rates],
            )
        stats["currencies"] = len(rates)
        stats["days"] = len({x.date for x in history})
        stats["date"] = max((r.date for r in rates), default=None)


def refresh_floors(conn: Conn, user_agent: str) -> None:
    """Recompute floor_prices from price_points + active listings.

    Marketplace asks come straight from active listings; external points from
    price_points. See tcgworkers.market.floor for the rules.

    Streamed one card+grade at a time through a server-side cursor, with
    writes in batches, so memory stays flat however many cards and prices the
    catalogue has (loading 120 days of every card's prices at once does not
    fit a small worker)."""
    from datetime import UTC, datetime

    from tcgworkers.db import load_rules
    from tcgworkers.market.floor import PricePoint, compute_floor

    rules = load_rules(conn)
    now = datetime.now(UTC)
    with pipeline_run(conn, "floors") as stats:
        written = 0
        batch: list[tuple[Any, ...]] = []

        def flush() -> None:
            if batch:
                with conn.cursor() as w:
                    w.executemany(FLOOR_UPSERT, batch)
                batch.clear()

        def add(points: list[PricePoint]) -> None:
            nonlocal written
            f = compute_floor(points, now=now, rules=rules)
            if f is None:
                return
            batch.append(
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
                )
            )
            written += 1
            if len(batch) >= FLOOR_BATCH:
                flush()

        key: tuple[str, str] | None = None
        points: list[PricePoint] = []
        with conn.cursor(name="floor_points") as cur:
            cur.itersize = FLOOR_FETCH
            cur.execute(
                """select card_id::text as card_id, grade_key, type::text as type, price_aud, source,
                          observed_at, is_excluded
                     from public.price_points where observed_at > now() - interval '120 days'
                   union all
                   select card_id::text, grade_key, 'ask', price_aud, 'marketplace', coalesce(approved_at, now()),
                          false
                     from public.listings where status = 'active' and card_id is not null
                   order by card_id, grade_key, observed_at"""
            )
            for r in cur:
                k = (r["card_id"], r["grade_key"])
                if k != key:
                    if points:
                        add(points)
                    key, points = k, []
                points.append(
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
        if points:
            add(points)
        flush()
        stats["floors"] = written


FLOOR_FETCH = 5000  # rows per round trip from the server-side cursor
FLOOR_BATCH = 500  # floors per write
FLOOR_UPSERT = """insert into public.floor_prices (card_id, grade_key, floor_aud, basis, source, sample_size,
     outliers_ignored, last_sold_aud, last_sold_at, median_sold_30d_aud, observed_at, computed_at)
   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
   on conflict (card_id, grade_key) do update set floor_aud=excluded.floor_aud,
     basis=excluded.basis, source=excluded.source, sample_size=excluded.sample_size,
     outliers_ignored=excluded.outliers_ignored, last_sold_aud=excluded.last_sold_aud,
     last_sold_at=excluded.last_sold_at, median_sold_30d_aud=excluded.median_sold_30d_aud,
     observed_at=excluded.observed_at, computed_at=now()"""


def snapshot_market_caps(conn: Conn, user_agent: str) -> None:
    """Daily snapshot of floor prices (value charts and 24h/7d/30d change),
    with market cap = population x floor where a population is known.

    Rankings read the current floors directly, so every priced card is
    ranked; snapshots are kept only for cards worth at least
    ``market.snapshot_min_aud`` (A$5), and snapshots older than 60 days are
    thinned to one a week (Mondays), so the table stays small however many
    cards the catalogue has."""
    extra = load_rules(conn).extra
    try:
        min_aud = Decimal(str(extra.get("market.snapshot_min_aud", 5)))
    except ArithmeticError:
        min_aud = Decimal(5)
    with pipeline_run(conn, "snapshots") as stats:
        cur = conn.execute(
            """insert into public.market_cap_snapshots
                 (card_id, grade_key, date, population, floor_aud, basis, market_cap_aud, fx_date)
               select f.card_id, f.grade_key, (now() at time zone 'Australia/Melbourne')::date, p.population,
                      f.floor_aud, f.basis, round(p.population * f.floor_aud, 2),
                      (select max(date) from public.fx_rates)
                 from public.floor_prices f
                 left join public.population_current p on p.card_id = f.card_id and p.grade_key = f.grade_key
                where f.floor_aud >= %s
               on conflict (card_id, grade_key, date) do update set population = excluded.population,
                 floor_aud = excluded.floor_aud, basis = excluded.basis,
                 market_cap_aud = excluded.market_cap_aud, fx_date = excluded.fx_date""",
            (min_aud,),
        )
        stats["rows"] = cur.rowcount
        cur = conn.execute(
            """delete from public.market_cap_snapshots
                where date < (now() at time zone 'Australia/Melbourne')::date - 60
                  and extract(isodow from date) <> 1"""
        )
        stats["thinned"] = cur.rowcount
        conn.execute("refresh materialized view concurrently public.market_cap_rankings")


def expire_listings(conn: Conn, user_agent: str) -> None:
    with pipeline_run(conn, "expiry") as stats:
        cur = conn.execute(
            "update public.listings set status = 'expired' where status = 'active' and expires_at < now()"
        )
        stats["expired"] = cur.rowcount


def warn_expiring_listings(conn: Conn, user_agent: str) -> None:
    """Queue a 'listing_expiring' reminder (on-site + email, per the seller's
    preferences) for active listings expiring within
    listings.expiry_warning_days. Deduplicated per listing per expiry date, so
    a renewed listing gets a fresh reminder before its new expiry."""
    with pipeline_run(conn, "listing_expiring") as stats:
        rows = conn.execute(
            """with due as (
                 select l.id, l.seller_id, l.title, l.price_aud, l.expires_at,
                        'listing_expiring:' || l.id || ':'
                          || to_char(l.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as dkey
                   from public.listings l
                  where l.status = 'active' and l.expires_at is not null and l.expires_at > now()
                    and l.expires_at <= now() + make_interval(
                          days => coalesce(public.setting_int('listings.expiry_warning_days'), 5)))
               select d.id,
                      public.notify(
                        d.seller_id, 'listing_expiring', 'Your listing expires soon: ' || d.title, d.title,
                        '/account/listings/',
                        jsonb_build_object('listing_id', d.id, 'listing_title', d.title, 'expires_at', d.expires_at,
                                           'price_aud', d.price_aud, 'dedupe', d.dkey),
                        'listing_expiring', d.dkey)::text as queued
                 from due d
                where not exists (select 1 from public.email_outbox o where o.dedupe_key = d.dkey)
                  and not exists (select 1 from public.notifications n
                                   where n.user_id = d.seller_id and n.type = 'listing_expiring'
                                     and n.data ->> 'dedupe' = d.dkey)"""
        ).fetchall()
        stats["warned"] = len(rows)


def send_emails(conn: Conn, env: Env) -> object:
    from tcgworkers.email.sender import run_sender

    return run_sender(
        conn,
        email_provider(env),
        site_url=env.site_url,
        from_override=env.email_from,
        admin_email=env.admin_alert_email,
    )


def dispatch_drops(conn: Conn, env: Env) -> object:
    from tcgworkers.drops.dispatcher import run_dispatcher

    result = run_dispatcher(
        conn,
        site_url=env.site_url,
        discord_webhook_url=env.discord_drops_webhook_url,
        admin_email=env.admin_alert_email,
        push_sender=push_sender(env),
        supabase_url=env.supabase_url,
    )
    if result.emails_queued:
        # Premium alerts are instant: send now rather than waiting for the
        # next email tick. SKIP LOCKED makes the overlap with that job safe.
        send_emails(conn, env)
    return result


@functools.lru_cache(maxsize=4)
def email_provider(env: Env) -> EmailProvider:
    """One provider per process (the SMTP/HTTP settings don't change)."""
    return provider_from_env(env)


@functools.lru_cache(maxsize=4)
def push_sender(env: Env) -> PushSender | None:
    """None until VAPID_PRIVATE_KEY and VAPID_SUBJECT are set."""
    return sender_from_env(env.vapid_private_key, env.vapid_subject)


def expire_sightings(conn: Conn, env: Env) -> int:
    """Pending member sightings nobody confirmed expire after
    sightings.pending_expiry_minutes (6h). Runs every 5 minutes, so it is
    logged only when something expired rather than recorded in pipeline_runs."""
    row = conn.execute("select public.expire_sightings() as n").fetchone()
    conn.commit()
    n = int(row["n"]) if row else 0
    if n:
        log.info("expire_sightings: %d pending sightings expired", n)
    return n


def send_release_reminders(conn: Conn, env: Env) -> None:
    """Reminders for releases out tomorrow (on-site + email template
    ``release``, per each member's preferences). Idempotent: each reminder
    row is marked sent."""
    with pipeline_run(conn, "release_reminders") as stats:
        row = conn.execute("select public.send_release_reminders() as n").fetchone()
        stats["sent"] = int(row["n"]) if row else 0


@functools.lru_cache(maxsize=4)
def deal_finder(env: Env) -> DealFinder | None:
    """One per process: keeps the eBay OAuth token and miss counts."""
    if not env.ebay_client_id or not env.ebay_client_secret:
        return None
    return DealFinder(BrowseClient(env.ebay_client_id, env.ebay_client_secret))


def find_ebay_deals(conn: Conn, env: Env) -> object:
    from tcgworkers.sources.ebay_deals import DealStore, ready_settings

    finder = deal_finder(env)
    settings = ready_settings(conn, finder)
    if settings is None or finder is None:
        return None
    with pipeline_run(conn, "deals") as stats:
        stats.update(finder.run(DealStore(conn), settings))
    return stats


def prices_job(conn: Conn, env: Env) -> None:
    from tcgworkers.jobs.prices import refresh_prices

    refresh_prices(conn, env)


def images_job(conn: Conn, env: Env) -> None:
    from tcgworkers.jobs.images import refresh_images

    refresh_images(conn, env)


def releases_job(conn: Conn, env: Env) -> None:
    from tcgworkers.jobs.releases import refresh_releases

    refresh_releases(conn, env)


def not_approved(what: str) -> Callable[[Conn, Env], None]:
    def run(conn: Conn, env: Env) -> None:
        raise SourceNotApproved(f"{what} source not approved yet - see docs/research")

    return run


def _ua(fn: Callable[[Conn, str], None]) -> Callable[[Conn, Env], None]:
    def run(conn: Conn, env: Env) -> None:
        fn(conn, env.user_agent)

    return run


JOBS: tuple[Job, ...] = (
    Job("fx", "market.fx_refresh_hours", 24, _ua(refresh_fx)),
    Job("population", "market.population_refresh_hours", 24, not_approved("population")),
    Job("prices", "market.floor_refresh_hours", 4, prices_job, isolated=True),
    Job("floors", "market.floor_refresh_hours", 4, _ua(refresh_floors), isolated=True),
    Job("images", None, 24, images_job, isolated=True),
    Job("snapshots", None, 24, _ua(snapshot_market_caps)),
    # Release calendar: Bandai (One Piece, Oceania) + Australian retailer street dates.
    Job("releases", None, 6, releases_job),
    Job("expiry", None, 1, _ua(expire_listings)),
    Job("listing_expiring", None, 1, _ua(warn_expiring_listings)),
    Job("email", None, 0, send_emails, every_seconds=20, heartbeat_max_age=300),
    # Woken by the monitor the moment it saves a drop; polls every 5 s for everything else.
    Job(
        "drops_dispatch", None, 0, dispatch_drops, every_seconds=5, heartbeat_max_age=300, wake=kick.DISPATCH
    ),
    Job("expire_sightings", None, 0, expire_sightings, every_seconds=300),
    Job(
        "release_reminders",
        None,
        24,
        send_release_reminders,
        cron={"hour": 8, "minute": 0, "timezone": "Australia/Sydney"},
    ),
    # The call budget in sources/ebay_deals.py assumes this cadence.
    Job("deals", None, RUN_EVERY_MINUTES / 60, find_ebay_deals),
)
