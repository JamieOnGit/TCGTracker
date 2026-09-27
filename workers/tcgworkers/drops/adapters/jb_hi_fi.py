"""JB Hi-Fi adapter.

Source (preference 1, brief 9.2): the Algolia search index the storefront's
own collection pages query, with the same filters. See
docs/research/04-retailers.md section 2. Fixture-tested only; the retailer row
is seeded ``enabled = false`` until Jamie signs off the ToS review.

The Algolia app id and public search-only key are read from the environment
(JB_ALGOLIA_APP_ID, JB_ALGOLIA_SEARCH_KEY) rather than committed: they belong
to JB and can rotate.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode

from tcgworkers.drops.base import RetailerAdapter, register
from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.models import Availability, Observation

SLUG = "jb-hi-fi"
INDEX = "shopify_products_families"
PRODUCT_URL = "https://www.jbhifi.com.au/products/{handle}"
_BASE_FILTER = '("facets.Game type":"Trading card games" OR "category_hierarchy":"Trading card games")'
_LIVE = "(price > 0 AND product_published = 1 AND availability.displayProduct = 1)"
QUERIES: dict[str, str] = {
    "pokemon": f'{_BASE_FILTER} AND ("facets.Brands":"Pokemon TCG" OR "facets.Primary franchise":"Pokemon")'
    f" AND {_LIVE}",
    "one-piece": f"{_BASE_FILTER} AND {_LIVE}",
}
_IN = {"InStock", "LimitedStock"}


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
                raw={k: hit.get(k) for k in ("sku", "handle", "availability", "release_date", "updated_at")},
            )
        )
    return out


@register
class JbHiFi(RetailerAdapter):
    slug = SLUG
    name = "JB Hi-Fi"

    def __init__(self, app_id: str | None = None, search_key: str | None = None) -> None:
        self.app_id = app_id or os.environ.get("JB_ALGOLIA_APP_ID", "")
        self.search_key = search_key or os.environ.get("JB_ALGOLIA_SEARCH_KEY", "")

    def discover(self, client: PoliteClient) -> Iterable[Observation]:
        if not (self.app_id and self.search_key):
            raise RuntimeError("JB_ALGOLIA_APP_ID / JB_ALGOLIA_SEARCH_KEY not configured")
        headers = {"X-Algolia-Application-Id": self.app_id, "X-Algolia-API-Key": self.search_key}
        host = f"https://{self.app_id.lower()}-dsn.algolia.net"
        for query_name, filters in QUERIES.items():
            text = "one piece card game" if query_name == "one-piece" else ""
            params = urlencode({"query": text, "filters": filters, "hitsPerPage": 100})
            r = client.get(f"{host}/1/indexes/{INDEX}?{params}", headers=headers)
            yield from parse_hits(json.loads(r.text), observed_at=datetime.now(UTC))
