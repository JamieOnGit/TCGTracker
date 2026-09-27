from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal as D

import httpx
import pytest

from tcgworkers.config import Rules
from tcgworkers.drops import rrp
from tcgworkers.drops.adapters.jb_hi_fi import availability_of, parse_hits
from tcgworkers.drops.engine import InMemoryStore, alertable, run_cycle
from tcgworkers.drops.filters import classify
from tcgworkers.drops.http import BackingOff, Disallowed, PoliteClient
from tcgworkers.drops.models import Availability, EventType, Observation, ProductState, RrpTag
from tcgworkers.drops.state import diff

T0 = datetime(2026, 9, 27, 9, 0, tzinfo=UTC)


def obs(
    avail=Availability.OUT_OF_STOCK, price="199", at=T0, queue=False, title=None, seller=False, sku="OP09"
):
    return Observation(
        "jb-hi-fi",
        sku,
        "https://example.test/p",
        title or "One Piece Card Game OP-09 Booster Box",
        avail,
        D(price) if price else None,
        at,
        queue,
        seller,
    )


def state(avail, price="199", at=T0, queue=False):
    return ProductState(avail, D(price) if price else None, queue, at)


# ------------------------------------------------------------ transitions
def test_first_sighting_emits_new_listing():
    assert [e.event_type for e in diff(None, obs())] == [EventType.NEW_LISTING]


def test_first_sighting_in_stock_emits_new_listing_and_in_stock():
    types = [e.event_type for e in diff(None, obs(Availability.IN_STOCK_ONLINE))]
    assert types == [EventType.NEW_LISTING, EventType.IN_STOCK]


def test_preorder_opens():
    ev = diff(state(Availability.OUT_OF_STOCK), obs(Availability.PREORDER))
    assert [e.event_type for e in ev] == [EventType.PREORDER_OPEN]


def test_restock_emits_in_stock_once():
    prev = state(Availability.OUT_OF_STOCK)
    assert [e.event_type for e in diff(prev, obs(Availability.IN_STOCK_CNC))] == [EventType.IN_STOCK]
    still = state(Availability.IN_STOCK_CNC)
    assert diff(still, obs(Availability.IN_STOCK_BOTH)) == []  # already in stock: no new alert


def test_going_out_of_stock_is_silent():
    assert diff(state(Availability.IN_STOCK_ONLINE), obs(Availability.OUT_OF_STOCK)) == []


def test_price_change_and_queue_live():
    ev = diff(state(Availability.PREORDER, "199"), obs(Availability.PREORDER, "179", queue=True))
    assert [e.event_type for e in ev] == [EventType.PRICE_CHANGE, EventType.QUEUE_LIVE]
    assert ev[0].previous_price_aud == D("199")


def test_dedupe_keys_differ_per_transition_and_repeat_for_the_same_one():
    prev = state(Availability.OUT_OF_STOCK, at=T0)
    a = diff(prev, obs(Availability.IN_STOCK_ONLINE, at=T0 + timedelta(minutes=2)))[0]
    b = diff(prev, obs(Availability.IN_STOCK_ONLINE, at=T0 + timedelta(minutes=3)))[0]
    assert a.dedupe_key == b.dedupe_key  # same transition processed twice -> one event
    later = state(Availability.OUT_OF_STOCK, at=T0 + timedelta(days=1))
    c = diff(later, obs(Availability.IN_STOCK_ONLINE))[0]
    assert c.dedupe_key != a.dedupe_key  # a later restock is a new event


# --------------------------------------------------------------------- RRP
ENTRIES = [
    rrp.RrpEntry("one-piece", "booster-box", D("199")),
    rrp.RrpEntry("one-piece", "booster-box", D("219"), set_code="OP09"),
    rrp.RrpEntry("pokemon", "elite-trainer-box", D("89.95")),
]


def test_rrp_lookup_prefers_the_most_specific_entry():
    assert rrp.lookup_rrp(ENTRIES, game="one-piece", product_type="booster-box", set_code="OP09") == D("219")
    assert rrp.lookup_rrp(ENTRIES, game="one-piece", product_type="booster-box", set_code="OP10") == D("199")
    assert rrp.lookup_rrp(ENTRIES, game="pokemon", product_type="booster-box", set_code=None) is None


@pytest.mark.parametrize(
    ("price", "expected", "label"),
    [
        ("199", RrpTag.AT_RRP, "AT RRP"),
        ("202", RrpTag.AT_RRP, "AT RRP"),  # within 2% tolerance
        ("179", RrpTag.BELOW_RRP, "BELOW RRP"),
        ("259", RrpTag.ABOVE_RRP, "ABOVE RRP (+30.2%)"),
        (None, RrpTag.UNKNOWN, "RRP UNKNOWN"),
    ],
)
def test_rrp_tagging(price, expected, label):
    tag, delta = rrp.tag(D(price) if price else None, D("199"), tolerance_pct=D("2"))
    assert tag is expected
    assert rrp.label(tag, delta) == label


def test_marketplace_sellers_well_above_rrp_are_suppressed():
    assert rrp.should_suppress(is_marketplace_seller=True, delta_pct=D("60"), suppress_above_pct=D("50"))
    assert (
        rrp.should_suppress(is_marketplace_seller=False, delta_pct=D("60"), suppress_above_pct=D("50"))
        is None
    )
    assert (
        rrp.should_suppress(is_marketplace_seller=True, delta_pct=D("10"), suppress_above_pct=D("50")) is None
    )


# ------------------------------------------------------------------ filter
@pytest.mark.parametrize(
    ("title", "is_tcg", "game", "ptype", "set_code"),
    [
        ("Pokemon TCG - Mega Evolutions 4: Chaos Rising Display Box", True, "pokemon", "booster-box", None),
        ("Pokémon TCG: Scarlet & Violet 151 Elite Trainer Box", True, "pokemon", "elite-trainer-box", None),
        (
            "Bandai One Piece Card Game OP-16 The Time Of Battle Booster Box",
            True,
            "one-piece",
            "booster-box",
            "OP16",
        ),
        ("ONE PIECE CARD GAME PREMIUM BOOSTER PRB-02", True, "one-piece", None, "PRB02"),
        ("Pokemon Pikachu 30cm Plush", False, None, None, None),
        ("Pokemon Legends Z-A (Nintendo Switch 2)", False, None, None, None),
        ("One Piece Luffy Gear 5 Figure", False, None, None, None),
        ("Ultra Pro Pokemon TCG Card Sleeves", False, None, None, None),
    ],
)
def test_tcg_filter(title, is_tcg, game, ptype, set_code):
    c = classify(title)
    assert (c.is_tcg, c.game, c.product_type, c.set_code) == (is_tcg, game, ptype, set_code), c.reason


# ------------------------------------------------------------------ engine
def test_cycle_is_transition_only_and_tags_rrp():
    store = InMemoryStore()
    rules = Rules()
    first = run_cycle(
        "jb-hi-fi", [obs(Availability.OUT_OF_STOCK, "219")], store, rules=rules, rrp_entries=ENTRIES, now=T0
    )
    assert [e.event_type for e in first.new_events] == [EventType.NEW_LISTING]
    same = run_cycle(
        "jb-hi-fi",
        [obs(Availability.OUT_OF_STOCK, "219", at=T0 + timedelta(minutes=2))],
        store,
        rules=rules,
        rrp_entries=ENTRIES,
        now=T0,
    )
    assert same.new_events == []  # nothing changed: no alert
    restock = run_cycle(
        "jb-hi-fi",
        [obs(Availability.IN_STOCK_ONLINE, "219", at=T0 + timedelta(minutes=4))],
        store,
        rules=rules,
        rrp_entries=ENTRIES,
        now=T0,
    )
    [e] = restock.new_events
    assert e.event_type is EventType.IN_STOCK and e.rrp_tag is RrpTag.AT_RRP and e.rrp_aud == D("219")


def test_cycle_ignores_non_tcg_and_suppresses_scalpers():
    store = InMemoryStore()
    res = run_cycle(
        "jb-hi-fi",
        [
            obs(title="Pokemon Pikachu Plush", sku="P1"),
            obs(Availability.IN_STOCK_ONLINE, "399", seller=True, sku="MKT1"),
        ],
        store,
        rules=Rules(),
        rrp_entries=ENTRIES,
        now=T0,
    )
    assert res.seen == 2 and res.tcg == 1
    assert all(e.suppressed for e in res.new_events) and alertable(res.new_events) == []


def test_adapter_health_alerts_after_repeated_empty_or_failed_cycles():
    store = InMemoryStore()
    rules = Rules(drops_zero_product_alert_cycles=3)
    results = [run_cycle("kmart", [], store, rules=rules, now=T0) for _ in range(3)]
    assert [r.alert_admin for r in results] == [False, False, True]
    store2 = InMemoryStore()
    errs = [run_cycle("kmart", RuntimeError("403"), store2, rules=rules, now=T0) for _ in range(3)]
    assert errs[-1].alert_admin and errs[-1].error == "403"


# ------------------------------------------------------- JB Hi-Fi fixtures
def test_jb_hi_fi_fixture_parses(fixtures):
    payload = json.loads((fixtures / "retailers/jb-hi-fi/algolia-query-pokemon-tcg.json").read_text())
    items = parse_hits(payload, observed_at=T0)
    by_sku = {o.sku: o for o in items}
    assert by_sku["880545"].availability is Availability.IN_STOCK_ONLINE
    assert by_sku["880545"].price_aud == D("306.00")
    assert by_sku["909462"].availability is Availability.PREORDER
    assert all(o.url.startswith("https://www.jbhifi.com.au/products/") for o in items)


def test_jb_hi_fi_marketplace_items_are_flagged(fixtures):
    payload = json.loads(
        (fixtures / "retailers/jb-hi-fi/algolia-query-one-piece-marketplace.json").read_text()
    )
    items = parse_hits(payload, observed_at=T0)
    assert items and all(o.is_marketplace_seller for o in items)


def test_jb_availability_mapping_click_and_collect():
    hit = {
        "availability": {
            "canBuyOnline": False,
            "deliveryStatus": "NotAvailable",
            "clickNCollectStatus": "LimitedStock",
            "overallStatus": "LimitedStock",
        }
    }
    assert availability_of(hit) is Availability.IN_STOCK_CNC


# ------------------------------------------------------------- polite HTTP
class FakeClock:
    def __init__(self):
        self.t = 1000.0
        self.slept: list[float] = []

    def now(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


def make_client(handler, clock):
    return PoliteClient(
        "TestBot/1.0",
        transport=httpx.MockTransport(handler),
        clock=clock.now,
        sleep=clock.sleep,
        min_delay=2,
        max_delay=2,
        cache_ttl=0,
    )


def test_polite_client_respects_robots():
    clock = FakeClock()

    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /checkout\n")
        return httpx.Response(200, text="ok")

    c = make_client(handler, clock)
    assert c.get("https://shop.test/products/x").text == "ok"
    with pytest.raises(Disallowed):
        c.get("https://shop.test/checkout/1")


def test_polite_client_stays_out_when_robots_is_blocked():
    def handler(req):
        return httpx.Response(403, text="Access Denied")

    with pytest.raises(Disallowed):
        make_client(handler, FakeClock()).get("https://blocked.test/x")


def test_polite_client_jitters_between_requests():
    clock = FakeClock()
    c = make_client(lambda req: httpx.Response(200, text="ok"), clock)
    c.get("https://shop.test/a")
    c.get("https://shop.test/b")
    assert clock.slept == [2]


def test_polite_client_backs_off_on_429_and_honours_retry_after():
    clock = FakeClock()
    calls = {"n": 0}

    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "120"})

    c = make_client(handler, clock)
    with pytest.raises(BackingOff):
        c.get("https://shop.test/a")
    with pytest.raises(BackingOff):
        c.get("https://shop.test/b")  # still cooling down: no request made
    assert calls["n"] == 1
    clock.t += 121
    with pytest.raises(BackingOff):
        c.get("https://shop.test/c")
    assert calls["n"] == 2


def test_polite_client_revalidates_with_etag():
    clock = FakeClock()
    seen_headers = []

    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        seen_headers.append(req.headers.get("If-None-Match"))
        if req.headers.get("If-None-Match") == '"v1"':
            return httpx.Response(304)
        return httpx.Response(200, text="body", headers={"ETag": '"v1"'})

    c = make_client(handler, clock)
    assert c.get("https://shop.test/a").text == "body"
    assert c.get("https://shop.test/a").text == "body"
    assert seen_headers == [None, '"v1"']
