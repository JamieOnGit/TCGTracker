"""A polite JSON client for the free image sources (one request at a time, a
request budget per run, retries with backoff on 429/5xx and dropped
connections), and an image-address checker."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import httpx


class SourceError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class OutOfBudget(SourceError):
    pass


class PoliteClient:
    def __init__(
        self,
        base_url: str,
        *,
        user_agent: str,
        max_requests: int,
        min_interval: float,
        retries: int = 3,
        headers: dict[str, str] | None = None,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        timeout: float = 30.0,
    ) -> None:
        self.max_requests = max_requests
        self.requests = 0
        self.min_interval = min_interval
        self.retries = retries
        self.sleep = sleep
        self._last = -1e9
        self._http = httpx.Client(
            base_url=base_url,
            timeout=httpx.Timeout(timeout, connect=10.0),
            headers={"User-Agent": user_agent, **(headers or {})},
            transport=transport,
            follow_redirects=True,
        )

    def _send(self, method: str, url: str, params: dict[str, Any] | None = None) -> httpx.Response:
        """One request, retried on 429/5xx and network errors. Raises
        ``OutOfBudget`` once the run's budget is used."""
        for attempt in range(self.retries + 1):
            if self.requests >= self.max_requests:
                raise OutOfBudget(f"request budget of {self.max_requests} used")
            wait = self._last + self.min_interval - time.monotonic()
            if wait > 0:
                self.sleep(wait)
            self._last = time.monotonic()
            self.requests += 1
            try:
                r = self._http.request(method, url, params=params)
            except httpx.HTTPError as exc:
                if attempt < self.retries:
                    self.sleep(2 ** (attempt + 1))
                    continue
                raise SourceError(f"{type(exc).__name__} on {url}") from exc
            if r.status_code == 429 or r.status_code >= 500:
                if attempt < self.retries:
                    retry_after = r.headers.get("Retry-After") or ""
                    delay = float(retry_after) if retry_after.isdigit() else 2 ** (attempt + 1)
                    self.sleep(min(delay, 60))
                    continue
                raise SourceError(f"HTTP {r.status_code} from {url}", status=r.status_code)
            return r
        raise SourceError(f"gave up on {url}")  # pragma: no cover

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        r = self._send("GET", url, params)
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            raise SourceError(f"HTTP {r.status_code} from {url}", status=r.status_code)
        try:
            return r.json()
        except ValueError as exc:
            raise SourceError(f"not JSON from {url}") from exc


class ImageChecker(PoliteClient):
    """Checks an image address answers with an image before it is saved (one
    HEAD request each; results are remembered for the run)."""

    def __init__(self, *, user_agent: str, max_requests: int, **kw: Any) -> None:
        kw.setdefault("min_interval", 0.1)
        kw.setdefault("retries", 1)
        kw.setdefault("timeout", 15.0)
        super().__init__("", user_agent=user_agent, max_requests=max_requests, **kw)
        self.seen: dict[str, bool] = {}

    def ok(self, url: str) -> bool:
        if url not in self.seen:
            try:
                r = self._send("HEAD", url)
                good = r.status_code == 200 and r.headers.get("content-type", "").startswith("image/")
            except OutOfBudget:
                raise
            except SourceError:
                good = False
            self.seen[url] = good
        return self.seen[url]
