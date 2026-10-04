"""24/7 drop monitor runner.

One supervisor thread plus one worker thread per ENABLED ``public.retailers``
row. Each worker runs its adapter (``drops.base.REGISTRY``) on the retailer's
``watch_interval_seconds`` (watchlist) and ``discovery_interval_seconds``
(broad discovery), with jitter, through ``drops.engine.run_cycle`` and a
``PostgresDropStore``.

Isolation: every cycle is wrapped, so an adapter raising, a retailer blocking
us, or a DB error only affects that retailer's cycle; it is logged (Sentry
picks up ERROR logs), counted in the retailer's health columns and, after
``drops.zero_product_alert_cycles`` bad cycles, an admin alert email is
queued (deduplicated per retailer per 6 hours). A worker thread that dies is
restarted by the supervisor.

Hot reload: the supervisor re-reads ``retailers`` every 5 minutes, so an admin
can enable/disable a retailer or change its intervals without a redeploy.

Adapters: a retailer with its own registered module (``drops.base.REGISTRY``,
matched by slug, e.g. JB Hi-Fi's Algolia monitor) keeps it. Otherwise a row
with platform / adapter ``shopify`` or ``woocommerce`` gets the generic
catalogue adapter built from the row (slug, name, base_url, config), with a
slower polite client (>= 5 s between requests to the host, more if robots.txt
asks). Every cycle stamps ``retailers.last_checked_at`` and sets
``blocked_reason`` when the adapter raises ``AdapterBlocked`` (or robots.txt
disallows it), clearing it after a clean cycle.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
import random
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any

from tcgworkers.alerts import queue_admin_alert
from tcgworkers.db import connect, load_rules
from tcgworkers.drops.adapters.catalogue import CatalogueAdapter
from tcgworkers.drops.adapters.shopify import ShopifyAdapter
from tcgworkers.drops.adapters.woocommerce import WooCommerceAdapter
from tcgworkers.drops.base import REGISTRY, AdapterBlocked, RetailerAdapter
from tcgworkers.drops.engine import CycleResult, run_cycle
from tcgworkers.drops.http import BackingOff, Disallowed, PoliteClient, RobotsUnreadable, SharedGate
from tcgworkers.drops.kick import wake_dispatcher
from tcgworkers.drops.models import Observation
from tcgworkers.drops.products import Catalogue, load_catalogue
from tcgworkers.drops.store import (
    KEEP,
    PostgresDropStore,
    is_first_scan,
    load_rrp_entries,
    load_watch_rules,
    mark_checked,
)

log = logging.getLogger(__name__)

RELOAD_SECONDS = 300.0
CATALOGUE_TTL = 600.0
ALERT_WINDOW = timedelta(hours=6)
# A store that refuses us (robots.txt, 403, challenge) is never worked around:
# it is retried every 6 hours, and the admin is told at most once a week.
BLOCKED_RETRY_SECONDS = 6 * 3600.0
BLOCKED_ALERT_WINDOW = timedelta(days=7)
GENERIC: dict[str, type[CatalogueAdapter]] = {"shopify": ShopifyAdapter, "woocommerce": WooCommerceAdapter}
# Generic stores: at most one request per ~5 s per host (robots Crawl-delay can raise it).
GENERIC_MIN_DELAY = 5.0
GENERIC_MAX_DELAY = 8.0
# All Shopify stores share one request budget from our one IP, so 40 stores
# never look like 40 separate crawlers. Measured (Oct 2026): Shopify refuses a
# second request to the SAME shop within ~3 s (each shop is paced 5-8 s
# apart below), but requests to different shops 1-2 s apart are accepted.
# So the shared spacing starts at 2 s and tunes itself between 1 s and 60 s
# (x1.5 on every 429/503, 3% faster per success). Each shop still sees about
# one request a minute: a full round of every store's first pages takes
# ~1.5 minutes instead of ~5 at the old 3-10 s spacing.
SHOPIFY_GATE_SECONDS = 2.0
SHOPIFY_GATE = SharedGate("shopify", SHOPIFY_GATE_SECONDS, floor=1.0, ceiling=60.0)


@dataclass(frozen=True)
class RetailerConfig:
    id: str
    slug: str
    name: str
    adapter: str
    watch_interval: float
    discovery_interval: float
    platform: str = "custom"
    base_url: str = ""
    config: Mapping[str, Any] = field(default_factory=dict)

    @property
    def generic(self) -> str | None:
        """'shopify' / 'woocommerce' when this row uses a generic adapter."""
        if self.slug in REGISTRY:
            return None
        for name in (self.adapter, self.platform):
            if name in GENERIC:
                return name
        return None


CycleFn = Callable[[RetailerConfig, str, RetailerAdapter, PoliteClient], CycleResult]
AlertFn = Callable[[str, str, str, dict[str, Any]], None]


def load_adapters() -> None:
    """Import every module in drops/adapters so each @register runs."""
    import tcgworkers.drops.adapters as pkg

    for mod in pkgutil.iter_modules(pkg.__path__):
        importlib.import_module(f"{pkg.__name__}.{mod.name}")


def adapter_for(cfg: RetailerConfig) -> RetailerAdapter:
    load_adapters()
    generic = cfg.generic
    if generic:
        return GENERIC[generic](slug=cfg.slug, name=cfg.name, base_url=cfg.base_url, config=cfg.config)
    cls = REGISTRY.get(cfg.slug) or REGISTRY.get(cfg.adapter.replace("_", "-"))
    if cls is None:
        raise LookupError(f"no adapter registered for retailer {cfg.slug!r} (adapter {cfg.adapter!r})")
    return cls()


def client_for(cfg: RetailerConfig, user_agent: str) -> PoliteClient:
    if cfg.generic:
        return PoliteClient(
            user_agent=user_agent,
            min_delay=GENERIC_MIN_DELAY,
            max_delay=GENERIC_MAX_DELAY,
            gate=SHOPIFY_GATE if cfg.generic == "shopify" else None,
        )
    return PoliteClient(user_agent=user_agent)


def blocked_reason(observations: list[Observation] | Exception) -> object:
    """What retailers.blocked_reason should become after this cycle."""
    if isinstance(observations, AdapterBlocked):
        return str(observations) or "blocked"
    if isinstance(observations, RobotsUnreadable):
        return f"blocked: {observations}"
    if isinstance(observations, Disallowed):
        return f"robots: robots.txt disallows {observations}"
    if isinstance(observations, Exception):
        return KEEP  # transient (backing off, network, parser): leave it as it was
    return None


def fetch(
    adapter: RetailerAdapter, client: PoliteClient, mode: str, watch_urls: list[str]
) -> list[Observation] | Exception:
    """Run the adapter; an exception is returned (not raised) for run_cycle."""
    try:
        if mode == "watch":
            return list(adapter.watch(client, watch_urls))
        return list(adapter.discover(client))
    except (BackingOff, Disallowed, AdapterBlocked) as exc:
        log.warning("drops %s %s: %s", adapter.slug, mode, exc)
        return exc
    except Exception as exc:
        log.exception("drops %s %s: adapter raised", adapter.slug, mode)
        return exc


# --------------------------------------------------------------- production
@dataclass
class PostgresCycle:
    """One cycle against the database. A fresh connection per cycle keeps
    workers independent and survives dropped connections."""

    database_url: str
    admin_email: str | None = None
    _catalogue: tuple[float, Catalogue] | None = field(default=None, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def load_retailers(self) -> list[RetailerConfig]:
        with connect(self.database_url) as conn:
            rows = conn.execute(
                """select id::text as id, slug, name, adapter, watch_interval_seconds, discovery_interval_seconds,
                          platform, base_url, config
                     from public.retailers where enabled order by slug"""
            ).fetchall()
        return [
            RetailerConfig(
                r["id"],
                r["slug"],
                r["name"],
                r["adapter"],
                float(r["watch_interval_seconds"]),
                float(r["discovery_interval_seconds"]),
                r["platform"],
                r["base_url"],
                r["config"] if isinstance(r["config"], dict) else {},
            )
            for r in rows
        ]

    def catalogue(self, conn: Any) -> Catalogue:
        """The matcher's set catalogue, shared by all workers, reloaded every 10 minutes."""
        with self._lock:
            now = time.monotonic()
            if self._catalogue is None or now - self._catalogue[0] > CATALOGUE_TTL:
                self._catalogue = (now, load_catalogue(conn))
            return self._catalogue[1]

    def alert(self, key: str, title: str, body: str, details: dict[str, Any]) -> None:
        with connect(self.database_url) as conn:
            queue_admin_alert(
                conn, self.admin_email, key=key, title=title, body=body, details=details, window=ALERT_WINDOW
            )

    def __call__(
        self, cfg: RetailerConfig, mode: str, adapter: RetailerAdapter, client: PoliteClient
    ) -> CycleResult:
        with connect(self.database_url) as conn:
            rules = load_rules(conn)
            rrp = load_rrp_entries(conn)
            watch = load_watch_rules(conn, cfg.id)
            baseline = is_first_scan(conn, cfg.id)
            catalogue = self.catalogue(conn)
            conn.commit()
        # Fetch with no connection open: a polite fetch can take minutes, and
        # dozens of monitors each holding one would exhaust the pooler.
        urls = [r.value for r in watch if r.kind in ("url", "sku")]
        observations = fetch(adapter, client, mode, urls)
        now = datetime.now(UTC)
        with connect(self.database_url) as conn:
            try:
                result = run_cycle(
                    cfg.slug,
                    observations,
                    PostgresDropStore(conn, cfg.id, baseline=baseline, catalogue=catalogue, rrp_entries=rrp),
                    rules=rules,
                    rrp_entries=rrp,
                    watchlist=watch,
                    now=now,
                )
                conn.commit()
                if result.new_events and not baseline:
                    wake_dispatcher()  # alert members now, not on the next dispatcher poll
                if baseline and result.new_events:
                    log.info(
                        "drops %s: first scan stored %d products as a baseline (%d events suppressed)",
                        cfg.slug,
                        result.tcg,
                        len(result.new_events),
                    )
            except Exception as exc:
                conn.rollback()
                log.exception("drops %s %s: storing the cycle failed", cfg.slug, mode)
                health = PostgresDropStore(conn, cfg.id).record_health(
                    cfg.slug, ok=False, products=0, error=f"store: {exc}", at=now
                )
                conn.commit()
                result = CycleResult(
                    cfg.slug,
                    0,
                    0,
                    [],
                    health,
                    health.needs_alert(rules.drops_zero_product_alert_cycles),
                    str(exc),
                )
            reason = blocked_reason(observations)
            if reason is not None and reason is not KEEP:
                result = replace(result, blocked=True)
            try:
                mark_checked(conn, cfg.id, at=now, blocked_reason=reason)
                conn.commit()
            except Exception:
                conn.rollback()
                log.exception("drops %s: could not stamp last_checked_at", cfg.slug)
            if result.alert_admin:
                h = result.health
                why = (
                    f"{h.consecutive_errors} failed cycles in a row"
                    if h.consecutive_errors
                    else f"{h.zero_product_cycles} cycles with zero TCG products"
                )
                if result.blocked:
                    why = (
                        f"the store refuses our bot ({reason}). We stay out and retry every "
                        "6 hours; members' sightings cover it meanwhile"
                    )
                queue_admin_alert(
                    conn,
                    self.admin_email,
                    key=f"retailer:{cfg.slug}",
                    title=f"Drop monitor for {cfg.name} needs attention",
                    body=f"{cfg.name} ({cfg.slug}): {why}. Last error: {result.error or 'none'}",
                    details={
                        "retailer": cfg.slug,
                        "mode": mode,
                        "consecutive_errors": h.consecutive_errors,
                        "zero_product_cycles": h.zero_product_cycles,
                        "last_error": result.error or "",
                    },
                    window=BLOCKED_ALERT_WINDOW if result.blocked else ALERT_WINDOW,
                )
            return result


# ------------------------------------------------------------------ workers
@dataclass
class RetailerWorker:
    cfg: RetailerConfig
    adapter: RetailerAdapter
    client: PoliteClient
    cycle: CycleFn
    stop_event: threading.Event
    clock: Callable[[], float] = time.monotonic
    rng: random.Random = field(default_factory=random.Random)
    cycles: int = 0
    failures: int = 0
    last_cycle_at: float | None = None
    last_result: CycleResult | None = None
    thread: threading.Thread | None = None

    def _jittered(self, seconds: float) -> float:
        return seconds * self.rng.uniform(0.9, 1.1)

    def run_once(self, mode: str) -> CycleResult | None:
        """One isolated cycle: never raises."""
        result: CycleResult | None = None
        try:
            result = self.cycle(self.cfg, mode, self.adapter, self.client)
        except Exception:
            self.failures += 1
            log.exception("drops %s %s: cycle crashed", self.cfg.slug, mode)
        if result is not None:
            self.last_result = result
            if result.error:
                self.failures += 1
            else:
                log.info(
                    "drops %s %s: seen=%d tcg=%d events=%d",
                    self.cfg.slug,
                    mode,
                    result.seen,
                    result.tcg,
                    len(result.new_events),
                )
        self.cycles += 1
        self.last_cycle_at = self.clock()
        return result

    def run(self) -> None:
        now = self.clock()
        # Stagger start-up across a whole interval so retailers don't all fire at once.
        next_discovery = now + self.rng.uniform(0, self.cfg.watch_interval)
        next_watch = next_discovery + self._jittered(self.cfg.watch_interval)
        while not self.stop_event.is_set():
            now = self.clock()
            result = None
            if now >= next_discovery:
                result = self.run_once("discovery")
                done = self.clock()
                next_discovery = done + self._jittered(self.cfg.discovery_interval)
                next_watch = done + self._jittered(self.cfg.watch_interval)  # discovery covered the watchlist
            elif now >= next_watch:
                result = self.run_once("watch")
                next_watch = self.clock() + self._jittered(self.cfg.watch_interval)
            if result is not None and result.blocked:
                next_discovery = next_watch = self.clock() + BLOCKED_RETRY_SECONDS
            wait = min(next_watch, next_discovery) - self.clock()
            self.stop_event.wait(max(0.01, min(wait, 5.0)))

    def start(self) -> None:
        self.thread = threading.Thread(target=self._safe_run, name=f"drops-{self.cfg.slug}", daemon=True)
        self.thread.start()

    def _safe_run(self) -> None:
        try:
            self.run()
        except BaseException:
            log.exception("drops %s: worker thread died", self.cfg.slug)
            raise

    def alive(self) -> bool:
        return self.thread is not None and self.thread.is_alive()


@dataclass
class DropRunner:
    load_retailers: Callable[[], list[RetailerConfig]]
    cycle: CycleFn
    make_adapter: Callable[[RetailerConfig], RetailerAdapter] = adapter_for
    make_client: Callable[[RetailerConfig], PoliteClient] = field(
        default=lambda cfg: PoliteClient(
            user_agent="TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/)"
        )
    )
    alert: AlertFn | None = None
    reload_seconds: float = RELOAD_SECONDS
    tick_seconds: float = 1.0
    clock: Callable[[], float] = time.monotonic
    workers: dict[str, tuple[RetailerWorker, threading.Event]] = field(default_factory=dict)
    last_tick: float = 0.0
    last_reload_ok: float = 0.0
    _next_reload: float = 0.0
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    # -------------------------------------------------------------- config
    def reload(self) -> None:
        try:
            configs = {c.slug: c for c in self.load_retailers()}
        except Exception:
            log.exception("drops runner: could not load retailers; keeping current workers")
            return
        self.last_reload_ok = self.clock()
        for slug in list(self.workers):
            worker, _ = self.workers[slug]
            if slug not in configs:
                log.info("drops runner: %s disabled; stopping", slug)
                self._stop_worker(slug)
            elif configs[slug] != worker.cfg:
                log.info("drops runner: %s config changed; restarting", slug)
                self._stop_worker(slug)
        for slug, cfg in configs.items():
            if slug not in self.workers:
                self._start_worker(cfg)

    def _start_worker(self, cfg: RetailerConfig) -> None:
        try:
            adapter = self.make_adapter(cfg)
            client = self.make_client(cfg)
        except Exception as exc:
            log.exception("drops runner: cannot start %s", cfg.slug)
            if self.alert:
                try:
                    self.alert(
                        f"retailer-start:{cfg.slug}",
                        f"Drop monitor for {cfg.name} cannot start",
                        f"{cfg.name} ({cfg.slug}) is enabled but its adapter could not start: {exc}",
                        {"retailer": cfg.slug, "adapter": cfg.adapter, "error": str(exc)},
                    )
                except Exception:
                    log.exception("drops runner: admin alert failed")
            return
        stop = threading.Event()
        worker = RetailerWorker(cfg, adapter, client, self.cycle, stop, clock=self.clock)
        worker.start()
        self.workers[cfg.slug] = (worker, stop)
        log.info(
            "drops runner: started %s (watch %.0fs, discovery %.0fs)",
            cfg.slug,
            cfg.watch_interval,
            cfg.discovery_interval,
        )

    def _stop_worker(self, slug: str) -> None:
        _, stop = self.workers.pop(slug)
        stop.set()  # the worker finishes its current cycle and exits

    # ---------------------------------------------------------- supervisor
    def tick(self) -> None:
        now = self.clock()
        if now >= self._next_reload:
            self.reload()
            self._next_reload = now + self.reload_seconds
        for slug, (worker, _) in list(self.workers.items()):
            if not worker.alive():
                log.error("drops runner: worker %s is not running; restarting", slug)
                self.workers.pop(slug)
                self._start_worker(worker.cfg)
        self.last_tick = self.clock()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:
                log.exception("drops runner: supervisor tick failed")
            self._stop.wait(self.tick_seconds)

    def start(self) -> threading.Thread:
        self._thread = threading.Thread(target=self._loop, name="drops-supervisor", daemon=True)
        self._thread.start()
        return self._thread

    def stop(self, timeout: float = 30.0) -> None:
        self._stop.set()
        for slug in list(self.workers):
            worker, stop = self.workers[slug]
            stop.set()
        for worker, _ in list(self.workers.values()):
            if worker.thread:
                worker.thread.join(timeout)
        if self._thread:
            self._thread.join(timeout)

    def problem(self) -> str | None:
        """Heartbeat check: None when healthy."""
        now = self.clock()
        if self._thread is None or not self._thread.is_alive():
            return "supervisor thread is not running"
        if now - self.last_tick > 120:
            return f"supervisor has not ticked for {now - self.last_tick:.0f}s"
        if now - self.last_reload_ok > 3 * self.reload_seconds + 60:
            return "retailer config could not be loaded from the database"
        dead = [s for s, (w, _) in self.workers.items() if not w.alive()]
        if dead:
            return "worker threads not running: " + ", ".join(dead)
        return None


def build_runner(database_url: str, *, user_agent: str, admin_email: str | None) -> DropRunner:
    cycle = PostgresCycle(database_url, admin_email)
    return DropRunner(
        load_retailers=cycle.load_retailers,
        cycle=cycle,
        make_client=lambda cfg: client_for(cfg, user_agent),
        alert=cycle.alert,
    )


def run_all_once(
    database_url: str, *, user_agent: str, admin_email: str | None, mode: str = "discovery"
) -> dict[str, str]:
    """``--once drops_runner``: one cycle per enabled retailer, isolated."""
    cycle = PostgresCycle(database_url, admin_email)
    out: dict[str, str] = {}
    for cfg in cycle.load_retailers():
        try:
            adapter = adapter_for(cfg)
        except (LookupError, ValueError) as exc:
            log.error("%s", exc)
            out[cfg.slug] = f"error: {exc}"
            continue
        worker = RetailerWorker(cfg, adapter, client_for(cfg, user_agent), cycle, threading.Event())
        result = worker.run_once(mode)
        out[cfg.slug] = (
            "crashed"
            if result is None
            else f"error: {result.error}"
            if result.error
            else f"ok: seen={result.seen} tcg={result.tcg} events={len(result.new_events)}"
        )
    return out
