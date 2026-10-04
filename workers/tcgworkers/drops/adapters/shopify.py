"""Generic Shopify adapter: any store whose ``retailers`` row has
``platform = 'shopify'`` (adapter ``shopify``) and ``config.collections``.

Source (preference 1, brief 9.2): the storefront's own public collection
feed, ``GET /collections/<handle>/products.json?limit=250&page=N``, paged
until an empty or short page (at most ``max_pages`` pages per collection).
One cheap request per page. Discovery reads every page; the fast watch pass
in between reads only the first page of each collection, where stores list
their new, featured and best-selling stock (a booster box restock), so a
store with a big catalogue costs one request per collection per minute.

Mapping, per product (the product is the unit; its variants are usually
editions or quantities of the same thing):

* SKU = the Shopify product id (stable across title/handle edits);
* available = any variant ``available``; no ``available`` field at all ->
  UNKNOWN (some stores hide it);
* "pre-order" / "preorder" / "pre order" in the title, product type or tags
  while available -> PREORDER;
* price = the lowest available variant's price (else the lowest price);
* URL ``https://<host>/products/<handle>``; image = images[0].src (https only);
* game / language hints from the product type, tags and the collection handle.
"""

from __future__ import annotations

import html
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import quote

from tcgworkers.drops.adapters.catalogue import CatalogueAdapter, hint_game, https_image, lang_in_text
from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.models import Availability, Observation
from tcgworkers.drops.release_dates import find_release_date, plain_text

PAGE_LIMIT = 250
_PREORDER = re.compile(r"\bpre[\s-]?orders?\b|\bpreorders?\b", re.IGNORECASE)


def _tags(product: dict[str, Any]) -> list[str]:
    tags = product.get("tags") or []
    if isinstance(tags, str):  # older themes: "a, b, c"
        tags = tags.split(",")
    return [str(t).strip() for t in tags if str(t).strip()]


def _money(value: Any) -> Decimal | None:
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return d.quantize(Decimal("0.01")) if d > 0 else None


def is_preorder(*texts: str) -> bool:
    return any(_PREORDER.search(t) for t in texts if t)


def availability_of(product: dict[str, Any]) -> Availability:
    variants = [v for v in product.get("variants") or [] if isinstance(v, dict)]
    flags = [v["available"] for v in variants if isinstance(v.get("available"), bool)]
    if not flags:
        return Availability.UNKNOWN
    if any(flags):
        tags = " ".join(_tags(product))
        if is_preorder(str(product.get("title") or ""), str(product.get("product_type") or ""), tags):
            return Availability.PREORDER
        return Availability.IN_STOCK_ONLINE
    return Availability.OUT_OF_STOCK


def price_of(product: dict[str, Any]) -> Decimal | None:
    variants = [v for v in product.get("variants") or [] if isinstance(v, dict)]
    available = [p for v in variants if v.get("available") is True and (p := _money(v.get("price")))]
    prices = available or [p for v in variants if (p := _money(v.get("price")))]
    return min(prices) if prices else None


def parse_product(
    product: dict[str, Any],
    *,
    retailer: str,
    base_url: str,
    collection: str,
    observed_at: datetime,
) -> Observation | None:
    pid = product.get("id")
    handle = str(product.get("handle") or "").strip()
    title = html.unescape(str(product.get("title") or "")).strip()
    if not pid or not handle or not title:
        return None
    product_type = str(product.get("product_type") or "")
    tags = _tags(product)
    vendor = str(product.get("vendor") or "")
    images = [i for i in product.get("images") or [] if isinstance(i, dict)]
    variants = [v for v in product.get("variants") or [] if isinstance(v, dict)]
    category_text = " ".join([product_type, *tags])
    released = find_release_date(
        title, plain_text(product.get("body_html")), " ".join(tags), today=observed_at.date()
    )
    return Observation(
        retailer=retailer,
        sku=str(pid),
        url=f"{base_url}/products/{quote(handle)}",
        title=title,
        availability=availability_of(product),
        price_aud=price_of(product),
        observed_at=observed_at,
        raw={
            "platform": "shopify",
            "handle": handle,
            "collection": collection,
            "product_type": product_type,
            "vendor": vendor,
            "tags": tags[:30],
            "variants": [
                {
                    "id": v.get("id"),
                    "title": v.get("title"),
                    "available": v.get("available"),
                    "price": v.get("price"),
                }
                for v in variants[:10]
            ],
            "published_at": product.get("published_at"),
            "created_at": product.get("created_at"),
            "updated_at": product.get("updated_at"),
        },
        image_url=https_image(images[0].get("src")) if images else None,
        game_hint=hint_game(category_text, vendor) or hint_game(collection),
        lang_hint=lang_in_text(category_text) or lang_in_text(collection),
        cart_url=cart_url(base_url, variants),
        release_date=released[0] if released else None,
        release_date_precision=released[1] if released else "day",
    )


def cart_url(base_url: str, variants: list[dict[str, Any]]) -> str | None:
    """The store's cart permalink (/cart/{variant}:1 adds one and opens
    checkout), only when it is clear which item it adds: the one variant, or
    the only one that can be bought. A pack/box choice gets no link."""
    if not base_url.startswith("https://"):
        return None
    buyable = [v for v in variants if v.get("available") is True]
    pick = buyable if buyable else variants
    if len(pick) != 1 or (len(variants) > 1 and not buyable):
        return None
    vid = str(pick[0].get("id") or "")
    return f"{base_url.rstrip('/')}/cart/{vid}:1" if re.fullmatch(r"[0-9]{1,20}", vid) else None


def parse_page(
    data: Any, *, retailer: str, base_url: str, collection: str, observed_at: datetime
) -> tuple[int, list[tuple[Observation, dict[str, Any]]]]:
    """(products on the page, parsed observations with their source product)."""
    if not isinstance(data, dict) or not isinstance(data.get("products"), list):
        raise ValueError(f"{retailer}: not a Shopify products.json page")
    products = [p for p in data["products"] if isinstance(p, dict)]
    out: list[tuple[Observation, dict[str, Any]]] = []
    for p in products:
        obs = parse_product(
            p, retailer=retailer, base_url=base_url, collection=collection, observed_at=observed_at
        )
        if obs is not None:
            out.append((obs, p))
    return len(data["products"]), out


class ShopifyAdapter(CatalogueAdapter):
    platform = "shopify"

    @property
    def collections(self) -> list[str]:
        return [str(c).strip().strip("/") for c in self.config.get("collections") or [] if str(c).strip()]

    def page_url(self, collection: str, page: int) -> str:
        return f"{self.base_url}/collections/{quote(collection)}/products.json?limit={PAGE_LIMIT}&page={page}"

    def watch(self, client: PoliteClient, urls: Iterable[str]) -> Iterable[Observation]:
        """The fast pass: first page of each collection. Products it doesn't
        reach are left as they were (the next discovery reads them). A first
        page with no TCG product at all reads everything instead, so a store
        is never counted as empty because of what its first page holds."""
        self.check_cooldown()
        seen: dict[str, Observation] = {}
        for obs in self.fetch_all(client, pages=1):
            seen.setdefault(obs.sku, obs)
        return list(seen.values()) or self.discover(client)

    def fetch_all(self, client: PoliteClient, pages: int | None = None) -> Iterable[Observation]:
        if not self.collections:
            raise LookupError(f"{self.slug}: config.collections is empty")
        for collection in self.collections:
            for page in range(1, min(pages or self.max_pages, self.max_pages) + 1):
                data, _ = self.get_json(client, self.page_url(collection, page))
                count, parsed = parse_page(
                    data,
                    retailer=self.slug,
                    base_url=self.base_url,
                    collection=collection,
                    observed_at=datetime.now(UTC),
                )
                for obs, p in parsed:
                    tags = _tags(p)
                    if self.keep(obs.title, product_type=str(p.get("product_type") or ""), tags=tags):
                        yield obs
                if count < PAGE_LIMIT:  # empty or last page: no need to ask for the next one
                    break
