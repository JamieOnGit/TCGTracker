"""A polite HTTP client for retailer monitoring (brief 9.6).

* respects robots.txt (and refuses disallowed URLs) and its Crawl-delay,
* adds random jitter between requests to the same host,
* backs off on 429/403 (honouring Retry-After), host by host,
* caches responses and revalidates with ETag / Last-Modified,
* identifies itself with an honest User-Agent.

It will never try to get around bot protection: a challenge page or a 403 is
treated as "back off", not as a problem to solve. Out of scope by design:
auto-checkout, queue bypassing, CAPTCHA solving.
"""

from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

from tcgworkers.drops.robots import Robots


class Disallowed(RuntimeError):
    """robots.txt disallows this URL for our user agent."""


class RobotsUnreadable(Disallowed):
    """The host refused or failed to serve robots.txt itself (e.g. HTTP 403 to
    cloud servers). We stay out, as if everything were disallowed, but the
    reason is the refusal, not a robots.txt rule."""


class BackingOff(RuntimeError):
    """The host told us to slow down; we're waiting before trying again."""

    def __init__(self, host: str, until: float, status: int | None = None) -> None:
        why = f" after HTTP {status}" if status else ""
        super().__init__(f"backing off {host}{why} until {until:.0f}")
        self.host = host
        self.until = until
        self.status = status


@dataclass
class _Host:
    robots: Robots | None = None
    robots_fetched_at: float = 0.0
    last_request_at: float = 0.0
    backoff_until: float = 0.0
    strikes: int = 0
    robots_problem: str | None = None  # why robots.txt couldn't be read


@dataclass
class _Cached:
    response: httpx.Response
    fetched_at: float
    etag: str | None
    last_modified: str | None


@dataclass
class SharedGate:
    """One request budget shared by several clients. Every store on Shopify's
    network sits behind the same edge, which rate-limits per client IP across
    all shops, so those stores take turns: at most one request per
    ``min_interval`` seconds between them, and a 429 from any of them pauses
    them all."""

    name: str
    min_interval: float
    # Self-tuning: the spacing grows x1.5 on every 429 (up to ``ceiling``) and
    # shrinks 3% per success (down to ``floor``), so the monitor settles at the
    # fastest pace the platform accepts from our IP for an honest bot.
    floor: float | None = None
    ceiling: float = 60.0
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    backoff_until: float = 0.0
    _next_at: float = 0.0
    _refusals: list[str] = field(default_factory=list)  # hosts of consecutive 429s
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def wait(self) -> None:
        with self._lock:
            now = self.clock()
            if now < self.backoff_until:
                raise BackingOff(self.name, self.backoff_until)
            at = max(now, self._next_at)
            self._next_at = at + self.min_interval
        if at > now:
            self.sleep(at - now)

    def succeeded(self) -> None:
        with self._lock:
            self._refusals.clear()
            self.min_interval = max(self.floor if self.floor is not None else 0.0, self.min_interval * 0.97)

    def back_off(self, until: float, host: str = "") -> None:
        """A 429 (or 503) from ``host``. One shop refusing is that shop's own limit (it
        backs off alone) and everyone slows down a little; two different shops
        refusing in a row is the platform's limit, so every shop pauses."""
        with self._lock:
            self.min_interval = min(self.ceiling, self.min_interval * 1.5)
            if host not in self._refusals:
                self._refusals.append(host)
            if len(self._refusals) >= 2:
                self.backoff_until = max(self.backoff_until, until)


@dataclass
class PoliteClient:
    user_agent: str
    min_delay: float = 2.0
    max_delay: float = 6.0
    cache_ttl: float = 30.0
    robots_ttl: float = 24 * 3600
    base_backoff: float = 60.0
    max_backoff: float = 3600.0
    transport: httpx.BaseTransport | None = None
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    rng: random.Random = field(default_factory=random.Random)
    gate: SharedGate | None = None  # platform-wide budget (see SharedGate)

    def __post_init__(self) -> None:
        self._http = httpx.Client(
            headers={"User-Agent": self.user_agent, "Accept-Language": "en-AU,en;q=0.8"},
            timeout=20,
            follow_redirects=True,
            transport=self.transport,
        )
        self._hosts: dict[str, _Host] = {}
        self._cache: dict[str, _Cached] = {}

    # ------------------------------------------------------------------ robots
    def _host(self, url: str) -> tuple[str, _Host]:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        return origin, self._hosts.setdefault(origin, _Host())

    def allowed(self, url: str) -> bool:
        origin, host = self._host(url)
        now = self.clock()
        if host.robots is None or now - host.robots_fetched_at > self.robots_ttl:
            problem = None
            try:
                if self.gate is not None:
                    self.gate.wait()
                r = self._http.get(f"{origin}/robots.txt")
                if r.status_code in (401, 403):
                    parser = Robots.disallow_all()  # blocked from robots.txt itself: stay out
                    problem = f"{origin} refused robots.txt (HTTP {r.status_code})"
                elif r.status_code >= 400:
                    parser = Robots.allow_all()  # no robots.txt: everything allowed
                else:
                    parser = Robots.parse(r.text)
            except httpx.HTTPError as exc:
                parser = Robots.disallow_all()  # can't read it: be conservative
                problem = f"{origin} did not serve robots.txt ({type(exc).__name__})"
            host.robots, host.robots_fetched_at, host.robots_problem = parser, now, problem
        return host.robots.can_fetch(self.user_agent, url)

    def crawl_delay(self, url: str) -> float | None:
        """The host's robots.txt Crawl-delay for us (reads robots.txt if needed)."""
        self.allowed(url)
        _, host = self._host(url)
        return host.robots.crawl_delay(self.user_agent) if host.robots else None

    # ------------------------------------------------------------------- fetch
    def get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        pass_statuses: tuple[int, ...] = (),
        use_cache: bool = True,
    ) -> httpx.Response:
        """Polite GET. Statuses in ``pass_statuses`` are returned to the caller
        instead of triggering back-off / raising (e.g. an API's 403 "invalid
        key", which means "re-read the credentials", not "slow down")."""
        if not self.allowed(url):
            _, host = self._host(url)
            raise RobotsUnreadable(host.robots_problem) if host.robots_problem else Disallowed(url)
        origin, host = self._host(url)
        now = self.clock()
        if now < host.backoff_until:
            raise BackingOff(origin, host.backoff_until)

        cached = self._cache.get(url) if use_cache else None
        if cached and now - cached.fetched_at < self.cache_ttl:
            return cached.response

        gap = self.rng.uniform(self.min_delay, self.max_delay)
        crawl_delay = host.robots.crawl_delay(self.user_agent) if host.robots else None
        if crawl_delay is not None:
            gap = max(gap, crawl_delay)
        wait = host.last_request_at + gap - now
        if host.last_request_at and wait > 0:
            self.sleep(wait)
        if self.gate is not None:
            self.gate.wait()

        req_headers = dict(headers or {})
        if cached and cached.etag:
            req_headers["If-None-Match"] = cached.etag
        if cached and cached.last_modified:
            req_headers["If-Modified-Since"] = cached.last_modified

        response = self._http.get(url, headers=req_headers)
        host.last_request_at = self.clock()

        if response.status_code in pass_statuses:
            return response
        if response.status_code in (403, 429, 503):
            host.strikes += 1
            retry_after = response.headers.get("Retry-After", "")
            delay = (
                float(retry_after) if retry_after.isdigit() else self.base_backoff * 2 ** (host.strikes - 1)
            )
            host.backoff_until = host.last_request_at + min(delay, self.max_backoff)
            if self.gate is not None and response.status_code in (429, 503):
                # Shopify throttles with 429 and sometimes 503: both slow everyone down.
                self.gate.back_off(host.backoff_until, origin)
            raise BackingOff(origin, host.backoff_until, response.status_code)
        host.strikes = 0
        if self.gate is not None:
            self.gate.succeeded()

        if response.status_code == 304 and cached:
            cached.fetched_at = host.last_request_at
            return cached.response
        response.raise_for_status()
        self._cache[url] = _Cached(
            response,
            host.last_request_at,
            response.headers.get("ETag"),
            response.headers.get("Last-Modified"),
        )
        return response
