"""Shared base for the generic catalogue adapters (Shopify, WooCommerce).

One class per PLATFORM, instantiated per store from its ``retailers`` row
(slug, name, base_url, config), so adding a store is a row, not a module.
``config`` keys: ``collections`` (Shopify) / ``categories`` (WooCommerce),
optional ``keywords`` (title must contain one) and ``exclude`` (title must
contain none).

Politeness and honesty (brief: no anti-detection of any kind):

* only the store's public JSON catalogue, through the ``PoliteClient``
  (honest UA, robots.txt + Crawl-delay, jitter, ETag revalidation);
* 429 / 503: the client backs off (honouring Retry-After) and the cycle stops;
* 401 / 403 or a bot-challenge page: ``AdapterBlocked`` with the reason, and
  this adapter makes no request to the store for ``BLOCK_COOLDOWN`` seconds;
  the store is then covered by member sightings. Never worked around.
* robots.txt disallowing the feed: ``AdapterBlocked("robots: ...")``.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable, Mapping
from typing import Any
from urllib.parse import urlsplit

import httpx

from tcgworkers.drops.base import AdapterBlocked, RetailerAdapter
from tcgworkers.drops.filters import _norm, game_in_text, non_sealed_reason
from tcgworkers.drops.http import Disallowed, PoliteClient, RobotsUnreadable
from tcgworkers.drops.models import Observation

BLOCK_COOLDOWN = 6 * 3600.0
MAX_PAGES = 8

_CHALLENGE_MARKERS = (
    "just a moment...",
    "challenge-platform",
    "cf-chl",
    "attention required",
    "captcha",
    "px-captcha",
    "_incapsula_",
    "pardon our interruption",
    "request unsuccessful",
    "access denied",
    "are you a robot",
    "bot protection",
)


def challenge_reason(response: httpx.Response) -> str | None:
    """'challenge' / '403' style reason when the response is a block page."""
    if response.headers.get("cf-mitigated", "").lower() == "challenge":
        return "challenge"
    body = response.text[:4000].lower() if response.content else ""
    if any(m in body for m in _CHALLENGE_MARKERS):
        return "challenge"
    if response.status_code in (401, 403):
        return str(response.status_code)
    return None


def https_image(src: Any) -> str | None:
    if not isinstance(src, str) or not src:
        return None
    if src.startswith("//"):
        src = "https:" + src
    return src if src.startswith("https://") and len(src) <= 1000 else None


def lang_in_text(text: str) -> str | None:
    t = _norm(text.replace("-", " ").replace("_", " "))
    if any(f" {w} " in t for w in ("japanese", "japan", "jp", "jpn")):
        return "jp"
    if " english " in t or " en " in t:
        return "en"
    return None


def hint_game(*texts: str) -> str | None:
    """Our game when the store's own categorisation names exactly one."""
    found = {g for g in (game_in_text(t.replace("-", " ").replace("_", " ")) for t in texts if t) if g}
    return found.pop() if len(found) == 1 else None


class CatalogueAdapter(RetailerAdapter):
    platform: str = ""

    def __init__(
        self,
        *,
        slug: str,
        name: str,
        base_url: str,
        config: Mapping[str, Any] | None = None,
        max_pages: int = MAX_PAGES,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        parts = urlsplit(base_url.strip())
        if parts.scheme != "https" or not parts.netloc:
            raise ValueError(f"{slug}: base_url must be an https origin, got {base_url!r}")
        self.slug = slug
        self.name = name
        self.base_url = f"https://{parts.netloc}"
        self.config: Mapping[str, Any] = config or {}
        self.max_pages = max_pages
        self.clock = clock
        self.keywords = [_norm(k).strip() for k in self.config.get("keywords") or [] if str(k).strip()]
        self.exclude = [_norm(k).strip() for k in self.config.get("exclude") or [] if str(k).strip()]
        self._blocked_until = 0.0
        self._blocked_reason = ""

    # ------------------------------------------------------------ filters
    def keep(self, title: str, *, product_type: str = "", tags: Iterable[str] = ()) -> bool:
        """Sealed Pokémon / One Piece product only, plus the store's own
        keyword / exclude lists. The engine's TCG filter runs after this."""
        t = _norm(title)
        if self.keywords and not any(k in t for k in self.keywords):
            return False
        if any(k in t for k in self.exclude):
            return False
        return non_sealed_reason(title, product_type=product_type, tags=tags) is None

    # --------------------------------------------------------------- HTTP
    def _block(self, reason: str) -> AdapterBlocked:
        self._blocked_until = self.clock() + BLOCK_COOLDOWN
        self._blocked_reason = reason[:200]
        return AdapterBlocked(self._blocked_reason)

    def check_cooldown(self) -> None:
        if self.clock() < self._blocked_until:
            raise AdapterBlocked(self._blocked_reason)

    def get_json(self, client: PoliteClient, url: str) -> tuple[Any, httpx.Response]:
        """GET a JSON feed page. Raises AdapterBlocked (robots / 401 / 403 /
        challenge), BackingOff (429 / 503, from the client), LookupError (404:
        a config problem, reported as a failed cycle) or ValueError."""
        try:
            r = client.get(url, pass_statuses=(401, 403, 404, 410), headers={"Accept": "application/json"})
        except RobotsUnreadable as exc:
            raise AdapterBlocked(str(exc)) from exc
        except Disallowed as exc:
            raise AdapterBlocked(f"robots: robots.txt disallows {urlsplit(url).path}") from exc
        if r.status_code in (401, 403):
            raise self._block(
                f"{challenge_reason(r) or r.status_code}: {self.name} refused the catalogue feed"
            )
        if r.status_code in (404, 410):
            raise LookupError(f"{self.slug}: {r.status_code} for {url} (check the store config)")
        ctype = r.headers.get("Content-Type", "").lower()
        if "json" not in ctype or r.text.lstrip()[:1] == "<":
            if challenge_reason(r):
                raise self._block(f"challenge: {self.name} served a bot-challenge page")
            raise ValueError(f"{self.slug}: {url} did not return JSON ({ctype or 'no content type'})")
        try:
            return r.json(), r
        except ValueError as exc:
            raise ValueError(f"{self.slug}: {url} returned invalid JSON") from exc

    def discover(self, client: PoliteClient) -> Iterable[Observation]:
        self.check_cooldown()
        seen: dict[str, Observation] = {}
        for obs in self.fetch_all(client):
            seen.setdefault(obs.sku, obs)  # a product listed in two collections counts once
        return list(seen.values())

    def fetch_all(self, client: PoliteClient) -> Iterable[Observation]:
        raise NotImplementedError
