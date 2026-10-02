"""Kmart adapter: category ItemList + product pages (fixtures trimmed from the
live site on 2 Oct 2026, served to TCGTrackerBot with HTTP 200)."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

import httpx

from tcgworkers.drops.adapters.kmart import BASE, Kmart, item_list_urls, parse_product
from tcgworkers.drops.base import next_data
from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.models import Availability
from tcgworkers.drops.robots import Robots

UA = "TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/)"
CATEGORY = f"{BASE}/category/toys/pokemon-trading-cards/"
ROBOTS = (
    "User-agent: *\nAllow: /\nDisallow: /login\nDisallow: /bag\nDisallow: /checkout\n"
    "Disallow: /api/\nDisallow: *?postcode=\nDisallow: /product-discovery*?*\n"
)


def _fx(fixtures: Path, name: str) -> str:
    return (fixtures / "retailers/kmart" / name).read_text()


def test_category_item_list(fixtures):
    urls = item_list_urls(_fx(fixtures, "category.html"))
    assert len(urls) == 3
    assert all(u.startswith(f"{BASE}/product/") and "?" not in u for u in urls)


def test_preorder_product(fixtures):
    obs = parse_product(
        next_data(_fx(fixtures, "product_preorder.html")),
        url=f"{BASE}/product/x/",
        observed_at=datetime.now(UTC),
        game="pokemon",
    )
    assert obs.sku == "43818617"
    assert obs.title == "Pokemon TCG: 30th Celebration Booster Bundle"
    assert obs.availability is Availability.PREORDER
    assert str(obs.price_aud) == "54.00"
    assert obs.raw["preOrderReleaseDate"] == "2026-10-02"
    assert not obs.is_marketplace_seller
    assert obs.image_url and obs.image_url.startswith("https://assets.kmart.com.au/")


def test_marketplace_seller_mostly_out_of_stock(fixtures):
    obs = parse_product(
        next_data(_fx(fixtures, "product_nostock.html")),
        url=f"{BASE}/product/y/",
        observed_at=datetime.now(UTC),
        game="pokemon",
    )
    # Out of stock in 7 states but not NSW: still buyable online.
    assert obs.availability is Availability.IN_STOCK_ONLINE
    assert obs.is_marketplace_seller


def test_out_of_stock_everywhere_and_no_data():
    def doc(state_oos):
        return {
            "props": {
                "pageProps": {
                    "productDetail": {
                        "products": [
                            {
                                "item": {
                                    "value": "ETB",
                                    "data": {
                                        "variation_id": "1",
                                        "price": 89,
                                        "Seller": ["Kmart"],
                                        "stateOOS": state_oos,
                                    },
                                }
                            }
                        ]
                    }
                }
            }
        }

    every = {s: "9" for s in ("NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT")}
    now = datetime.now(UTC)
    assert (
        parse_product(doc(every), url="u", observed_at=now, game=None).availability
        is Availability.OUT_OF_STOCK
    )
    assert parse_product(doc(None), url="u", observed_at=now, game=None).availability is Availability.UNKNOWN


class FakeKmart:
    """Category pages (?page=N) and product pages from fixtures, with a robots.txt."""

    def __init__(self, fixtures: Path, *, extra: list[str] | None = None) -> None:
        self.category = _fx(fixtures, "category.html")
        self.product = _fx(fixtures, "product_preorder.html")
        self.extra = extra or []
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append(url)
        if url.endswith("/robots.txt"):
            return httpx.Response(200, text=ROBOTS)
        if url.startswith(CATEGORY):
            if "page=" in url:
                return httpx.Response(200, text="<html></html>")
            html = self.category
            for u in self.extra:
                html = html.replace('"itemListElement": [', f'"itemListElement": [{{"url": "{u}"}}, ', 1)
            return httpx.Response(200, text=html)
        if "/product/" in url:
            return httpx.Response(200, text=self.product)
        return httpx.Response(404)


def _client(fake: FakeKmart) -> PoliteClient:
    client = PoliteClient(
        UA, min_delay=0, max_delay=0, transport=httpx.MockTransport(fake), sleep=lambda s: None
    )
    client.cache_ttl = 0  # real cycles are minutes apart; here they run back to back
    return client


def test_first_cycle_reads_every_product_then_only_new_and_a_few_known(fixtures):
    fake = FakeKmart(fixtures)
    adapter = Kmart()
    adapter.refresh_per_cycle = 1
    client = _client(fake)

    first = list(adapter.discover(client))
    assert len(first) == 3  # warm-up: every listed product, stored together as the baseline
    products = lambda: [c for c in fake.calls if "/product/" in c]  # noqa: E731
    assert len(products()) == 3

    fake.calls.clear()
    fake.extra = [f"{BASE}/product/brand-new-etb-1234/"]
    second = list(adapter.discover(client))
    fetched = products()
    assert fetched[0] == f"{BASE}/product/brand-new-etb-1234/"  # the new listing first
    assert len(fetched) == 2  # plus one known product in rotation
    assert len(second) == 2


def test_never_requests_disallowed_paths(fixtures):
    fake = FakeKmart(fixtures)
    list(Kmart().discover(_client(fake)))
    robots = Robots.parse(ROBOTS)
    assert all(robots.can_fetch(UA, u) for u in fake.calls if not u.endswith("/robots.txt"))
    assert not any(re.search(r"/api/|/search|postcode=|/checkout", u) for u in fake.calls)
