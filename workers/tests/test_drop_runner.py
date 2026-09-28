from __future__ import annotations

import threading
import time
from collections.abc import Iterable
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest

from tcgworkers.config import Rules
from tcgworkers.drops.base import RetailerAdapter
from tcgworkers.drops.engine import CycleResult, InMemoryStore, run_cycle
from tcgworkers.drops.http import BackingOff, PoliteClient
from tcgworkers.drops.models import Availability, Observation
from tcgworkers.drops.runner import DropRunner, RetailerConfig, RetailerWorker, adapter_for, fetch
from tcgworkers.health import Heartbeat, ping_once

GOOD = RetailerConfig("id-good", "good-shop", "Good Shop", "good_shop", 0.05, 0.2)
BAD = RetailerConfig("id-bad", "bad-shop", "Bad Shop", "bad_shop", 0.05, 0.2)


class GoodAdapter(RetailerAdapter):
    slug = "good-shop"
    name = "Good Shop"

    def __init__(self) -> None:
        self.calls = 0

    def discover(self, client: PoliteClient) -> Iterable[Observation]:
        self.calls += 1
        yield Observation(
            retailer=self.slug,
            sku="etb-1",
            url="https://good.example/etb-1",
            title="Pokemon TCG Surging Sparks Elite Trainer Box",
            availability=Availability.IN_STOCK_ONLINE if self.calls > 1 else Availability.OUT_OF_STOCK,
            price_aud=Decimal("89.00"),
            observed_at=datetime.now(UTC),
        )


class BadAdapter(RetailerAdapter):
    slug = "bad-shop"
    name = "Bad Shop"

    def __init__(self) -> None:
        self.calls = 0

    def discover(self, client: PoliteClient) -> Iterable[Observation]:
        self.calls += 1
        raise RuntimeError("retailer changed its API")


class Harness:
    """In-memory stand-in for PostgresCycle."""

    def __init__(self) -> None:
        self.stores: dict[str, InMemoryStore] = {}
        self.results: dict[str, list[CycleResult]] = {}
        self.lock = threading.Lock()
        self.alerts: list[str] = []

    def __call__(
        self, cfg: RetailerConfig, mode: str, adapter: RetailerAdapter, client: PoliteClient
    ) -> CycleResult:
        observations = fetch(adapter, client, mode, [])
        with self.lock:
            store = self.stores.setdefault(cfg.slug, InMemoryStore())
            result = run_cycle(
                cfg.slug,
                observations,
                store,
                rules=Rules(drops_zero_product_alert_cycles=2),
                now=datetime.now(UTC),
            )
            self.results.setdefault(cfg.slug, []).append(result)
            if result.alert_admin:
                self.alerts.append(cfg.slug)
        return result


def _client(cfg: RetailerConfig) -> PoliteClient:
    return PoliteClient(user_agent="test")


def _wait_for(condition, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.02)
    raise AssertionError("condition not met in time")


def test_run_once_isolates_an_adapter_that_raises():
    harness = Harness()
    bad = RetailerWorker(BAD, BadAdapter(), _client(BAD), harness, threading.Event())
    good = RetailerWorker(GOOD, GoodAdapter(), _client(GOOD), harness, threading.Event())
    for _ in range(2):
        assert bad.run_once("discovery") is not None  # returned, not raised
        good.run_once("discovery")
    assert bad.failures == 2 and harness.results["bad-shop"][-1].error == "retailer changed its API"
    assert good.failures == 0
    events = [e.event_type.value for e in harness.stores["good-shop"].events.values()]
    assert events == ["NEW_LISTING", "IN_STOCK"]
    # Two failed cycles >= threshold -> admin alert for the bad retailer only.
    assert harness.alerts == ["bad-shop"]


def test_run_once_survives_the_cycle_itself_crashing():
    def exploding(*args: Any) -> CycleResult:
        raise ConnectionError("database unreachable")

    worker = RetailerWorker(GOOD, GoodAdapter(), _client(GOOD), exploding, threading.Event())
    assert worker.run_once("watch") is None
    assert worker.failures == 1 and worker.cycles == 1


def test_backing_off_is_reported_as_a_failed_cycle_not_raised():
    class Throttled(GoodAdapter):
        def discover(self, client: PoliteClient) -> Iterable[Observation]:
            raise BackingOff("https://x.example", 0)

    result = fetch(Throttled(), _client(GOOD), "discovery", [])
    assert isinstance(result, BackingOff)


def test_runner_threads_keep_the_good_retailer_running_while_another_fails():
    harness = Harness()
    adapters = {"good-shop": GoodAdapter(), "bad-shop": BadAdapter()}
    runner = DropRunner(
        load_retailers=lambda: [BAD, GOOD],
        cycle=harness,
        make_adapter=lambda cfg: adapters[cfg.slug],
        make_client=_client,
        tick_seconds=0.02,
    )
    runner.start()
    try:
        _wait_for(lambda: adapters["good-shop"].calls >= 3 and adapters["bad-shop"].calls >= 3)
        assert runner.problem() is None
    finally:
        runner.stop(timeout=5)
    assert all(r.error is None for r in harness.results["good-shop"])
    assert all(r.error for r in harness.results["bad-shop"])
    assert len(harness.stores["good-shop"].events) == 2


def test_hot_reload_starts_and_stops_retailers():
    harness = Harness()
    enabled = [GOOD]
    runner = DropRunner(
        load_retailers=lambda: list(enabled),
        cycle=harness,
        make_adapter=lambda cfg: GoodAdapter() if cfg.slug == "good-shop" else BadAdapter(),
        make_client=_client,
        reload_seconds=0.05,
        tick_seconds=0.02,
    )
    runner.start()
    try:
        _wait_for(lambda: set(runner.workers) == {"good-shop"})
        enabled.append(BAD)
        _wait_for(lambda: set(runner.workers) == {"good-shop", "bad-shop"})
        enabled.remove(GOOD)
        _wait_for(lambda: set(runner.workers) == {"bad-shop"})
    finally:
        runner.stop(timeout=5)


def test_config_load_failure_keeps_running_workers():
    harness = Harness()
    calls = {"n": 0}

    def load() -> list[RetailerConfig]:
        calls["n"] += 1
        if calls["n"] > 1:
            raise ConnectionError("db down")
        return [GOOD]

    runner = DropRunner(
        load,
        harness,
        make_adapter=lambda cfg: GoodAdapter(),
        make_client=_client,
        reload_seconds=0.05,
        tick_seconds=0.02,
    )
    runner.start()
    try:
        _wait_for(lambda: calls["n"] >= 3)
        assert set(runner.workers) == {"good-shop"}
    finally:
        runner.stop(timeout=5)


def test_missing_adapter_raises_an_admin_alert_but_others_start():
    alerts: list[str] = []
    runner = DropRunner(
        load_retailers=lambda: [GOOD, RetailerConfig("id-n", "nowhere-au", "Nowhere", "nowhere_au", 90, 300)],
        cycle=Harness(),
        make_adapter=lambda cfg: GoodAdapter() if cfg.slug == "good-shop" else adapter_for(cfg),
        make_client=_client,
        alert=lambda key, title, body, details: alerts.append(key),
    )
    runner.reload()
    try:
        assert set(runner.workers) == {"good-shop"}
        assert alerts == ["retailer-start:nowhere-au"]
    finally:
        runner.stop(timeout=5)


def test_adapter_lookup_matches_registry_by_slug():
    cfg = RetailerConfig("id", "jb-hi-fi", "JB Hi-Fi", "jb_hi_fi", 90, 300)
    assert adapter_for(cfg).slug == "jb-hi-fi"
    with pytest.raises(LookupError):
        adapter_for(RetailerConfig("id", "nowhere", "Nowhere", "nowhere", 90, 300))


def test_dead_worker_is_restarted():
    harness = Harness()
    runner = DropRunner(lambda: [GOOD], harness, make_adapter=lambda cfg: GoodAdapter(), make_client=_client)
    runner.reload()
    worker, stop = runner.workers["good-shop"]
    stop.set()
    worker.thread.join(5)
    runner.tick()
    new_worker, _ = runner.workers["good-shop"]
    try:
        assert new_worker is not worker and new_worker.alive()
    finally:
        runner.stop(timeout=5)


def test_heartbeat_pings_only_when_healthy():
    clock = [0.0]
    hb = Heartbeat(clock=lambda: clock[0])
    hb.expect("email", 300)
    sent: list[tuple[str, str | None]] = []
    assert ping_once("https://hc.example/abc", hb, send=lambda u, b: sent.append((u, b)))
    assert sent[-1] == ("https://hc.example/abc", None)

    clock[0] = 301
    assert not ping_once("https://hc.example/abc", hb, send=lambda u, b: sent.append((u, b)))
    assert sent[-1][0] == "https://hc.example/abc/fail" and "email" in (sent[-1][1] or "")

    hb.beat("email")
    hb.add_check("drops_runner", lambda: "worker threads not running: jb-hi-fi")
    assert not ping_once("https://hc.example/abc", hb, send=lambda u, b: sent.append((u, b)))
    assert "jb-hi-fi" in (sent[-1][1] or "")
