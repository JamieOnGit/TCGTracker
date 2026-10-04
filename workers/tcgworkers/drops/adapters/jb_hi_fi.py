"""JB Hi-Fi adapter (approved and enabled).

Source (preference 1, brief 9.2): the Algolia index the storefront's own
collection pages query, with the same filters. See
docs/research/07-retailers-pricing-ebay.md section B.

Credentials are discovered at runtime (07 B.2), never committed:

1. GET a collection page; check ``window.featureFlags.searchProvider`` is
   still ``algolia`` (else ``SearchProviderChanged`` -> health alert), and
   read the collection's own ``var filters = '...'``.
2. Find the theme bundles ``/cdn/shop/t/{theme}/assets/bundle.{hash}.js``
   (robots-allowed) and read ``app_id`` / ``search_api_key`` /
   ``index_products`` from the one that holds them, trying the last good
   bundle first.
3. Cache for 24 hours; re-discover at once if Algolia answers 401/403/404.

JB_ALGOLIA_APP_ID / JB_ALGOLIA_SEARCH_KEY, when set, seed the cache (useful
if discovery breaks), and are replaced by discovery on a 401/403.

Polling (07 B.4):
* discovery - the Pokémon collection query and the One Piece text query;
* watch - ONE filtered query ``sku:A OR sku:B ...`` (<= 100 per request)
  covering the watchlist SKUs plus every first-party SKU already seen, so a
  restock is caught on the fast interval without a request per product.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from tcgworkers.drops.base import RetailerAdapter, register
from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.models import Availability, Observation

log = logging.getLogger(__name__)

SLUG = "jb-hi-fi"
INDEX = "shopify_products_families"
STOREFRONT = "https://www.jbhifi.com.au"
COLLECTION_URL = f"{STOREFRONT}/collections/pokemon-trading-cards_1eld66jvxxoxw0ae4rjd36"
PRODUCT_URL = "https://www.jbhifi.com.au/products/{handle}"
CART_URL = "https://www.jbhifi.com.au/cart/{variant}:1"  # Shopify cart permalink: straight to checkout
CONFIG_TTL_SECONDS = 24 * 3600
WATCH_BATCH = 100
_BASE_FILTER = '("facets.Game type":"Trading card games" OR "category_hierarchy":"Trading card games")'
_LIVE = "(price > 0 AND product_published = 1 AND availability.displayProduct = 1)"
POKEMON_FILTER = f'{_BASE_FILTER} AND ("facets.Brands":"Pokemon TCG" OR "facets.Primary franchise":"Pokemon")'
QUERIES: dict[str, str] = {
    "pokemon": f"{POKEMON_FILTER} AND {_LIVE}",
    "one-piece": f"{_BASE_FILTER} AND {_LIVE}",
}
QUERY_TEXT = {"pokemon": "", "one-piece": "one piece card game"}
ATTRIBUTES = [
    "sku",
    "title",
    "handle",
    "price",
    "isMarketplace",
    "availability",
    "release_date",
    "updated_at",
    "variant_id",
]
_IN = {"InStock", "LimitedStock"}

_PROVIDER = re.compile(r'window\.featureFlags\.searchProvider\s*=\s*"([A-Za-z]+)"')
_FILTERS = re.compile(r"var\s+filters\s*=\s*'([^']*)'")
_BUNDLE = re.compile(r"//www\.jbhifi\.com\.au/cdn/shop/t/(\d+)/assets/(bundle\.[0-9a-f]{16}\.js)(?:\?v=\d+)?")
_CREDS = re.compile(r'app_id:"([A-Z0-9]{10})",search_api_key:"([0-9a-f]{32})"')
_APP_ID_LOOSE = re.compile(r'app_id\s*:\s*"([A-Z0-9]{8,12})"')
_KEY_LOOSE = re.compile(r'search_api_key\s*:\s*"([0-9a-f]{32})"')
_INDEX = re.compile(r'index_products\s*:\s*"([a-z0-9_]+)"')


class SearchProviderChanged(RuntimeError):
    """JB's storefront no longer searches with Algolia (07 B.1 googleFilters)."""


class CredentialsNotFound(RuntimeError):
    """No theme bundle held the Algolia config (theme restructured)."""


@dataclass(frozen=True)
class AlgoliaConfig:
    app_id: str
    api_key: str
    index: str = INDEX
    bundle_file: str | None = None
    theme_id: str | None = None
    pokemon_filter: str | None = None  # the collection page's own filter
    fetched_at: float = 0.0

    @property
    def host(self) -> str:
        return f"https://{self.app_id.lower()}-dsn.algolia.net"


def availability_of(hit: dict[str, Any]) -> Availability:
    a = hit.get("availability") or {}
    if a.get("canPreOrder") or a.get("productLifecycle") == "PreOrder" or hit.get("button") == "PreOrder":
        return Availability.PREORDER
    online = bool(a.get("canBuyOnline")) and a.get("deliveryStatus") in _IN
    cnc = a.get("clickNCollectStatus") in _IN
    if online and cnc:
        return Availability.IN_STOCK_BOTH
    if online:
        return Availability.IN_STOCK_ONLINE
    if cnc:
        return Availability.IN_STOCK_CNC
    if a.get("overallStatus"):
        return Availability.OUT_OF_STOCK
    return Availability.UNKNOWN


def jb_cart_url(hit: dict[str, Any]) -> str | None:
    """JB's own one-tap checkout link for an item JB sells itself (marketplace
    sellers' items check out through their own flow)."""
    variant = str(hit.get("variant_id") or "")
    if hit.get("isMarketplace") or not re.fullmatch(r"[0-9]{6,20}", variant):
        return None
    return CART_URL.format(variant=variant)


AU_TZ = ZoneInfo("Australia/Sydney")


def jb_release_date(value: Any) -> date | None:
    """JB's ``release_date``: a Unix timestamp (midnight Sydney time, stored as
    UTC) or a ``YYYY/MM/DD`` / ``YYYY-MM-DD`` string. The Australian day."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        if value <= 0:
            return None
        return datetime.fromtimestamp(value, UTC).astimezone(AU_TZ).date()
    if isinstance(value, str) and (m := re.fullmatch(r"\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})", value[:10])):
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def parse_hits(payload: dict[str, Any], *, observed_at: datetime) -> list[Observation]:
    out: list[Observation] = []
    for hit in payload.get("hits", []):
        sku = str(hit.get("sku") or hit.get("objectID") or "")
        handle = hit.get("handle")
        if not sku or not handle:
            continue
        price = hit.get("price")
        out.append(
            Observation(
                retailer=SLUG,
                sku=sku,
                url=PRODUCT_URL.format(handle=handle),
                title=str(hit.get("title", "")).strip(),
                availability=availability_of(hit),
                price_aud=Decimal(str(price)).quantize(Decimal("0.01")) if price not in (None, "") else None,
                observed_at=observed_at,
                is_marketplace_seller=bool(hit.get("isMarketplace")),
                raw={
                    k: hit.get(k)
                    for k in ("sku", "handle", "availability", "release_date", "updated_at", "variant_id")
                },
                cart_url=jb_cart_url(hit),
                release_date=jb_release_date(hit.get("release_date")),
            )
        )
    return out


def parse_storefront(html: str) -> tuple[str | None, str | None, list[tuple[str, str]]]:
    """(search provider, collection filter, [(theme id, bundle file)]) from collection HTML."""
    provider = m.group(1) if (m := _PROVIDER.search(html)) else None
    filters = m.group(1) if (m := _FILTERS.search(html)) else None
    bundles: list[tuple[str, str]] = []
    for theme, bundle in _BUNDLE.findall(html):
        if (theme, bundle) not in bundles:
            bundles.append((theme, bundle))
    return provider, filters, bundles


def parse_bundle(js: str) -> tuple[str, str, str] | None:
    """(app id, search key, products index) from a theme bundle, or None."""
    m = _CREDS.search(js)
    if m:
        app_id, key = m.group(1), m.group(2)
    else:
        a, k = _APP_ID_LOOSE.search(js), _KEY_LOOSE.search(js)
        if not (a and k):
            return None
        app_id, key = a.group(1), k.group(1)
    index = m2.group(1) if (m2 := _INDEX.search(js)) else INDEX
    return app_id, key, index


def _top_level(expr: str) -> tuple[bool, bool]:
    """(has a top-level OR, has a top-level AND), ignoring quoted strings."""
    depth, quoted, has_or, has_and = 0, False, False, False
    i = 0
    while i < len(expr):
        ch = expr[i]
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch == "(":
            depth += 1
        elif not quoted and ch == ")":
            depth -= 1
        elif not quoted and depth == 0:
            if expr.startswith(" OR ", i):
                has_or = True
            elif expr.startswith(" AND ", i):
                has_and = True
        i += 1
    return has_or, has_and


def combine_filters(page_filter: str | None, fallback: str) -> str:
    """The collection page's own filter AND our "live product" clause.

    Algolia only accepts ``(X OR Y) AND Z`` - never parentheses around an
    AND - so the page filter is appended to as-is when it is an AND of
    OR-groups, wrapped when it is a plain OR, and replaced by our own filter
    when it mixes both at the top level."""
    if not page_filter or not page_filter.strip():
        return fallback
    has_or, has_and = _top_level(page_filter)
    if has_or and has_and:
        log.warning("jb-hi-fi: collection filter mixes AND/OR at top level; using our own filter")
        return fallback
    if has_or:
        return f"({page_filter}) AND {_LIVE}"
    return f"{page_filter} AND {_LIVE}"


def sku_filter(skus: Iterable[str]) -> str:
    return " OR ".join(f"sku:{s}" for s in skus)


def watch_skus(targets: Iterable[str], handle_to_sku: dict[str, str]) -> list[str]:
    """Watchlist rows are SKUs ('880545') or product URLs (.../products/{handle})."""
    out: list[str] = []
    for raw in targets:
        t = raw.strip()
        if re.fullmatch(r"\d{3,10}", t):
            out.append(t)
        elif m := re.search(r"jbhifi\.com\.au/products/([A-Za-z0-9_-]+)", t):
            sku = handle_to_sku.get(m.group(1))
            if sku:
                out.append(sku)
            else:
                log.info("jb-hi-fi: watchlist URL %s not seen in discovery yet", t)
    return out


@register
class JbHiFi(RetailerAdapter):
    slug = SLUG
    name = "JB Hi-Fi"

    def __init__(
        self,
        app_id: str | None = None,
        search_key: str | None = None,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.clock = clock
        app_id = app_id or os.environ.get("JB_ALGOLIA_APP_ID", "")
        search_key = search_key or os.environ.get("JB_ALGOLIA_SEARCH_KEY", "")
        # Seeded credentials count as fresh; a 401/403 replaces them by discovery.
        self.config: AlgoliaConfig | None = (
            AlgoliaConfig(app_id, search_key, fetched_at=clock()) if app_id and search_key else None
        )
        self._last_bundle: tuple[str, str] | None = None
        self.first_party: dict[str, str] = {}  # sku -> handle, from discovery
        self.handles: dict[str, str] = {}  # handle -> sku

    # --------------------------------------------------------- credentials
    def discover_config(self, client: PoliteClient) -> AlgoliaConfig:
        html = client.get(COLLECTION_URL, use_cache=False).text
        provider, filters, bundles = parse_storefront(html)
        if provider and provider.lower() != "algolia":
            raise SearchProviderChanged(f"JB storefront search provider is now {provider!r}, not algolia")
        if not bundles:
            raise CredentialsNotFound("no theme bundle scripts found on the JB collection page")
        if self._last_bundle in bundles:  # same hash => same key: 1 JS request
            bundles.remove(self._last_bundle)
            bundles.insert(0, self._last_bundle)
        for theme, bundle in bundles:
            # Never from cache: a rotated key must be read fresh.
            js = client.get(f"{STOREFRONT}/cdn/shop/t/{theme}/assets/{bundle}", use_cache=False).text
            found = parse_bundle(js)
            if found:
                self._last_bundle = (theme, bundle)
                app_id, key, index = found
                log.info(
                    "jb-hi-fi: Algolia config in theme %s %s (app %s, index %s)", theme, bundle, app_id, index
                )
                self.config = AlgoliaConfig(app_id, key, index, bundle, theme, filters, self.clock())
                return self.config
        raise CredentialsNotFound(f"Algolia config not found in {len(bundles)} JB theme bundles")

    def _config(self, client: PoliteClient) -> AlgoliaConfig:
        if self.config is None or self.clock() - self.config.fetched_at > CONFIG_TTL_SECONDS:
            return self.discover_config(client)
        return self.config

    def _query(self, client: PoliteClient, params: dict[str, Any]) -> dict[str, Any]:
        """One Algolia query; re-discovers credentials once on 401/403/404."""
        for attempt in (1, 2):
            cfg = self._config(client)
            url = f"{cfg.host}/1/indexes/{cfg.index}?{urlencode(params)}"
            headers = {
                "X-Algolia-Application-Id": cfg.app_id,
                "X-Algolia-API-Key": cfg.api_key,
                "Referer": f"{STOREFRONT}/",
            }
            r = client.get(url, headers=headers, pass_statuses=(401, 403, 404))
            if r.status_code in (401, 403, 404):
                log.warning("jb-hi-fi: Algolia HTTP %s (%s); re-discovering", r.status_code, r.text[:120])
                self.config = None
                if attempt == 2:
                    raise RuntimeError(
                        f"JB Algolia rejected freshly discovered credentials: HTTP {r.status_code}"
                    )
                continue
            payload = json.loads(r.text)
            if not isinstance(payload, dict):
                raise ValueError("unexpected Algolia response")
            return payload
        raise AssertionError("unreachable")

    # ------------------------------------------------------------- polling
    def discover(self, client: PoliteClient) -> Iterable[Observation]:
        out: list[Observation] = []
        for game in ("pokemon", "one-piece"):
            filters = QUERIES[game]
            cfg = self._config(client)
            if game == "pokemon":  # JB merchandisers' own filter, as the page uses it
                filters = combine_filters(cfg.pokemon_filter, QUERIES["pokemon"])
            payload = self._query(
                client,
                {
                    "query": QUERY_TEXT[game],
                    "filters": filters,
                    "hitsPerPage": 100,
                    "attributesToRetrieve": ",".join(ATTRIBUTES),
                    "attributesToHighlight": "",
                },
            )
            out.extend(parse_hits(payload, observed_at=datetime.now(UTC)))
        for obs in out:
            handle = str(obs.raw.get("handle") or "")
            self.handles[handle] = obs.sku
            if not obs.is_marketplace_seller:
                self.first_party[obs.sku] = handle
        return out

    def watch(self, client: PoliteClient, urls: Iterable[str]) -> Iterable[Observation]:
        skus = list(dict.fromkeys([*watch_skus(urls, self.handles), *self.first_party]))
        if not skus:
            return self.discover(client)  # nothing known yet: learn the catalogue first
        return list(self._watch_batches(client, skus))

    def _watch_batches(self, client: PoliteClient, skus: list[str]) -> Iterator[Observation]:
        for i in range(0, len(skus), WATCH_BATCH):
            payload = self._query(
                client,
                {
                    "query": "",
                    "filters": sku_filter(skus[i : i + WATCH_BATCH]),
                    "hitsPerPage": WATCH_BATCH,
                    "attributesToRetrieve": ",".join(ATTRIBUTES),
                    "attributesToHighlight": "",
                },
            )
            yield from parse_hits(payload, observed_at=datetime.now(UTC))
