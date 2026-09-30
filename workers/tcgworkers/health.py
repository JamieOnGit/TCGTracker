"""Process heartbeat for an external dead-man's switch (e.g. healthchecks.io).

Components register a check that returns ``None`` when healthy or a short
problem description. Every minute, if all checks pass, HEALTHCHECK_URL is
pinged; otherwise ``<url>/fail`` is pinged with the problems, so the monitor
alerts both when the process dies (no pings) and when it is up but stuck.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx

log = logging.getLogger(__name__)

Check = Callable[[], str | None]


@dataclass
class Heartbeat:
    clock: Callable[[], float] = time.monotonic
    _beats: dict[str, float] = field(default_factory=dict)
    _max_age: dict[str, float] = field(default_factory=dict)
    _checks: dict[str, Check] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def expect(self, name: str, max_age_seconds: float) -> None:
        """``name`` must ``beat()`` at least every ``max_age_seconds``."""
        with self._lock:
            self._max_age[name] = max_age_seconds
            self._beats.setdefault(name, self.clock())  # grace period from start-up

    def beat(self, name: str) -> None:
        with self._lock:
            self._beats[name] = self.clock()

    def add_check(self, name: str, check: Check) -> None:
        with self._lock:
            self._checks[name] = check

    def problems(self) -> list[str]:
        now = self.clock()
        with self._lock:
            out = [
                f"{name}: no success for {now - self._beats.get(name, 0):.0f}s"
                for name, max_age in self._max_age.items()
                if now - self._beats.get(name, 0) > max_age
            ]
            checks = list(self._checks.items())
        for name, check in checks:
            try:
                problem = check()
            except Exception as exc:
                problem = f"check raised {type(exc).__name__}: {exc}"
            if problem:
                out.append(f"{name}: {problem}")
        return out


def _send(url: str, body: str | None) -> None:
    if body is None:
        httpx.get(url, timeout=10)
    else:
        httpx.post(url, content=body, timeout=10)


def ping_once(url: str, heartbeat: Heartbeat, *, send: Callable[[str, str | None], None] = _send) -> bool:
    """GET ``url`` when healthy, POST the problems to ``url/fail`` when not."""
    problems = heartbeat.problems()
    try:
        if problems:
            log.error("heartbeat unhealthy: %s", "; ".join(problems))
            send(url.rstrip("/") + "/fail", "\n".join(problems)[:10000])
        else:
            send(url, None)
    except httpx.HTTPError as exc:
        log.warning("heartbeat ping failed: %s", exc)
    return not problems


def start_heartbeat(
    url: str | None, heartbeat: Heartbeat, stop: threading.Event, interval: float = 60.0
) -> threading.Thread | None:
    if not url:
        log.info("HEALTHCHECK_URL not set; external heartbeat disabled")
        return None

    def loop() -> None:
        while not stop.is_set():
            ping_once(url, heartbeat)
            stop.wait(interval)

    t = threading.Thread(target=loop, name="heartbeat", daemon=True)
    t.start()
    return t
