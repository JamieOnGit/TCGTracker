"""eBay deal finder: matching, deal rules, the Browse API client (recorded
fixtures through httpx.MockTransport, no network) and, when
TEST_DATABASE_URL is set, the ebay_deals upsert / gone logic."""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.config import Env
from tcgworkers.jobs import registry
from tcgworkers.sources import ebay_deals as ed
from tcgworkers.sources.ebay_deals import (
    MAX_CARDS_PER_RUN,
    BrowseClient,
    DealFinder,
    DealSettings,
    DealStore,
    Listing,
    RateLimited,
    WatchCard,
    build_query,
    deal_ceiling,
    evaluate,
    match_title,
    settings_from_rows,
)

FIX = Path(__file__).parent / "fixtures" / "ebay"
NOW = datetime(2026, 10, 1, 0, 0, tzinfo=UTC)
CARD = WatchCard(
    "20000000-0000-0000-0000-000000000001",
    "psa-10",
    Decimal("1000.00"),
    "Charizard ex",
    "199/165",
    "151",
    "en",
    "pokemon",
)
JP_CARD = WatchCard(
    "20000000-0000-0000-0000-000000000002",
    "psa-10",
    Decimal("1000.00"),
    "Charizard ex",
    "201/165",
    "Pokémon Card 151",
    "jp",
    "pokemon",
)
OP_CARD = WatchCard(
    "20000000-0000-0000-0000-000000000003",
    "bgs-9.5",
    Decimal("400"),
    "Monkey.D.Luffy",
    "OP05-119",
    "Awakening of the New Era",
    "en",
    "one-piece",
)
SETTINGS = DealSettings(enabled=True)


def _search() -> dict[str, Any]:
    return dict(json.loads((FIX / "search_charizard_psa10.json").read_text()))


def _listings() -> dict[str, Listing]:
    out = {}
    for s in _search()["itemSummaries"]:
        item = Listing.from_summary(s)
        assert item is not None
        out[item.item_id] = item
    return out


def _id(n: int) -> str:
    return f"v1|3360{n:08d}|0"


# ------------------------------------------------------------------ matching
@pytest.mark.parametrize(
    "title",
    [
        "Pokemon Charizard ex 199/165 SIR 151 PSA 10 GEM MINT",
        "PSA 10 Charizard ex #199 151",
        "Charizard ex 199/165 PSA10",
        "CHARIZARD EX 0199 PSA-10 Scarlet Violet 151",
    ],
)
def test_matching_accepts_the_exact_card_and_grade(title: str) -> None:
    assert match_title(title, CARD), title


@pytest.mark.parametrize(
    "title",
    [
        "Charizard ex 199/165 PSA 10 candidate",
        "Charizard ex 199/165 PSA 10 ready pack fresh",
        "Charizard ex 199/165 PSA 9",
        "Charizard ex 199/165 PSA 9 PSA 10 pair",
        "Charizard ex 199/165 BGS 10",
        "Charizard ex 199/165 PSA 10 proxy",
        "Charizard ex 199/165 reprint PSA 10",
        "Charizard ex 199/165 PSA 10 Orica",
        "Charizard ex 199/165 PSA 10 fake",
        "Charizard ex 199/165 PSA 10 replica",
        "Charizard ex 199/165 not PSA 10",
        "Charizard ex 199/165 PSA 10 lot",
        "Charizard ex 199/165 PSA 10 bundle",
        "Charizard ex 199/165 digital PSA 10",
        "Charizard ex 199/165 custom PSA 10 slab",
        "Charizard ex 199/165 Japanese PSA 10",
        "Charizard ex 199/165 JPN PSA 10",
        "Charizard ex 199/165 Korean PSA 10",
        "Charizard ex 1199 PSA 10",
        "Charizard ex 19/165 PSA 10",
        "Pikachu 199/165 PSA 10",
        "Charizard ex 165/199 PSA 10",  # 199 is the set size here
    ],
)
def test_matching_rejects_everything_else(title: str) -> None:
    assert not match_title(title, CARD), title


def test_matching_languages_and_alphanumeric_numbers() -> None:
    assert match_title("Charizard ex 201/165 SAR Pokemon Card 151 Japanese PSA 10", JP_CARD)
    assert match_title("Charizard ex 201/165 SV2a JP PSA 10", JP_CARD)
    assert not match_title("Charizard ex 201/165 SAR PSA 10", JP_CARD)  # no language marker
    assert match_title("One Piece Monkey D Luffy OP05-119 SEC BGS 9.5", OP_CARD)
    assert match_title("Monkey.D.Luffy OP05 119 BGS 9.5 Gem Mint", OP_CARD)
    assert not match_title("Monkey D Luffy OP05-119 BGS 9", OP_CARD)
    assert not match_title("Monkey D Luffy OP05-118 BGS 9.5", OP_CARD)
    # A PSA grade's digits never count as the card number.
    ten = WatchCard("x", "psa-10", Decimal("100"), "Pikachu", "10/102", "Base", "en", "pokemon")
    assert not match_title("Pikachu 58/102 PSA 10", ten)
    assert match_title("Pikachu 10/102 PSA 10", ten)


def test_queries() -> None:
    assert build_query(CARD) == "Charizard ex 199 PSA 10"
    assert build_query(JP_CARD) == "Charizard ex 201 Japanese PSA 10"
    assert build_query(OP_CARD) == "Monkey.D.Luffy OP05-119 BGS 9.5"
    assert build_query(WatchCard("x", "raw", Decimal(1), "Mew", "025", "s", "en", "pokemon")) is None
    zero = WatchCard("x", "psa-9", Decimal(1), "Mew", "025/100", "s", "en", "pokemon")
    assert build_query(zero) == "Mew 25 PSA 9"


# --------------------------------------------------------------- deal rules
def test_deal_decisions_on_recorded_results() -> None:
    items = _listings()
    deals = {i: evaluate(CARD, item, SETTINGS, NOW) for i, item in items.items()}
    found = {i for i, d in deals.items() if d}
    assert found == {_id(1), _id(6), _id(11)}

    bin_deal = deals[_id(1)]
    assert bin_deal and bin_deal.buying_option == "FIXED_PRICE"
    assert bin_deal.price_aud == Decimal("700.00") and bin_deal.shipping_aud == Decimal("10.00")
    assert bin_deal.discount_pct == Decimal("29.0")
    assert "campid=5338000000" in bin_deal.url  # affiliate URL preferred when present

    auction = deals[_id(6)]
    assert auction and auction.buying_option == "AUCTION" and auction.price_aud == Decimal("500.00")
    assert auction.bid_count == 14 and auction.discount_pct == Decimal("48.8")

    plain = deals[_id(11)]
    assert plain and plain.url == "https://www.ebay.com.au/itm/336000000011"
    assert plain.shipping_aud == Decimal("0.00") and plain.discount_pct == Decimal("25.0")


def test_bin_ceiling_includes_postage_and_auction_window() -> None:
    assert deal_ceiling(Decimal("1000"), Decimal("20")) == Decimal("800.00")
    items = _listings()
    # 795 + 10 postage is over the 800 ceiling.
    assert evaluate(CARD, items[_id(2)], SETTINGS, NOW) is None
    # The 5-hour auction qualifies once the window is wide enough.
    wide = DealSettings(enabled=True, auction_ending_minutes=360)
    late = evaluate(CARD, items[_id(7)], wide, NOW)
    assert late and late.buying_option == "AUCTION"
    # An auction that already ended is never a deal.
    assert evaluate(CARD, items[_id(6)], SETTINGS, datetime(2026, 10, 1, 2, tzinfo=UTC)) is None


def test_non_aud_and_insecure_listings_are_ignored() -> None:
    s = _search()["itemSummaries"][0]
    assert Listing.from_summary({**s, "price": {"value": "10", "currency": "USD"}}) is None
    no_links = {k: v for k, v in s.items() if k not in ("itemWebUrl", "itemAffiliateWebUrl")}
    assert Listing.from_summary(no_links) is None


def test_settings_and_budget() -> None:
    assert MAX_CARDS_PER_RUN == 83 and MAX_CARDS_PER_RUN * 48 < 5000
    s = settings_from_rows(
        {
            "deals.enabled": True,
            "deals.min_discount_pct": 25,
            "deals.auction_ending_minutes": 90,
            "deals.max_cards_per_run": 150,
            "ebay.affiliate_enabled": True,
            "ebay.campaign_id": "5338000000",
        }
    )
    assert s.enabled and s.min_discount_pct == Decimal("25") and s.auction_ending_minutes == 90
    assert s.cards_per_run == MAX_CARDS_PER_RUN and s.campaign_id == "5338000000"
    assert settings_from_rows({"ebay.affiliate_enabled": True, "ebay.campaign_id": "123"}).campaign_id is None
    assert (
        settings_from_rows({"ebay.affiliate_enabled": False, "ebay.campaign_id": "5338000000"}).campaign_id
        is None
    )
    assert not settings_from_rows({}).enabled
    assert settings_from_rows({"deals.max_cards_per_run": 10}).cards_per_run == 10


# -------------------------------------------------------------------- client
class FakeEbay:
    def __init__(self, statuses: list[int] | None = None) -> None:
        self.statuses = list(statuses or [])
        self.token_calls = 0
        self.searches: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/identity/v1/oauth2/token":
            self.token_calls += 1
            assert request.headers["Authorization"].startswith("Basic ")
            assert b"grant_type=client_credentials" in request.content
            assert b"scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope" in request.content
            return httpx.Response(200, json=json.loads((FIX / "token.json").read_text()))
        self.searches.append(request)
        status = self.statuses.pop(0) if self.statuses else 200
        if status != 200:
            return httpx.Response(status, headers={"Retry-After": "2"}, json={"errors": []})
        return httpx.Response(200, json=_search())


def _client(fake: FakeEbay, sleeps: list[float], clock: list[float]) -> BrowseClient:
    return BrowseClient(
        "id",
        "secret",
        http=httpx.Client(transport=httpx.MockTransport(fake)),
        sleep=sleeps.append,
        clock=lambda: clock[0],
    )


def test_search_request_and_token_caching() -> None:
    fake, clock = FakeEbay(), [0.0]
    sleeps: list[float] = []
    client = _client(fake, sleeps, clock)
    results = client.search(
        "Charizard ex 199 PSA 10",
        max_price=Decimal("800.00"),
        campaign_id="5338000000",
        reference="tcgtracker-abc",
    )
    assert len(results) == 11
    req = fake.searches[0]
    assert req.url.host == "api.ebay.com" and req.url.path == "/buy/browse/v1/item_summary/search"
    assert req.url.params["q"] == "Charizard ex 199 PSA 10"
    assert req.url.params["category_ids"] == "183454"
    assert req.url.params["filter"] == (
        "buyingOptions:{FIXED_PRICE|AUCTION},itemLocationCountry:AU,priceCurrency:AUD,price:[..800.00]"
    )
    assert req.headers["X-EBAY-C-MARKETPLACE-ID"] == "EBAY_AU"
    assert (
        req.headers["X-EBAY-C-ENDUSERCTX"]
        == "affiliateCampaignId=5338000000,affiliateReferenceId=tcgtracker-abc"
    )
    assert req.headers["Authorization"] == "Bearer v^1.1#i^1#test-token"

    client.search("q", max_price=Decimal(1), campaign_id=None, reference="r")
    assert fake.token_calls == 1  # cached
    assert "X-EBAY-C-ENDUSERCTX" not in fake.searches[1].headers
    clock[0] = 7200.0  # past expiry (minus the safety margin)
    client.search("q", max_price=Decimal(1), campaign_id=None, reference="r")
    assert fake.token_calls == 2


def test_401_refreshes_the_token_once() -> None:
    fake = FakeEbay([401, 200])
    client = _client(fake, [], [0.0])
    assert client.search("q", max_price=Decimal(1), campaign_id=None, reference="r")
    assert fake.token_calls == 2


def test_429_backs_off_then_gives_up() -> None:
    fake = FakeEbay([429, 200])
    sleeps: list[float] = []
    client = _client(fake, sleeps, [0.0])
    assert client.search("q", max_price=Decimal(1), campaign_id=None, reference="r")
    assert sleeps == [2.0]
    fake.statuses = [429, 429, 429]
    with pytest.raises(RateLimited):
        client.search("q", max_price=Decimal(1), campaign_id=None, reference="r")


class MemoryStore(DealStore):
    """DealStore with no database."""

    def __init__(self, cards: list[WatchCard]) -> None:
        self.cards = cards
        self.rows: dict[str, dict[str, Any]] = {}
        self.commits = 0

    def watch_cards(self, limit: int) -> list[WatchCard]:
        return self.cards[:limit]

    def known_items(self, item_ids: Any) -> set[str]:
        return {i for i in item_ids if i in self.rows}

    def active_items(self, card_id: str, grade_key: str) -> set[str]:
        return {i for i, r in self.rows.items() if r["card_id"] == card_id and not r["gone"]}

    def insert(self, deals: list[Any]) -> int:
        for d in deals:
            self.rows[d.item_id] = {"card_id": d.card_id, "gone": False}
        return len(deals)

    def mark_gone(self, item_ids: Any) -> int:
        ids = list(item_ids)
        for i in ids:
            self.rows[i]["gone"] = True
        return len(ids)

    def mark_ended(self) -> int:
        return 0

    def commit(self) -> None:
        self.commits += 1


def test_finder_run_with_rate_limit_stops_early_without_raising() -> None:
    fake = FakeEbay([429, 429, 429])
    finder = DealFinder(_client(fake, [], [0.0]))
    stats = finder.run(MemoryStore([CARD, JP_CARD]), SETTINGS, now=NOW)
    assert stats["rate_limited"] is True and stats["new"] == 0 and stats["searches"] == 3


def test_finder_errors_skip_the_card() -> None:
    fake = FakeEbay([500])
    finder = DealFinder(_client(fake, [], [0.0]))
    stats = finder.run(MemoryStore([CARD, CARD]), SETTINGS, now=NOW)
    assert stats["errors"] == 1 and stats["new"] == 3


def test_job_is_registered_and_off_without_keys(caplog: pytest.LogCaptureFixture) -> None:
    jobs = {j.name: j for j in registry.JOBS}
    assert jobs["deals"].every_hours_default == 0.5 and jobs["deals"].run is registry.find_ebay_deals
    assert registry.deal_finder(Env.from_environ({})) is None
    env = Env.from_environ({"EBAY_CLIENT_ID": "i", "EBAY_CLIENT_SECRET": "s"})
    assert env.ebay_client_id == "i" and env.ebay_client_secret == "s"
    assert registry.deal_finder(env) is not None


# --------------------------------------------------------------- database
URL = os.environ.get("TEST_DATABASE_URL")
Conn = psycopg.Connection[dict[str, Any]]


@pytest.fixture
def conn() -> Iterator[Conn]:
    if not URL:
        pytest.skip("TEST_DATABASE_URL not set")
    with psycopg.connect(URL, row_factory=dict_row) as c:
        c.execute("delete from public.ebay_deals where card_id = %s", (CARD.card_id,))
        c.commit()
        yield c
        c.rollback()
        c.execute("delete from public.ebay_deals where card_id = %s", (CARD.card_id,))
        c.commit()


def test_deals_are_inserted_once_notified_and_marked_gone(conn: Conn) -> None:
    ed._warned.clear()
    assert ed.ready_settings(conn, None) is None  # deals.enabled defaults to false

    # A wishlist watcher of the card is told about each new deal.
    uid = str(uuid.uuid4())
    conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, f"{uid[:8]}@example.test"))
    conn.execute(
        "insert into public.wishlist_items (user_id, card_id, grade_key) values (%s, %s, 'psa-10')",
        (uid, CARD.card_id),
    )
    conn.commit()
    try:
        fake = FakeEbay()
        finder = DealFinder(_client(fake, [], [0.0]))
        store = DealStore(conn)
        store.watch_cards = lambda limit: [CARD]  # type: ignore[method-assign]
        stats = finder.run(store, SETTINGS, now=NOW)
        assert stats["new"] == 3 and stats["found"] == 3
        rows = {
            r["item_id"]: r
            for r in conn.execute(
                "select item_id, buying_option, price_aud, url, gone_at, public_at > found_at as delayed "
                "from public.ebay_deals where card_id = %s",
                (CARD.card_id,),
            )
        }
        assert set(rows) == {_id(1), _id(6), _id(11)}
        assert rows[_id(6)]["buying_option"] == "AUCTION" and rows[_id(1)]["delayed"]
        emails = conn.execute(
            "select data from public.email_outbox where user_id = %s and template = 'deal'", (uid,)
        ).fetchall()
        assert len(emails) == 3 and all(e["data"]["url"] == "/deals/" for e in emails)

        # Seen again: nothing re-inserted.
        assert finder.run(store, SETTINGS, now=NOW)["new"] == 0

        # Item 11 disappears from the results: gone after two runs without it.
        search = _search()
        search["itemSummaries"] = [s for s in search["itemSummaries"] if s["itemId"] != _id(11)]
        fake_json = json.dumps(search)

        def without_11(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/token"):
                return httpx.Response(200, json={"access_token": "t", "expires_in": 7200})
            return httpx.Response(200, content=fake_json, headers={"content-type": "application/json"})

        finder.client.http = httpx.Client(transport=httpx.MockTransport(without_11))
        assert finder.run(store, SETTINGS, now=NOW)["gone"] == 0
        assert finder.run(store, SETTINGS, now=NOW)["gone"] == 1
        gone = conn.execute("select gone_at from public.ebay_deals where item_id = %s", (_id(11),)).fetchone()
        assert gone and gone["gone_at"] is not None

        # Ended auctions are closed on every run (item 6 ended at 01:00 UTC, in the past).
        conn.execute(
            "update public.ebay_deals set end_time = now() - interval '1 minute' where item_id = %s",
            (_id(6),),
        )
        conn.commit()
        finder.run(store, SETTINGS, now=NOW)
        ended = conn.execute("select gone_at from public.ebay_deals where item_id = %s", (_id(6),)).fetchone()
        assert ended and ended["gone_at"] is not None
    finally:
        conn.rollback()
        conn.execute("delete from auth.users where id = %s", (uid,))
        conn.commit()
