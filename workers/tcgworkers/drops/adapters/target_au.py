"""Target Australia adapter (registered, retailer row DISABLED).

docs/research/07-retailers-pricing-ebay.md §A. Target's own category pages
server-render their product list in ``__NEXT_DATA__``
(``props.pageProps.metadata.productList.products``). We read exactly two
robots-allowed category URLs, with no ``sortBy``/``sortOrder``/``viewAs``/
``newarrivals`` params, never ``/search/*``, and never Constructor.io or the
BFF GraphQL endpoint.

Before enabling (all three are Jamie's call):
1. Target's edge (Akamai) denies cloud IPs today; the Fly.io syd probe in
   07 §C.4 must show the category HTML is served to an honest bot UA. Until
   then the polite client sees 403 / a disallowing robots.txt and the cycle
   fails loudly (health alert), which is correct.
2. Target's ToS forbids deep-linking without consent. Alerts therefore link
   to the category page unless ``TARGET_DEEP_LINKS_OK=true`` (set it only once
   Target has consented); the product URL is still kept in ``raw``.
3. Which field marks a pre-order is UNVERIFIED (07 §A.7); we treat
   ``pTypeCode``/``productDisplayType`` values containing "pre" as pre-order.

Availability mapping: ``AVAILABLE_FOR_SALE`` + ``inStock`` -> in stock online
(the listing doesn't split click & collect); ``COMING_SOON`` or not in stock
-> out of stock, so ``COMING_SOON`` -> ``AVAILABLE_FOR_SALE`` fires IN_STOCK.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from tcgworkers.drops.adapters.category_page import CategoryPageAdapter
from tcgworkers.drops.base import register
from tcgworkers.drops.models import Availability, Observation

log = logging.getLogger(__name__)

SLUG = "target-au"
POKEMON_URL = "https://www.target.com.au/c/toys/trading-card-games/pokemon-cards/W1852642"
ONE_PIECE_URL = "https://www.target.com.au/c/toys/trading-card-games/one-piece-trading-cards/W130520251"


def product_list(data: dict[str, Any]) -> dict[str, Any]:
    """``productList`` from a full __NEXT_DATA__ document (or a trimmed fixture)."""
    for path in (("props", "pageProps", "metadata", "productList"), ("productList",)):
        node: Any = data
        for key in path:
            node = node.get(key) if isinstance(node, dict) else None
        if isinstance(node, dict):
            return node
    raise ValueError("no productList in Target __NEXT_DATA__")


def availability_of(product: dict[str, Any]) -> Availability:
    variations = product.get("variations") or [{}]
    v = variations[0] if isinstance(variations[0], dict) else {}
    display = str(v.get("productDisplayType") or "").upper()
    ptype = str((product.get("labelProps") or {}).get("pTypeCode") or "").lower()
    if "PRE" in display or "pre" in ptype:
        return Availability.PREORDER
    if display == "AVAILABLE_FOR_SALE" and any(
        bool(x.get("inStock")) for x in variations if isinstance(x, dict)
    ):
        return Availability.IN_STOCK_ONLINE
    if display or "inStock" in v:
        return Availability.OUT_OF_STOCK
    return Availability.UNKNOWN


def _price(product: dict[str, Any]) -> Decimal | None:
    value = (product.get("price") or {}).get("offerPrice")
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return d.quantize(Decimal("0.01")) if d > 0 else None


def parse_products(
    data: dict[str, Any], *, category_url: str, observed_at: datetime, deep_links: bool
) -> list[Observation]:
    plist = product_list(data)
    products = [p for p in plist.get("products") or [] if isinstance(p, dict)]
    total = plist.get("totalNumProducts")
    if isinstance(total, int) and total > len(products):
        # Page 2+ uses an UNVERIFIED param; flag it rather than guess (07 §A.9).
        log.warning(
            "target-au: %s lists %d of %d products (first page only)", category_url, len(products), total
        )
    out: list[Observation] = []
    for p in products:
        pid = str(p.get("id") or "")
        if not pid:
            continue
        variations = p.get("variations") or [{}]
        first = variations[0] if variations and isinstance(variations[0], dict) else {}
        product_url = str(first.get("url") or p.get("baseProductUrl") or "")
        out.append(
            Observation(
                retailer=SLUG,
                sku=pid,
                url=product_url if deep_links and product_url else category_url,
                title=str(p.get("title") or "").strip(),
                availability=availability_of(p),
                price_aud=_price(p),
                observed_at=observed_at,
                raw={
                    "product_url": product_url,
                    "productDisplayType": first.get("productDisplayType"),
                    "inStock": first.get("inStock"),
                    "comingSoon": first.get("comingSoon"),
                    "onlineDate": (p.get("labelProps") or {}).get("onlineDate"),
                    "onePassEarlyAccess": p.get("onePassEarlyAccess"),
                    "onepassexclusive": p.get("onepassexclusive"),
                    "onePassStartDate": p.get("onePassStartDate"),
                },
            )
        )
    return out


@register
class TargetAu(CategoryPageAdapter):
    slug = SLUG
    name = "Target"
    category_urls = (POKEMON_URL, ONE_PIECE_URL)

    def __init__(self, deep_links: bool | None = None) -> None:
        self.deep_links = (
            os.environ.get("TARGET_DEEP_LINKS_OK", "false").lower() == "true"
            if deep_links is None
            else deep_links
        )

    def parse(self, data: dict[str, Any], *, category_url: str, observed_at: datetime) -> list[Observation]:
        return parse_products(
            data, category_url=category_url, observed_at=observed_at, deep_links=self.deep_links
        )
