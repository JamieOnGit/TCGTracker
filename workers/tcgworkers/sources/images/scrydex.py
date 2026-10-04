"""Scrydex (scrydex.com): card and sealed-product images for Pokémon (English
and Japanese) and One Piece.

* ``GET /{game}/v1/expansions`` lists a game's expansions (every language);
* ``GET /{game}/v1/expansions/{id}/cards`` pages through an expansion's cards;
* ``GET /{game}/v1/sealed`` pages through sealed products (booster boxes,
  packs, Elite Trainer Boxes...).

Auth is two headers, ``X-Api-Key`` and ``X-Team-ID`` (Starter plan and up).
Every request costs one credit whatever the page size; loading the images
themselves costs nothing. Scrydex lets sites reference its image URLs
directly ("Always reference the urls as returned by the API"); the images
belong to their copyright holders (The Pokémon Company, Bandai).
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

import httpx

SOURCE = "scrydex"
BASE_URL = "https://api.scrydex.com"
# Our game code -> Scrydex's.
GAMES = {"pokemon": "pokemon", "one-piece": "onepiece"}
# Scrydex language codes -> ours.
LANGS = {"EN": "en", "JA": "jp", "JP": "jp"}
MAX_RETRIES = 3


class ScrydexError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class BudgetExhausted(ScrydexError):
    pass


@dataclass(frozen=True)
class ScxImage:
    """The front image of a card or product, largest first."""

    url: str
    external_id: str


def front_image(item: dict[str, Any]) -> str | None:
    """The front image URL, large then medium then small, as Scrydex returned it."""
    images = item.get("images") or []
    if isinstance(images, dict):  # tolerate a single map
        images = [images]
    fronts = [i for i in images if isinstance(i, dict) and (i.get("type") or "front") == "front"]
    for img in fronts or [i for i in images if isinstance(i, dict)]:
        for size in ("large", "medium", "small"):
            url = img.get(size)
            if isinstance(url, str) and url.startswith("https://"):
                return url
    return None


def lang_of(item: dict[str, Any]) -> str | None:
    code = (item.get("language_code") or (item.get("expansion") or {}).get("language_code") or "EN").upper()
    return LANGS.get(code)


class ScrydexClient:
    """One request at a time, a credit budget per run, backoff on 429/5xx."""

    def __init__(
        self,
        api_key: str,
        team_id: str,
        *,
        user_agent: str,
        max_requests: int,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        min_interval: float = 0.25,
    ) -> None:
        self.max_requests = max_requests
        self.requests = 0
        self.sleep = sleep
        self.min_interval = min_interval
        self._last = -1e9
        self._http = httpx.Client(
            base_url=BASE_URL,
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={
                "User-Agent": user_agent,
                "Accept": "application/json",
                "X-Api-Key": api_key,
                "X-Team-ID": team_id,
            },
            transport=transport,
        )

    def get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(MAX_RETRIES + 1):
            if self.requests >= self.max_requests:
                raise BudgetExhausted(f"request budget of {self.max_requests} used")
            wait = self._last + self.min_interval - time.monotonic()
            if wait > 0:
                self.sleep(wait)
            self._last = time.monotonic()
            self.requests += 1
            try:
                r = self._http.get(path, params=params)
            except httpx.HTTPError as exc:
                if attempt < MAX_RETRIES:
                    self.sleep(2**attempt)
                    continue
                raise ScrydexError(f"{type(exc).__name__} on {path}") from exc
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == MAX_RETRIES:
                    raise ScrydexError(f"HTTP {r.status_code} from {path}", status=r.status_code)
                self.sleep(min(float(r.headers.get("Retry-After") or 2 ** (attempt + 1)), 60))
                continue
            if r.status_code >= 400:
                # Never echo headers (the key); the body is Scrydex's error message.
                raise ScrydexError(f"HTTP {r.status_code} from {path}: {r.text[:200]}", status=r.status_code)
            body = r.json()
            if not isinstance(body, dict):
                raise ScrydexError(f"unexpected response from {path}")
            return body
        raise ScrydexError(f"gave up on {path}")  # pragma: no cover

    def _pages(
        self, path: str, page_size: int, params: dict[str, Any] | None = None
    ) -> Iterator[dict[str, Any]]:
        page = 1
        while True:
            body = self.get(path, {**(params or {}), "page": page, "page_size": page_size})
            rows = [x for x in body.get("data") or [] if isinstance(x, dict)]
            yield from rows
            total = body.get("totalCount") or body.get("total_count")
            size = body.get("pageSize") or body.get("page_size") or page_size
            if not rows or (isinstance(total, int) and page * int(size) >= total) or len(rows) < int(size):
                return
            page += 1

    def expansions(self, game: str) -> list[dict[str, Any]]:
        return list(self._pages(f"/{game}/v1/expansions", 100))

    def cards(self, game: str, expansion_id: str) -> Iterator[dict[str, Any]]:
        return self._pages(f"/{game}/v1/expansions/{expansion_id}/cards", 100)

    def search_cards(self, game: str, q: str) -> list[dict[str, Any]]:
        """One page (one credit) of a card search, e.g. ``name:"Charizard ex" number:"199"``."""
        body = self.get(f"/{game}/v1/cards", {"q": q, "page_size": 10})
        return [x for x in body.get("data") or [] if isinstance(x, dict)]

    def sealed(self, game: str) -> Iterator[dict[str, Any]]:
        return self._pages(f"/{game}/v1/sealed", 100)
