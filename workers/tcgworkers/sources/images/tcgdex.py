"""TCGdex (tcgdex.dev): a free, open Pokémon card database with card images
for English and Japanese sets. No key. Used for Pokémon cards Scrydex
doesn't give us an image for.

* ``GET /v2/{lang}/sets`` lists sets (``id``, ``name``);
* ``GET /v2/{lang}/sets/{id}`` returns the set with every card
  (``localId``, ``name``, ``image``). A card image is ``{image}/high.webp``.

TCG Pocket (the mobile game) sets are listed too; they are not physical
cards and are skipped.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from typing import Any

import httpx

SOURCE = "tcgdex"
BASE_URL = "https://api.tcgdex.net"
LANGS = {"en": "en", "jp": "ja"}  # ours -> TCGdex
_POCKET = re.compile(r"^(A\d|P-A|B\d)", re.IGNORECASE)


class TcgdexError(RuntimeError):
    pass


def is_pocket(set_id: str) -> bool:
    return bool(_POCKET.match(set_id))


def card_image(card: dict[str, Any]) -> str | None:
    base = card.get("image")
    return f"{base}/high.webp" if isinstance(base, str) and base.startswith("https://") else None


class TcgdexClient:
    def __init__(
        self,
        *,
        user_agent: str,
        max_requests: int,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        min_interval: float = 0.2,
    ) -> None:
        self.max_requests = max_requests
        self.requests = 0
        self.sleep = sleep
        self.min_interval = min_interval
        self._last = -1e9
        self._http = httpx.Client(
            base_url=BASE_URL,
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={"User-Agent": user_agent, "Accept": "application/json"},
            transport=transport,
        )

    def _get(self, path: str) -> Any:
        if self.requests >= self.max_requests:
            raise TcgdexError(f"request budget of {self.max_requests} used")
        wait = self._last + self.min_interval - time.monotonic()
        if wait > 0:
            self.sleep(wait)
        self._last = time.monotonic()
        self.requests += 1
        try:
            r = self._http.get(path)
        except httpx.HTTPError as exc:
            raise TcgdexError(f"{type(exc).__name__} on {path}") from exc
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            raise TcgdexError(f"HTTP {r.status_code} from {path}")
        return r.json()

    def sets(self, lang: str) -> list[dict[str, Any]]:
        body = self._get(f"/v2/{lang}/sets") or []
        return [s for s in body if isinstance(s, dict) and s.get("id") and not is_pocket(str(s["id"]))]

    def set_cards(self, lang: str, set_id: str) -> list[dict[str, Any]]:
        body = self._get(f"/v2/{lang}/sets/{set_id}") or {}
        return [c for c in body.get("cards") or [] if isinstance(c, dict)]
