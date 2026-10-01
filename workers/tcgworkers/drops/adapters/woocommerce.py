"""Generic WooCommerce adapter: any store whose ``retailers`` row has
``platform = 'woocommerce'`` (adapter ``woocommerce``) and ``config.categories``
(category ids, slugs, or ``{"id": 82, "slug": "pokemon"}`` objects).

Source (preference 1, brief 9.2): the public Store API the shop's own
blocks use, ``GET /wp-json/wc/store/v1/products?category=<id>&per_page=100&page=N``,
paged until an empty or short page / ``X-WP-TotalPages`` (at most
``max_pages`` pages per category).

Mapping, per product:

* SKU = the WooCommerce product id; URL = ``permalink``; image = images[0].src;
* price = ``prices.price`` in minor units / 10^``currency_minor_unit`` (the
  range minimum for variable products), AUD only;
* on backorder (``is_on_backorder`` / ``available-on-backorder``) or
  "pre-order" in the name, categories, tags or add-to-cart text, while
  purchasable -> PREORDER;
* ``is_in_stock`` and purchasable -> IN_STOCK_ONLINE; not in stock -> OUT_OF_STOCK.
"""

from __future__ import annotations

import html
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from tcgworkers.drops.adapters.catalogue import CatalogueAdapter, hint_game, https_image, lang_in_text
from tcgworkers.drops.adapters.shopify import is_preorder
from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.models import Availability, Observation

PER_PAGE = 100
STORE_API = "/wp-json/wc/store/v1/products"
_TAG = re.compile(r"<[^>]+>")


def _text(value: Any) -> str:
    return " ".join(html.unescape(_TAG.sub(" ", str(value or ""))).split())


def _names(items: Any) -> list[str]:
    return [_text(i.get("name")) for i in items or [] if isinstance(i, dict) and i.get("name")]


def price_of(product: dict[str, Any]) -> Decimal | None:
    prices = product.get("prices") or {}
    if not isinstance(prices, dict):
        return None
    if prices.get("currency_code") not in (None, "", "AUD"):
        return None
    raw = prices.get("price")
    if raw in (None, "", "0"):
        raw = (prices.get("price_range") or {}).get("min_amount")
    try:
        minor = int(prices.get("currency_minor_unit", 2))
        value = Decimal(str(raw)).scaleb(-minor)
    except (InvalidOperation, ValueError, TypeError):
        return None
    return value.quantize(Decimal("0.01")) if value > 0 else None


def availability_of(product: dict[str, Any]) -> Availability:
    if "is_in_stock" not in product:
        return Availability.UNKNOWN
    purchasable = product.get("is_purchasable", True) is not False
    stock_class = str((product.get("stock_availability") or {}).get("class") or "")
    backorder = bool(product.get("is_on_backorder")) or stock_class == "available-on-backorder"
    texts = [
        _text(product.get("name")),
        " ".join(_names(product.get("categories"))),
        " ".join(_names(product.get("tags"))),
        _text((product.get("add_to_cart") or {}).get("text")),
        _text((product.get("stock_availability") or {}).get("text")),
    ]
    if product.get("is_in_stock") and purchasable:
        return Availability.PREORDER if backorder or is_preorder(*texts) else Availability.IN_STOCK_ONLINE
    return Availability.OUT_OF_STOCK


def parse_product(
    product: dict[str, Any], *, retailer: str, category: str, observed_at: datetime
) -> Observation | None:
    pid = product.get("id")
    title = _text(product.get("name"))
    url = str(product.get("permalink") or "")
    if not pid or not title or not url.startswith(("https://", "http://")):
        return None
    categories = _names(product.get("categories"))
    tags = _names(product.get("tags"))
    images = [i for i in product.get("images") or [] if isinstance(i, dict)]
    category_text = " ".join([*categories, *tags])
    return Observation(
        retailer=retailer,
        sku=str(pid),
        url=url,
        title=title,
        availability=availability_of(product),
        price_aud=price_of(product),
        observed_at=observed_at,
        raw={
            "platform": "woocommerce",
            "category": category,
            "categories": categories[:20],
            "tags": tags[:30],
            "sku": product.get("sku"),
            "is_in_stock": product.get("is_in_stock"),
            "is_purchasable": product.get("is_purchasable"),
            "is_on_backorder": product.get("is_on_backorder"),
            "low_stock_remaining": product.get("low_stock_remaining"),
            "add_to_cart": (product.get("add_to_cart") or {}).get("text"),
        },
        image_url=https_image(images[0].get("src")) if images else None,
        game_hint=hint_game(category_text) or hint_game(category),
        lang_hint=lang_in_text(category_text) or lang_in_text(category),
    )


def category_param(item: Any) -> str:
    """A config.categories entry -> the Store API ``category`` value (id preferred)."""
    if isinstance(item, dict):
        item = item.get("id") or item.get("slug")
    return str(item or "").strip()


class WooCommerceAdapter(CatalogueAdapter):
    platform = "woocommerce"

    @property
    def categories(self) -> list[str]:
        return [c for c in (category_param(i) for i in self.config.get("categories") or []) if c]

    def page_url(self, category: str, page: int) -> str:
        return f"{self.base_url}{STORE_API}?category={category}&per_page={PER_PAGE}&page={page}"

    def fetch_all(self, client: PoliteClient) -> Iterable[Observation]:
        if not self.categories:
            raise LookupError(f"{self.slug}: config.categories is empty")
        for category in self.categories:
            for page in range(1, self.max_pages + 1):
                data, response = self.get_json(client, self.page_url(category, page))
                if not isinstance(data, list):
                    raise ValueError(f"{self.slug}: not a WooCommerce Store API product list")
                now = datetime.now(UTC)
                for p in data:
                    if not isinstance(p, dict):
                        continue
                    obs = parse_product(p, retailer=self.slug, category=category, observed_at=now)
                    if obs is None:
                        continue
                    product_type = " ".join(_names(p.get("categories")))
                    if self.keep(obs.title, product_type=product_type, tags=_names(p.get("tags"))):
                        yield obs
                total = response.headers.get("X-WP-TotalPages", "")
                if len(data) < PER_PAGE or (total.isdigit() and page >= int(total)):
                    break
