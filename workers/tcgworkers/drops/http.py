"""A polite HTTP client for retailer monitoring (brief 9.6).

* respects robots.txt (and refuses disallowed URLs),
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
import time
import urllib.robotparser
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

_DISALLOW_ALL = ["User-agent: *", "Disallow: /"]


class Disallowed(RuntimeError):
    """robots.txt disallows this URL for our user agent."""


class BackingOff(RuntimeError):
    """The host told us to slow down; we're waiting before trying again."""

    def __init__(self, host: str, until: float) -> None:
        super().__init__(f"backing off {host} until {until:.0f}")
        self.host = host
        self.until = until


@dataclass
class _Host:
    robots: urllib.robotparser.RobotFileParser | None = None
    robots_fetched_at: float = 0.0
    last_request_at: float = 0.0
    backoff_until: float = 0.0
    strikes: int = 0


@dataclass
class _Cached:
    response: httpx.Response
    fetched_at: float
    etag: str | None
    last_modified: str | None


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
            parser = urllib.robotparser.RobotFileParser()
            try:
                r = self._http.get(f"{origin}/robots.txt")
                if r.status_code in (401, 403):
                    parser.parse(_DISALLOW_ALL)  # blocked from robots.txt itself: stay out
                elif r.status_code >= 400:
                    parser.parse([])  # no robots.txt: everything allowed
                else:
                    parser.parse(r.text.splitlines())
            except httpx.HTTPError:
                parser.parse(_DISALLOW_ALL)  # can't read it: be conservative
            host.robots, host.robots_fetched_at = parser, now
        return host.robots.can_fetch(self.user_agent, url)

    # ------------------------------------------------------------------- fetch
    def get(self, url: str, *, headers: dict[str, str] | None = None) -> httpx.Response:
        if not self.allowed(url):
            raise Disallowed(url)
        origin, host = self._host(url)
        now = self.clock()
        if now < host.backoff_until:
            raise BackingOff(origin, host.backoff_until)

        cached = self._cache.get(url)
        if cached and now - cached.fetched_at < self.cache_ttl:
            return cached.response

        wait = host.last_request_at + self.rng.uniform(self.min_delay, self.max_delay) - now
        if host.last_request_at and wait > 0:
            self.sleep(wait)

        req_headers = dict(headers or {})
        if cached and cached.etag:
            req_headers["If-None-Match"] = cached.etag
        if cached and cached.last_modified:
            req_headers["If-Modified-Since"] = cached.last_modified

        response = self._http.get(url, headers=req_headers)
        host.last_request_at = self.clock()

        if response.status_code in (403, 429, 503):
            host.strikes += 1
            retry_after = response.headers.get("Retry-After", "")
            delay = (
                float(retry_after) if retry_after.isdigit() else self.base_backoff * 2 ** (host.strikes - 1)
            )
            host.backoff_until = host.last_request_at + min(delay, self.max_backoff)
            raise BackingOff(origin, host.backoff_until)
        host.strikes = 0

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
