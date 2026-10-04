"""Generic Shopify / WooCommerce adapters, their politeness (429, 403,
challenge pages, robots, Crawl-delay, revalidation), the runner wiring for
generic platforms and the stock event semantics. No network: recorded JSON
fixtures through httpx.MockTransport."""

from __future__ import annotations

import copy
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal as D
from pathlib import Path
from typing import Any

import httpx
import pytest

from tcgworkers.config import Rules
from tcgworkers.drops.adapters import shopify, woocommerce
from tcgworkers.drops.adapters.jb_hi_fi import JbHiFi
from tcgworkers.drops.adapters.shopify import ShopifyAdapter
from tcgworkers.drops.adapters.woocommerce import WooCommerceAdapter
from tcgworkers.drops.base import AdapterBlocked
from tcgworkers.drops.engine import InMemoryStore, run_cycle
from tcgworkers.drops.filters import classify, non_sealed_reason
from tcgworkers.drops.http import BackingOff, Disallowed, PoliteClient
from tcgworkers.drops.models import Availability, EventType, Observation, ProductState
from tcgworkers.drops.robots import Robots
from tcgworkers.drops.runner import (
    GENERIC_MIN_DELAY,
    RetailerConfig,
    adapter_for,
    blocked_reason,
    client_for,
)
from tcgworkers.drops.state import diff
from tcgworkers.drops.store import KEEP

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)
SHOP = "https://shop.example"
Handler = Callable[[httpx.Request], httpx.Response]


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0
        self.slept: list[float] = []

    def now(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.slept.append(s)
        self.t += s


class Recorder:
    """Routes by path (+query) and records every request."""

    def __init__(
        self, routes: dict[str, Handler | httpx.Response], robots: str = "User-agent: *\nAllow: /\n"
    ):
        self.routes = routes
        self.robots = robots
        self.requests: list[httpx.Request] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text=self.robots)
        key = req.url.raw_path.decode()
        route = self.routes.get(key) or self.routes.get(req.url.path)
        if route is None:
            return httpx.Response(404, text="not found")
        return route(req) if callable(route) else route

    def paths(self) -> list[str]:
        return [r.url.raw_path.decode() for r in self.requests if r.url.path != "/robots.txt"]


def client(rec: Recorder, clock: FakeClock | None = None, **kw: Any) -> PoliteClient:
    clock = clock or FakeClock()
    return PoliteClient(
        "TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/)",
        transport=httpx.MockTransport(rec),
        clock=clock.now,
        sleep=clock.sleep,
        min_delay=5,
        max_delay=5,
        cache_ttl=0,
        **kw,
    )


def json_response(payload: Any, **headers: str) -> httpx.Response:
    return httpx.Response(200, json=payload, headers=headers)


def shopify_page(fixtures: Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((fixtures / "retailers/shopify/products-page1.json").read_text())
    return data


def woo_page(fixtures: Path) -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = json.loads(
        (fixtures / "retailers/woocommerce/mighty-collectibles-cat82-page1.json").read_text()
    )
    return data


def page1(handle: str) -> str:
    return f"/collections/{handle}/products.json?limit=250&page=1"


def shop_adapter(**config: Any) -> ShopifyAdapter:
    return ShopifyAdapter(
        slug="test-shop", name="Test Shop", base_url=SHOP + "/", config={"collections": ["pokemon"], **config}
    )


# ------------------------------------------------------------------ Shopify
def test_shopify_parsing_availability_price_variants_images(fixtures: Path) -> None:
    rec = Recorder({page1("pokemon"): json_response(shopify_page(fixtures))})
    got = {o.sku: o for o in shop_adapter().discover(client(rec))}
    # singles, live breaks, LEGO and other games never leave the adapter
    assert set(got) == {"8101", "8102", "8103", "8104", "8109", "8110", "8111"}

    etb = got["8101"]
    assert etb.availability is Availability.IN_STOCK_ONLINE and etb.price_aud == D("89.95")
    assert etb.url == f"{SHOP}/products/pokemon-tcg-prismatic-evolutions-elite-trainer-box"
    assert etb.image_url and etb.image_url.startswith(
        "https://cdn.shopify.com/"
    )  # protocol-relative -> https
    assert etb.game_hint == "pokemon" and etb.lang_hint == "en"
    assert etb.raw["handle"] == "pokemon-tcg-prismatic-evolutions-elite-trainer-box"

    sold_out = got["8102"]  # all variants sold out: lowest price, out of stock
    assert sold_out.availability is Availability.OUT_OF_STOCK and sold_out.price_aud == D("229.00")
    assert got["8103"].availability is Availability.PREORDER  # "PRE-ORDER" in title + tag
    tin = got["8104"]  # no game in the title: the store's product type supplies it
    assert tin.availability is Availability.IN_STOCK_ONLINE and tin.price_aud == D("17.95")
    assert tin.game_hint == "pokemon"
    jp = got["8109"]  # no "available" field at all
    assert jp.availability is Availability.UNKNOWN and jp.lang_hint == "jp" and jp.game_hint == "one-piece"
    entity = got["8110"]
    assert entity.title == "Pokémon TCG: Destined Rivals Booster Bundle"  # HTML entity decoded
    assert entity.image_url is None  # http image refused
    upc = got["8111"]  # price of the AVAILABLE variant, not the cheapest overall
    assert upc.availability is Availability.IN_STOCK_ONLINE and upc.price_aud == D("179.00")


def test_shopify_pages_until_an_empty_page_and_dedupes_across_collections(fixtures: Path) -> None:
    base = shopify_page(fixtures)["products"][0]
    full = []
    for i in range(250):
        p = copy.deepcopy(base)
        p["id"], p["handle"] = 9000 + i, f"etb-{i}"
        full.append(p)
    rec = Recorder(
        {
            page1("pokemon"): json_response({"products": full}),
            "/collections/pokemon/products.json?limit=250&page=2": json_response({"products": []}),
            page1("etbs"): json_response({"products": full[:3]}),  # same products in a 2nd collection
        }
    )
    adapter = shop_adapter(collections=["pokemon", "etbs"])
    got = list(adapter.discover(client(rec)))
    assert len(got) == 250 and len({o.sku for o in got}) == 250
    assert rec.paths() == [
        page1("pokemon"),
        "/collections/pokemon/products.json?limit=250&page=2",
        page1("etbs"),  # a short page: no page 2 request
    ]


def _products(base: dict[str, Any], n: int, *, start: int, title: str | None = None) -> list[dict[str, Any]]:
    out = []
    for i in range(n):
        p = copy.deepcopy(base)
        p["id"], p["handle"] = start + i, f"p-{start + i}"
        if title:
            p["title"] = title
        out.append(p)
    return out


def test_shopify_watch_reads_only_the_first_page_of_each_collection(fixtures: Path) -> None:
    base = shopify_page(fixtures)["products"][0]
    full = _products(base, 250, start=9000)
    rec = Recorder(
        {
            page1("pokemon"): json_response({"products": full}),
            "/collections/pokemon/products.json?limit=250&page=2": json_response({"products": full[:1]}),
            page1("etbs"): json_response({"products": full[:3]}),
        }
    )
    adapter = shop_adapter(collections=["pokemon", "etbs"])
    got = list(adapter.watch(client(rec), []))
    assert len(got) == 250
    # One request per collection, however big the catalogue: discovery reads the rest.
    assert rec.paths() == [page1("pokemon"), page1("etbs")]


def test_shopify_watch_reads_everything_when_first_pages_hold_nothing_we_track(fixtures: Path) -> None:
    base = shopify_page(fixtures)["products"][0]
    page2 = "/collections/all/products.json?limit=250&page=2"
    rec = Recorder(
        {
            page1("all"): json_response(
                {"products": _products(base, 250, start=1, title="LEGO Star Wars X-Wing")}
            ),
            page2: json_response({"products": _products(base, 1, start=5000)}),
        }
    )
    got = list(shop_adapter(collections=["all"]).watch(client(rec), []))
    # Never "an empty store" from page 1 alone: the full read finds the box on page 2.
    assert [o.sku for o in got] == ["5000"]
    assert rec.paths() == [page1("all"), page1("all"), page2]


def test_a_503_slows_every_shopify_store_down() -> None:
    from tcgworkers.drops.http import SharedGate

    gate = SharedGate("shopify", 2.0, floor=1.0, ceiling=60.0)
    rec = Recorder({page1("pokemon"): httpx.Response(503)})
    with pytest.raises(BackingOff):
        list(shop_adapter().discover(client(rec, gate=gate)))
    assert gate.min_interval == 3.0


def test_shopify_page_cap(fixtures: Path) -> None:
    base = shopify_page(fixtures)["products"][0]

    def full_page(req: httpx.Request) -> httpx.Response:
        page = int(req.url.params["page"])
        items = []
        for i in range(250):
            p = copy.deepcopy(base)
            p["id"] = page * 1000 + i
            items.append(p)
        return json_response({"products": items})

    rec = Recorder({"/collections/pokemon/products.json": full_page})
    adapter = ShopifyAdapter(
        slug="s", name="S", base_url=SHOP, config={"collections": ["pokemon"]}, max_pages=3
    )
    assert len(list(adapter.discover(client(rec)))) == 750
    assert len(rec.paths()) == 3


def test_store_keywords_and_exclude(fixtures: Path) -> None:
    rec = Recorder({page1("pokemon"): json_response(shopify_page(fixtures))})
    got = {
        o.sku
        for o in shop_adapter(keywords=["pokemon", "pokémon"], exclude=["ultra premium"]).discover(
            client(rec)
        )
    }
    assert got == {"8101", "8102", "8103", "8110"}


def test_shopify_429_honours_retry_after_and_stops_the_cycle(fixtures: Path) -> None:
    rec = Recorder({page1("pokemon"): httpx.Response(429, headers={"Retry-After": "300"})})
    clock = FakeClock()
    c = client(rec, clock)
    adapter = shop_adapter(collections=["pokemon", "etbs"])
    with pytest.raises(BackingOff) as exc:
        list(adapter.discover(c))
    assert exc.value.status == 429 and exc.value.until == pytest.approx(clock.t + 300)
    assert rec.paths() == [page1("pokemon")]  # the cycle stopped: no second collection
    with pytest.raises(BackingOff):
        list(adapter.discover(c))
    assert len(rec.paths()) == 1  # still cooling down: no request


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (httpx.Response(403, text="Forbidden"), "403"),
        (
            httpx.Response(403, text="<html>Just a moment...</html>", headers={"cf-mitigated": "challenge"}),
            "challenge",
        ),
        (
            httpx.Response(
                200,
                text="<html><title>Attention Required!</title>captcha</html>",
                headers={"Content-Type": "text/html"},
            ),
            "challenge",
        ),
    ],
)
def test_block_pages_raise_adapter_blocked_and_cool_down(response: httpx.Response, reason: str) -> None:
    rec = Recorder({page1("pokemon"): response})
    adapter = shop_adapter()
    c = client(rec)
    with pytest.raises(AdapterBlocked) as exc:
        list(adapter.discover(c))
    assert str(exc.value).startswith(reason)
    with pytest.raises(AdapterBlocked):
        list(adapter.discover(c))
    assert len(rec.paths()) == 1  # blocked: no further requests during the cool-down


def test_robots_disallow_is_reported_as_blocked() -> None:
    rec = Recorder({}, robots="User-agent: *\nDisallow: /collections/*/products.json\n")
    with pytest.raises(AdapterBlocked) as exc:
        list(shop_adapter().discover(client(rec)))
    assert str(exc.value).startswith("robots:")
    assert rec.paths() == []


def test_a_missing_collection_is_an_error_not_a_block() -> None:
    with pytest.raises(LookupError):
        list(shop_adapter().discover(client(Recorder({}))))


def test_html_without_a_challenge_is_a_parse_error() -> None:
    rec = Recorder({page1("pokemon"): httpx.Response(200, text="<html>store closed</html>")})
    with pytest.raises(ValueError):
        list(shop_adapter().discover(client(rec)))


def test_crawl_delay_is_honoured(fixtures: Path) -> None:
    rec = Recorder(
        {
            page1("pokemon"): json_response({"products": []}),
            page1("etbs"): json_response({"products": []}),
        },
        robots="User-agent: *\nCrawl-delay: 10\nDisallow: /checkout\n",
    )
    clock = FakeClock()
    list(shop_adapter(collections=["pokemon", "etbs"]).discover(client(rec, clock)))
    assert clock.slept == [10]  # Crawl-delay beats our 5 s minimum
    assert Robots.parse("User-agent: tcgtrackerbot\nCrawl-delay: 3\n").crawl_delay("TCGTrackerBot/1.0") == 3


def test_feed_is_revalidated_with_etag(fixtures: Path) -> None:
    seen: list[str | None] = []

    def page(req: httpx.Request) -> httpx.Response:
        seen.append(req.headers.get("If-None-Match"))
        if req.headers.get("If-None-Match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, json=shopify_page(fixtures), headers={"ETag": '"v1"'})

    rec = Recorder({page1("pokemon"): page})
    c = client(rec)
    adapter = shop_adapter()
    first = list(adapter.discover(c))
    second = list(adapter.discover(c))
    assert seen == [None, '"v1"'] and len(first) == len(second) == 7


def test_honest_user_agent_is_sent(fixtures: Path) -> None:
    rec = Recorder({page1("pokemon"): json_response({"products": []})})
    list(shop_adapter().discover(client(rec)))
    assert all(r.headers["User-Agent"].startswith("TCGTrackerBot/1.0") for r in rec.requests)


# ------------------------------------------------------------- WooCommerce
def test_woocommerce_parsing_minor_units_stock_backorder(fixtures: Path) -> None:
    products = woo_page(fixtures)
    rec = Recorder({"/wp-json/wc/store/v1/products": json_response(products)})
    adapter = WooCommerceAdapter(
        slug="mighty",
        name="Mighty",
        base_url="https://mightycollectibles.com.au",
        config={"categories": [{"id": 82, "slug": "pokemon"}]},
    )
    got = list(adapter.discover(client(rec)))
    assert rec.paths() == ["/wp-json/wc/store/v1/products?category=82&per_page=100&page=1"]
    titles = {o.title for o in got}
    assert "POKÉMON TCG Scarlet & Violet 151 Ultra-Premium Collection" in titles  # &#038; decoded
    assert not any("Binder" in t or "Figure" in t or "Unsealed" in t for t in titles)
    upc = next(o for o in got if "Ultra-Premium" in o.title)
    assert upc.price_aud == D("199.95") and upc.availability is Availability.OUT_OF_STOCK
    assert upc.url.startswith("https://mightycollectibles.com.au/product/")
    assert upc.image_url and upc.image_url.startswith("https://") and upc.game_hint == "pokemon"
    jp = next(o for o in got if "Triple Beat" in o.title)
    assert jp.price_aud == D("149.95")

    p = copy.deepcopy(products[0])
    p.update(is_in_stock=True, low_stock_remaining=2)
    assert woocommerce.availability_of(p) is Availability.IN_STOCK_ONLINE
    p.update(is_on_backorder=True)
    assert woocommerce.availability_of(p) is Availability.PREORDER
    p.update(is_on_backorder=False, add_to_cart={"text": "Pre-order now"})
    assert woocommerce.availability_of(p) is Availability.PREORDER
    p.update(is_purchasable=False, add_to_cart={"text": "Read more"})
    assert woocommerce.availability_of(p) is Availability.OUT_OF_STOCK
    p["prices"] = {**p["prices"], "price": "90", "currency_minor_unit": 0}
    assert woocommerce.price_of(p) == D("90.00")
    p["prices"] = {
        **p["prices"],
        "price": "",
        "currency_minor_unit": 2,
        "price_range": {"min_amount": "4995"},
    }
    assert woocommerce.price_of(p) == D("49.95")
    p["prices"] = {**p["prices"], "price": "4995", "currency_code": "USD"}
    assert woocommerce.price_of(p) is None  # never mislabel a foreign price as AUD


def test_woocommerce_paging_uses_total_pages(fixtures: Path) -> None:
    products = woo_page(fixtures)
    many = []
    for i in range(100):
        p = copy.deepcopy(products[1])
        p["id"] = 50000 + i
        many.append(p)
    rec = Recorder({"/wp-json/wc/store/v1/products": json_response(many, **{"X-WP-TotalPages": "1"})})
    adapter = WooCommerceAdapter(
        slug="w", name="W", base_url="https://w.example", config={"categories": ["pokemon"]}
    )
    assert len(list(adapter.discover(client(rec)))) == 100
    assert rec.paths() == ["/wp-json/wc/store/v1/products?category=pokemon&per_page=100&page=1"]


def test_woocommerce_403_is_blocked() -> None:
    rec = Recorder({"/wp-json/wc/store/v1/products": httpx.Response(401, json={"code": "rest_forbidden"})})
    adapter = WooCommerceAdapter(slug="w", name="W", base_url="https://w.example", config={"categories": [7]})
    with pytest.raises(AdapterBlocked, match=r"^401"):
        list(adapter.discover(client(rec)))


# ------------------------------------------------------------ the filters
@pytest.mark.parametrize(
    ("title", "product_type", "tags", "skipped"),
    [
        ("Pokemon TCG Prismatic Evolutions Booster Bundle", "Sealed", [], False),
        ("[Single Pack] Pokémon TCG - M5 - Abyss Eye - JP", "", [], False),
        ("Sleeved Booster - Surging Sparks", "", [], False),
        ("Umbreon ex 161/131 - Prismatic Evolutions", "", [], True),
        ("Monkey.D.Luffy OP05-119 SEC", "", [], True),
        ("Charizard PSA 10 Base Set", "", [], True),
        ("[ Live Break ] Destined Rivals Booster Box", "", [], True),
        ("Prismatic Evolutions ETB", "Pokemon Singles", [], True),
        ("Prismatic Evolutions ETB", "Sealed", ["Singles"], True),
        ("Prismatic Evolutions ETB Acrylic Case", "", [], True),
        ("Disney Lorcana Booster Box", "", [], True),
        ("Magic: The Gathering Foundations Play Booster Box", "", [], True),
        ("Pokemon Mystery Pack", "", [], True),
        ("Pokémon TCG Code Cards x10", "", [], True),
    ],
)
def test_non_sealed_filter(title: str, product_type: str, tags: list[str], skipped: bool) -> None:
    assert (non_sealed_reason(title, product_type=product_type, tags=tags) is not None) is skipped


def test_store_category_hint_lets_a_bare_product_title_through() -> None:
    assert not classify("Stellar Crown Mini Tin").is_tcg
    c = classify("Stellar Crown Mini Tin", game_hint="pokemon")
    assert c.is_tcg and c.game == "pokemon" and c.product_type == "tin"
    assert classify("Pokemon Prismatic Evolutions ETB").game == "pokemon"
    assert not classify("Yu-Gi-Oh! Booster Box", game_hint="pokemon").is_tcg


# ------------------------------------------------------- event semantics
def _obs(
    avail: Availability, price: str, at: datetime, sku: str = "8101", seller: bool = False
) -> Observation:
    return Observation(
        "test-shop",
        sku,
        f"{SHOP}/products/{sku}",
        "Pokémon TCG: Prismatic Evolutions Elite Trainer Box",
        avail,
        D(price),
        at,
        is_marketplace_seller=seller,
    )


def test_price_change_only_on_a_drop_of_at_least_five_percent() -> None:
    prev = ProductState(Availability.IN_STOCK_ONLINE, D("100.00"), False, T0)
    assert diff(prev, _obs(Availability.IN_STOCK_ONLINE, "96.00", T0)) == []  # -4%: stored, not alerted
    [e] = diff(prev, _obs(Availability.IN_STOCK_ONLINE, "95.00", T0))
    assert e.event_type is EventType.PRICE_CHANGE and e.previous_price_aud == D("100.00")
    assert diff(prev, _obs(Availability.IN_STOCK_ONLINE, "120.00", T0)) == []  # rises never alert
    assert diff(prev, _obs(Availability.IN_STOCK_ONLINE, "98.00", T0), min_price_drop_pct=D("1")) != []


def test_engine_event_semantics_for_a_generic_store() -> None:
    store = InMemoryStore()
    rules = Rules()

    def cycle(*obs: Observation) -> list[EventType]:
        return [
            e.event_type for e in run_cycle("test-shop", list(obs), store, rules=rules, now=T0).new_events
        ]

    assert cycle(_obs(Availability.OUT_OF_STOCK, "89.95", T0)) == [EventType.NEW_LISTING]
    t1 = T0 + timedelta(minutes=2)
    assert cycle(_obs(Availability.OUT_OF_STOCK, "89.95", t1)) == []
    t2 = t1 + timedelta(minutes=2)
    assert cycle(_obs(Availability.PREORDER, "89.95", t2)) == [EventType.PREORDER_OPEN]
    t3 = t2 + timedelta(minutes=2)
    assert cycle(_obs(Availability.IN_STOCK_ONLINE, "79.95", t3)) == [
        EventType.IN_STOCK,
        EventType.PRICE_CHANGE,
    ]
    t4 = t3 + timedelta(minutes=2)
    assert cycle(_obs(Availability.IN_STOCK_ONLINE, "99.95", t4)) == []  # price rise: silent
    t5 = t4 + timedelta(minutes=2)
    assert cycle(_obs(Availability.IN_STOCK_ONLINE, "59.95", t5, sku="new")) == [EventType.IN_STOCK]


# ------------------------------------------------------------ runner wiring
def _cfg(slug: str, adapter: str, platform: str, config: dict[str, Any] | None = None) -> RetailerConfig:
    return RetailerConfig(
        "id-" + slug,
        slug,
        slug.title(),
        adapter,
        120,
        300,
        platform,
        "https://www.example.com.au",
        config or {},
    )


def test_runner_builds_generic_adapters_from_the_retailer_row() -> None:
    s = adapter_for(_cfg("toysrus", "shopify", "shopify", {"collections": ["pokemon-tcg"]}))
    assert isinstance(s, ShopifyAdapter)
    assert (s.slug, s.base_url, s.collections) == ("toysrus", "https://www.example.com.au", ["pokemon-tcg"])
    w = adapter_for(_cfg("mind-games", "woocommerce", "woocommerce", {"categories": [{"id": 66}]}))
    assert isinstance(w, WooCommerceAdapter) and w.categories == ["66"]
    # platform alone is enough (adapter column left as 'none' by mistake)
    assert isinstance(adapter_for(_cfg("x-shop", "none", "shopify")), ShopifyAdapter)
    # JB Hi-Fi keeps its own Algolia adapter even though it runs on Shopify
    assert isinstance(adapter_for(_cfg("jb-hi-fi", "shopify", "shopify")), JbHiFi)
    assert isinstance(adapter_for(_cfg("jb-hi-fi", "jb_hi_fi", "custom")), JbHiFi)


def test_generic_stores_get_a_slower_polite_client() -> None:
    c = client_for(_cfg("toysrus", "shopify", "shopify"), "TCGTrackerBot/1.0")
    assert c.min_delay >= GENERIC_MIN_DELAY >= 5
    assert client_for(_cfg("jb-hi-fi", "jb_hi_fi", "custom"), "TCGTrackerBot/1.0").min_delay == 2.0


def test_retailer_config_change_restarts_the_worker() -> None:
    a = _cfg("toysrus", "shopify", "shopify", {"collections": ["pokemon-tcg"]})
    b = _cfg("toysrus", "shopify", "shopify", {"collections": ["pokemon-tcg", "one-piece"]})
    assert a != b and a == _cfg("toysrus", "shopify", "shopify", {"collections": ["pokemon-tcg"]})


def test_blocked_reason_after_a_cycle() -> None:
    assert blocked_reason(AdapterBlocked("challenge: Shop served a bot-challenge page")).startswith(
        "challenge"
    )
    assert str(blocked_reason(Disallowed("https://x/y"))).startswith("robots:")
    assert blocked_reason(BackingOff("https://x", 0, 429)) is KEEP
    assert blocked_reason(RuntimeError("parser")) is KEEP
    assert blocked_reason([]) is None


def test_shopify_module_helpers() -> None:
    assert shopify.is_preorder("Pokemon ETB (Pre Order)") and shopify.is_preorder("", "", "preorder")
    assert not shopify.is_preorder("Pokemon ETB", "Sealed", "order now")


# ------------------------------------------------------- shared Shopify budget
def test_shared_gate_spaces_requests_across_stores_and_pauses_all_on_429() -> None:
    from tcgworkers.drops.http import BackingOff, SharedGate

    now = [1000.0]
    slept: list[float] = []

    def sleep(s: float) -> None:
        slept.append(s)
        now[0] += s

    gate = SharedGate("shopify", 4.0, floor=3.0, ceiling=60.0, clock=lambda: now[0], sleep=sleep)
    gate.wait()  # store A
    gate.wait()  # store B, straight after: must wait the shared interval
    assert slept == [4.0]
    gate.back_off(now[0] + 600, "https://a.example")  # one store got a 429
    assert gate.min_interval == 6.0  # every store slows down a little...
    gate.wait()  # ...but the others carry on: that was one shop's own limit
    gate.back_off(now[0] + 600, "https://b.example")  # a second shop refuses too
    with pytest.raises(BackingOff):
        gate.wait()  # the platform's limit: every store pauses
    now[0] += 601
    gate.wait()
    for _ in range(200):
        gate.succeeded()
    assert gate.min_interval == 3.0  # speeds back up, never below the floor


def test_shopify_stores_share_one_gate_and_woocommerce_does_not() -> None:
    from tcgworkers.drops.runner import SHOPIFY_GATE, client_for

    shop_a = client_for(_cfg("a", "shopify", "shopify", {"collections": ["x"]}), "ua")
    shop_b = client_for(_cfg("b", "shopify", "shopify", {"collections": ["y"]}), "ua")
    woo = client_for(_cfg("c", "woocommerce", "woocommerce", {"categories": ["z"]}), "ua")
    assert shop_a.gate is SHOPIFY_GATE and shop_b.gate is SHOPIFY_GATE
    assert woo.gate is None
    # Different shops may be 1-2 s apart; each shop itself stays 5+ s apart.
    assert SHOPIFY_GATE.floor == 1.0 and SHOPIFY_GATE.min_interval <= 2.0
    assert shop_a.min_delay >= 5.0


# ------------------------------------------------------------ one-tap checkout
def test_shopify_cart_links_only_when_it_is_clear_which_item_they_add() -> None:
    base = "https://shop.example"
    one = [{"id": 111, "available": True}]
    assert shopify.cart_url(base, one) == "https://shop.example/cart/111:1"
    # One variant, sold out now: kept (shown only once it is buyable again).
    assert shopify.cart_url(base, [{"id": 111, "available": False}]) == "https://shop.example/cart/111:1"
    # Pack or box: the only buyable one is the link.
    assert (
        shopify.cart_url(base, [{"id": 1, "available": False}, {"id": 2, "available": True}])
        == "https://shop.example/cart/2:1"
    )
    # Two buyable choices, or every choice sold out: no guessing.
    assert shopify.cart_url(base, [{"id": 1, "available": True}, {"id": 2, "available": True}]) is None
    assert shopify.cart_url(base, [{"id": 1, "available": False}, {"id": 2, "available": False}]) is None
    assert shopify.cart_url(base, []) is None
    assert shopify.cart_url("http://shop.example", one) is None
    assert shopify.cart_url(base, [{"id": "12a", "available": True}]) is None
