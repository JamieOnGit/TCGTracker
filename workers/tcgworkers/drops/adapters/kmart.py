"""Kmart Australia adapter.

Kmart's robots.txt allows its category and product pages (it disallows
``/api/``, checkout, accounts and some query parameters, none of which we use),
and its edge serves them to our honestly identified bot. Everything is read
from the pages' own markup:

* the category pages' schema.org ``ItemList`` (JSON-LD, 60 per page,
  ``?page=N`` for the rest) lists every product URL in the Pokémon
  trading-card category, so a new product appears there as soon as Kmart
  publishes it;
* each product page's ``__NEXT_DATA__`` (``pageProps.productDetail``) carries
  the name, price, image, ``isPreOrderActive`` and ``stateOOS`` (the states it
  is out of stock in).

The first cycle after start-up reads every listed product once. After that,
a cycle reads the category page, fetches every product URL it hasn't seen
before straight away (new listings alert within one cycle), then refreshes a
few known products in rotation for stock and price changes. Requests are
spaced by the polite client (2-6 s per host). Products not fetched this cycle
are simply not reported; nothing treats an unreported product as sold out.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from tcgworkers.drops.base import AdapterBlocked, RetailerAdapter, next_data, register
from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.models import Availability, Observation

log = logging.getLogger(__name__)

SLUG = "kmart"
BASE = "https://www.kmart.com.au"
CATEGORY_URLS: tuple[tuple[str, str], ...] = ((f"{BASE}/category/toys/pokemon-trading-cards/", "pokemon"),)
# A product out of stock in every state can't be bought online.
STATES = ("NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT")
NEW_PER_CYCLE = 15
PAGE_SIZE = 60  # products per category page; ?page=N for the rest
MAX_PAGES = 10
REFRESH_PER_CYCLE = 6

_LD_JSON = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.DOTALL)


def item_list_urls(html: str) -> list[str]:
    """Product URLs from the category page's schema.org ItemList."""
    for m in _LD_JSON.finditer(html):
        try:
            doc = json.loads(m.group(1))
        except ValueError:
            continue
        for node in doc if isinstance(doc, list) else [doc]:
            if isinstance(node, dict) and node.get("@type") == "ItemList":
                urls: list[str] = []
                for el in node.get("itemListElement") or []:
                    url = el.get("url") if isinstance(el, dict) else None
                    if isinstance(url, str) and url.startswith(f"{BASE}/product/"):
                        urls.append(url.split("?")[0])
                return list(dict.fromkeys(urls))
    raise ValueError("no ItemList on the category page (layout changed or a challenge page)")


def _product_data(data: dict[str, Any]) -> dict[str, Any]:
    pd = ((data.get("props") or {}).get("pageProps") or {}).get("productDetail") or data.get("productDetail")
    products = (pd or {}).get("products") or []
    item = products[0].get("item") if products and isinstance(products[0], dict) else None
    if not isinstance(item, dict) or not isinstance(item.get("data"), dict):
        raise ValueError("no productDetail in Kmart __NEXT_DATA__")
    return {"title": item.get("value"), **item["data"]}


def availability_of(d: dict[str, Any]) -> Availability:
    """``stateOOS`` lists the states a product is out of stock in. When Kmart
    publishes no stock data at all, report unknown rather than guess."""
    if d.get("isPreOrderActive"):
        return Availability.PREORDER
    oos = d.get("stateOOS")
    if isinstance(oos, dict):
        out = {str(k).upper() for k in oos}
        return Availability.OUT_OF_STOCK if all(s in out for s in STATES) else Availability.IN_STOCK_ONLINE
    return Availability.UNKNOWN


def is_marketplace(d: dict[str, Any]) -> bool:
    """Third-party Kmart Marketplace sellers (often far above RRP), not Kmart's own stock."""
    sellers = [str(x).lower() for x in d.get("Seller") or []]
    return bool(sellers) and not any(x in ("kmart", "target") for x in sellers)


def _price(d: dict[str, Any]) -> Decimal | None:
    try:
        p = Decimal(str(d.get("price")))
    except (InvalidOperation, ValueError):
        return None
    return p.quantize(Decimal("0.01")) if p > 0 else None


def parse_product(data: dict[str, Any], *, url: str, observed_at: datetime, game: str | None) -> Observation:
    d = _product_data(data)
    sku = str(d.get("variation_id") or d.get("id") or "").removeprefix("P_")
    if not sku:
        raise ValueError("Kmart product has no id")
    image = d.get("image_url")
    return Observation(
        retailer=SLUG,
        sku=sku,
        url=url,
        title=str(d.get("title") or "").strip(),
        availability=availability_of(d),
        price_aud=_price(d),
        observed_at=observed_at,
        is_marketplace_seller=is_marketplace(d),
        image_url=image if isinstance(image, str) and image.startswith("https://") else None,
        game_hint=game,
        raw={
            "isPreOrderActive": d.get("isPreOrderActive"),
            "preOrderReleaseDate": d.get("preOrderReleaseDate"),
            "stateOOS": d.get("stateOOS"),
            "badges": d.get("badges"),
            "merchClass": d.get("MerchClassName"),
            "seller": d.get("Seller"),
        },
    )


@dataclass
class _Known:
    game: str | None
    checked: int = 0


@register
class Kmart(RetailerAdapter):
    slug = SLUG
    name = "Kmart"
    categories: tuple[tuple[str, str], ...] = CATEGORY_URLS
    new_per_cycle: int = NEW_PER_CYCLE
    refresh_per_cycle: int = REFRESH_PER_CYCLE

    def __init__(self) -> None:
        self.known: dict[str, _Known] = {}
        self._tick = 0

    def _product(self, client: PoliteClient, url: str, game: str | None) -> Observation | None:
        html = client.get(url).text
        try:
            return parse_product(next_data(html), url=url, observed_at=datetime.now(UTC), game=game)
        except ValueError as exc:
            log.warning("kmart: %s: %s", url, exc)
            return None

    def discover(self, client: PoliteClient) -> Iterable[Observation]:
        listed: dict[str, str] = {}
        for url, game in self.categories:
            for page in range(1, MAX_PAGES + 1):
                page_url = url if page == 1 else f"{url}?page={page}"
                try:
                    urls = item_list_urls(client.get(page_url).text)
                except ValueError as exc:
                    if page == 1:
                        raise AdapterBlocked(f"Kmart: {page_url}: {exc}") from exc
                    break
                fresh = [u for u in urls if u not in listed]
                for product_url in fresh:
                    listed[product_url] = game
                if len(urls) < PAGE_SIZE or not fresh:
                    break

        new = [u for u in listed if u not in self.known]
        for u, game in listed.items():
            self.known.setdefault(u, _Known(game=game))
        for u in list(self.known):
            if u not in listed:
                del self.known[u]  # delisted; its last state stays in the database

        # The first cycle after start-up reads every product once, so the whole
        # range is stored together (the retailer's first ever scan is a silent
        # baseline) instead of old products trickling in later as "new".
        warm_up = self._tick == 0
        self._tick += 1
        due = sorted((u for u in self.known if u not in new), key=lambda u: self.known[u].checked)
        batch = new if warm_up else new[: self.new_per_cycle] + due[: self.refresh_per_cycle]
        out: list[Observation] = []
        for u in batch:
            obs = self._product(client, u, self.known[u].game)
            self.known[u].checked = self._tick
            if obs is not None:
                out.append(obs)
        return out

    def watch(self, client: PoliteClient, urls: Iterable[str]) -> Iterable[Observation]:
        """Watchlist product URLs are fetched directly; otherwise a normal cycle."""
        wanted = [u for u in urls if u.startswith(f"{BASE}/product/")]
        if not wanted:
            return self.discover(client)
        out = []
        for u in wanted:
            known = self.known.get(u)
            obs = self._product(client, u, known.game if known else "pokemon")
            if obs is not None:
                out.append(obs)
        return out
