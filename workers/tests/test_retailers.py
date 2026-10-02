"""JB Hi-Fi runtime discovery, Target AU, Kmart, the BIG W skeleton and the
robots matcher (docs/research/07-retailers-pricing-ebay.md). Fixtures only."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from tcgworkers.drops.adapters.big_w import BigW
from tcgworkers.drops.adapters.jb_hi_fi import (
    COLLECTION_URL,
    JbHiFi,
    SearchProviderChanged,
    parse_bundle,
    parse_storefront,
    sku_filter,
)
from tcgworkers.drops.adapters.target_au import ONE_PIECE_URL, POKEMON_URL, TargetAu
from tcgworkers.drops.base import REGISTRY, AdapterBlocked
from tcgworkers.drops.http import Disallowed, PoliteClient
from tcgworkers.drops.models import Availability
from tcgworkers.drops.robots import Robots
from tcgworkers.drops.runner import fetch, load_adapters

UA = "TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/)"
REAL_APP = "VTVKM5URPX"
REAL_KEY = "a0c0108d737ad5ab54a0e2da900bf040"


def _snippet(fixtures: Path) -> tuple[str, str]:
    """(collection page HTML parts, config bundle JS) from the saved snippet."""
    text = (fixtures / "retailers/jb-hi-fi/storefront-config-snippet.txt").read_text()
    lines = [ln for ln in text.splitlines() if not ln.startswith("#")]
    html = "\n".join(ln for ln in lines if "<script" in ln or "window." in ln or ln.startswith("var "))
    js = "\n".join(ln for ln in lines if "app_id" in ln or ln.startswith(",sort_orders"))
    return f"<html><body>{html}</body></html>", js


def _polite(handler) -> PoliteClient:
    return PoliteClient(
        UA, min_delay=0, max_delay=0, transport=httpx.MockTransport(handler), sleep=lambda s: None
    )


class FakeJb:
    """Storefront + theme bundles + Algolia, served from fixtures."""

    def __init__(self, fixtures: Path, *, provider: str = "algolia") -> None:
        self.html, self.config_js = _snippet(fixtures)
        self.html = self.html.replace('searchProvider = "algolia"', f'searchProvider = "{provider}"')
        self.pokemon = json.loads(
            (fixtures / "retailers/jb-hi-fi/algolia-query-pokemon-tcg.json").read_text()
        )
        self.one_piece = json.loads(
            (fixtures / "retailers/jb-hi-fi/algolia-query-one-piece-marketplace.json").read_text()
        )
        self.valid_keys = {REAL_KEY}
        self.bundle_requests: list[str] = []
        self.algolia: list[dict[str, list[str]]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        if url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /cdn/wpm/*.js\n")
        if url.host == "www.jbhifi.com.au" and url.path.startswith("/collections/"):
            return httpx.Response(200, text=self.html)
        if "/assets/bundle." in url.path:
            self.bundle_requests.append(url.path.rsplit("/", 1)[-1])
            return httpx.Response(200, text=self.config_js if "86cb2b098f20e475" in url.path else "var x=1;")
        if url.host.endswith("-dsn.algolia.net"):
            if request.headers.get("X-Algolia-API-Key") not in self.valid_keys:
                return httpx.Response(
                    403, json={"message": "Invalid Application-ID or API key", "status": 403}
                )
            q = parse_qs(urlsplit(str(url)).query)
            self.algolia.append(q)
            filters = q.get("filters", [""])[0]
            if "sku:" in filters:
                wanted = {part.split(":", 1)[1] for part in filters.split(" OR ")}
                hits = [h for h in self.pokemon["hits"] + self.one_piece["hits"] if h["sku"] in wanted]
                return httpx.Response(200, json={"hits": hits})
            return httpx.Response(
                200, json=self.one_piece if q.get("query") == ["one piece card game"] else self.pokemon
            )
        return httpx.Response(404)


# ---------------------------------------------------------------- JB Hi-Fi
def test_storefront_snippet_parses(fixtures):
    html, js = _snippet(fixtures)
    provider, filters, bundles = parse_storefront(html)
    assert provider == "algolia"
    assert filters and '"facets.Brands": "Pokemon TCG"' in filters
    assert ("535", "bundle.86cb2b098f20e475.js") in bundles
    assert all(
        b.startswith("bundle.") and len(b) == len("bundle.") + 16 + 3 for _, b in bundles
    )  # not runtime.js
    assert parse_bundle(js) == (REAL_APP, REAL_KEY, "shopify_products_families")


def test_bundle_parser_survives_reordered_keys():
    js = (
        'x={index_products:"shopify_products_v2",search_api_key:"' + "b" * 32 + '",foo:1,app_id:"ABCDEF1234"}'
    )
    assert parse_bundle(js) == ("ABCDEF1234", "b" * 32, "shopify_products_v2")
    assert parse_bundle("nothing here") is None


def test_discovery_finds_credentials_and_uses_the_collection_filter(fixtures):
    fake = FakeJb(fixtures)
    jb = JbHiFi()
    jb.config = None
    items = list(jb.discover(_polite(fake)))
    assert jb.config and (jb.config.app_id, jb.config.api_key) == (REAL_APP, REAL_KEY)
    assert fake.bundle_requests[-1] == "bundle.86cb2b098f20e475.js"
    assert {i.sku for i in items} == {"880545", "909462", "880062", "10080726", "10080087"}
    pokemon_query = fake.algolia[0]
    assert '"facets.Brands": "Pokemon TCG"' in pokemon_query["filters"][0]  # JB's own filter from the page
    assert "product_published = 1" in pokemon_query["filters"][0]
    assert set(jb.first_party) == {"880545", "909462", "880062"}  # marketplace sellers excluded


def test_rejected_key_triggers_rediscovery_trying_the_last_good_bundle_first(fixtures):
    fake = FakeJb(fixtures)
    jb = JbHiFi(app_id="OLDAPP1234", search_key="0" * 32)  # stale seeded credentials
    client = _polite(fake)
    list(jb.discover(client))
    assert jb.config and jb.config.api_key == REAL_KEY
    first_pass = len(fake.bundle_requests)

    # JB rotates the key: next query 403s -> one collection page + ONE bundle (cached filename).
    fake.valid_keys = {"c" * 32}
    fake.config_js = fake.config_js.replace(REAL_KEY, "c" * 32)
    list(jb.discover(client))
    assert jb.config.api_key == "c" * 32
    assert fake.bundle_requests[first_pass:] == ["bundle.86cb2b098f20e475.js"]


def test_credentials_are_rediscovered_after_24_hours(fixtures):
    fake = FakeJb(fixtures)
    now = [1000.0]
    jb = JbHiFi(clock=lambda: now[0])
    jb.config = None
    client = _polite(fake)
    list(jb.discover(client))
    n = len(fake.bundle_requests)
    now[0] += 3600
    list(jb.discover(client))
    assert len(fake.bundle_requests) == n  # cached
    now[0] += 24 * 3600
    list(jb.discover(client))
    assert len(fake.bundle_requests) == n + 1


def test_provider_switch_is_reported(fixtures):
    jb = JbHiFi()
    jb.config = None
    with pytest.raises(SearchProviderChanged):
        list(jb.discover(_polite(FakeJb(fixtures, provider="google"))))


def test_watch_is_one_sku_filtered_query(fixtures):
    fake = FakeJb(fixtures)
    jb = JbHiFi()
    jb.config = None
    client = _polite(fake)
    list(jb.discover(client))
    before = len(fake.algolia)
    handle = fake.one_piece["hits"][0]["handle"]
    items = list(jb.watch(client, ["10080087", f"https://www.jbhifi.com.au/products/{handle}"]))
    assert len(fake.algolia) == before + 1
    filters = fake.algolia[-1]["filters"][0]
    assert filters.startswith("sku:10080087 OR sku:10080726") and "sku:880545" in filters
    assert {i.sku for i in items} == {"10080087", "10080726", "880545", "909462", "880062"}
    assert all(i.is_marketplace_seller for i in items if i.sku.startswith("1008"))


def test_watch_before_any_discovery_discovers(fixtures):
    fake = FakeJb(fixtures)
    jb = JbHiFi()
    jb.config = None
    assert len(list(jb.watch(_polite(fake), []))) == 5


def test_combine_filters_never_parenthesises_an_and():
    from tcgworkers.drops.adapters.jb_hi_fi import QUERIES, combine_filters

    page = '("facets.Game type": "Trading card games" OR "x":"y") AND ("facets.Brands": "Pokemon TCG" OR "z":"w")'
    combined = combine_filters(page, QUERIES["pokemon"])
    assert combined.startswith(page + " AND (price > 0")  # Algolia rejects "((A OR B) AND C) AND D"
    assert combine_filters('"a":"b" OR "c":"d"', "F").startswith('("a":"b" OR "c":"d") AND ')
    assert combine_filters('"a":"b" OR "c":"d" AND "e":"f"', "F") == "F"
    assert combine_filters(None, "F") == "F"
    assert combine_filters('"quoted OR text":"v"', "F").startswith('"quoted OR text":"v" AND ')


def test_sku_filter_format():
    assert sku_filter(["1", "2"]) == "sku:1 OR sku:2"


def test_collection_url_is_robots_allowed():
    robots = Robots.parse("User-agent: *\nDisallow: /cdn/wpm/*.js\n")
    assert robots.can_fetch(UA, COLLECTION_URL)
    assert robots.can_fetch(UA, "https://www.jbhifi.com.au/cdn/shop/t/535/assets/bundle.86cb2b098f20e475.js")
    assert not robots.can_fetch(UA, "https://www.jbhifi.com.au/cdn/wpm/abc.js")


# ------------------------------------------------------------------ Target
def _target_html(fixtures: Path) -> str:
    plist = json.loads((fixtures / "retailers/target-au/plp-pokemon-cards-nextdata.json").read_text())[
        "productList"
    ]
    doc = {"props": {"pageProps": {"metadata": {"productList": plist}}}, "buildId": "x"}
    return f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(doc)}</script></html>'


def _target_handler(fixtures: Path, *, robots_status: int = 200, page: str | None = None):
    robots = (fixtures / "retailers/target-au/robots-wayback-20260501.txt").read_text()
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(robots_status, text=robots if robots_status == 200 else "Access Denied")
        return httpx.Response(200, text=page if page is not None else _target_html(fixtures))

    return handler, seen


def test_target_category_pages_parse(fixtures):
    handler, seen = _target_handler(fixtures)
    items = list(TargetAu(deep_links=False).discover(_polite(handler)))
    assert [u for u in seen if "/robots.txt" not in u] == [POKEMON_URL, ONE_PIECE_URL]  # no params, no search
    by_sku = {i.sku: i for i in items if i.url == POKEMON_URL}
    assert set(by_sku) == {"P72533239", "P72086551", "P70990096"}
    knock_out = by_sku["P72533239"]
    assert knock_out.title == "Pokemon TCG: Knock Out Collection - Assorted"
    assert str(knock_out.price_aud) == "20.00" and knock_out.availability is Availability.IN_STOCK_ONLINE
    assert by_sku["P70990096"].availability is Availability.OUT_OF_STOCK  # COMING_SOON
    # ToS: no deep links without Target's consent; the product URL is kept for later.
    assert knock_out.raw["product_url"].startswith("https://www.target.com.au/p/")


def test_target_deep_links_only_when_consented(fixtures):
    handler, _ = _target_handler(fixtures)
    items = list(TargetAu(deep_links=True).discover(_polite(handler)))
    assert all(i.url.startswith("https://www.target.com.au/p/") for i in items)


def test_target_blocked_edge_is_disallowed_not_bypassed(fixtures):
    handler, seen = _target_handler(fixtures, robots_status=403)
    with pytest.raises(Disallowed):
        list(TargetAu().discover(_polite(handler)))
    assert all("/robots.txt" in u for u in seen)  # never touched a page


def test_target_challenge_page_is_adapter_blocked(fixtures):
    handler, _ = _target_handler(fixtures, page="<html>Access Denied</html>")
    with pytest.raises(AdapterBlocked):
        list(TargetAu().discover(_polite(handler)))


def test_target_robots_wildcards_are_respected(fixtures):
    robots = Robots.parse((fixtures / "retailers/target-au/robots-wayback-20260501.txt").read_text())
    assert robots.can_fetch(UA, POKEMON_URL)
    assert not robots.can_fetch(UA, "https://www.target.com.au/search/?text=pokemon")
    assert not robots.can_fetch(UA, POKEMON_URL + "?sortBy=price")
    assert not robots.can_fetch(UA, POKEMON_URL + "?viewAs=grid")
    assert not robots.can_fetch(UA, "https://www.target.com.au/checkout/")


# ------------------------------------------------------------------ BIG W
@pytest.mark.parametrize("adapter", [BigW()])
def test_unverified_retailers_raise_without_any_request(adapter):
    calls: list[str] = []
    client = _polite(lambda r: calls.append(str(r.url)) or httpx.Response(200))
    with pytest.raises(AdapterBlocked, match=r"07 §C"):
        list(adapter.discover(client))
    assert calls == []
    # In the runner this is a failed (counted, alerting) cycle, not a crash.
    assert isinstance(fetch(adapter, client, "discovery", []), AdapterBlocked)


def test_all_retailer_adapters_are_registered():
    load_adapters()
    assert {"jb-hi-fi", "target-au", "big-w", "kmart"} <= set(REGISTRY)


# ------------------------------------------------------------------ robots
def test_robots_matcher_rules():
    r = Robots.parse(
        "User-agent: *\nDisallow: /private\nAllow: /private/ok$\nDisallow: /*.json$\n\n"
        "User-agent: TCGTrackerBot\nDisallow: /nobots/\n"
    )
    assert r.can_fetch("OtherBot/1.0", "https://x/public")
    assert not r.can_fetch("OtherBot/1.0", "https://x/private/secret")
    assert r.can_fetch("OtherBot/1.0", "https://x/private/ok")
    assert not r.can_fetch("OtherBot/1.0", "https://x/data.json")
    assert r.can_fetch("OtherBot/1.0", "https://x/data.json?x=1")  # $ anchors the end
    # Our own group replaces the * group.
    assert not r.can_fetch(UA, "https://x/nobots/page")
    assert r.can_fetch(UA, "https://x/private/secret")
    assert r.can_fetch(UA, "https://x/robots.txt")
    assert Robots.parse("User-agent: *\nDisallow:\n").can_fetch(UA, "https://x/anything")
