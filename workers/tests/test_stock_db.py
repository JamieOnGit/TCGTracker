"""A generic Shopify store through the real runner cycle, engine, store,
matcher and triggers, against a migrated database (supabase/tests/run.sh
leaves one behind). Skipped unless TEST_DATABASE_URL is set; CI sets it.

Covers: the silent first-scan baseline, NEW_LISTING / IN_STOCK /
PRICE_CHANGE after it, retail_products.current_* kept by the trigger,
sealed_products found-or-created by the matcher (and re-matched on a title
change), drop_events picking up the sealed product, last_checked_at and
blocked_reason, and --rematch leaving hand-made matches alone."""

from __future__ import annotations

import copy
import json
import os
import uuid
from collections.abc import Iterator
from decimal import Decimal as D
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.drops import kick
from tcgworkers.drops.adapters.shopify import ShopifyAdapter
from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.products import rematch
from tcgworkers.drops.runner import PostgresCycle, adapter_for

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

Conn = psycopg.Connection[dict[str, Any]]
FIXTURE = Path(__file__).parent / "fixtures/retailers/shopify/products-page1.json"


@pytest.fixture
def conn() -> Iterator[Conn]:
    assert URL
    with psycopg.connect(URL, row_factory=dict_row) as c:
        yield c


@pytest.fixture
def shop(conn: Conn) -> Iterator[dict[str, str]]:
    slug = f"test-shopify-{uuid.uuid4().hex[:6]}"
    rid = conn.execute(
        """insert into public.retailers (slug, name, base_url, adapter, platform, config, enabled)
           values (%s, 'Test Shopify Store', 'https://shop.example', 'shopify', 'shopify',
                   '{"collections": ["pokemon"]}'::jsonb, true)
           returning id::text as id""",
        (slug,),
    ).fetchone()
    assert rid
    conn.execute(
        """insert into public.rrp_reference (game, lang, product_type, set_code, rrp_aud)
           values ('pokemon', 'en', 'elite-trainer-box', 'sv8pt5', 99.95) on conflict do nothing"""
    )
    conn.commit()
    yield {"id": rid["id"], "slug": slug}
    conn.rollback()
    sealed = [
        r["sealed_product_id"]
        for r in conn.execute(
            "select distinct sealed_product_id from public.retail_products where retailer_id = %s and sealed_product_id is not null",
            (rid["id"],),
        ).fetchall()
    ]
    conn.execute("delete from public.retailers where id = %s", (rid["id"],))
    conn.execute(
        """delete from public.sealed_products s where s.id = any(%s::uuid[]) and s.auto_created
             and not exists (select 1 from public.retail_products p where p.sealed_product_id = s.id)""",
        (sealed,),
    )
    conn.execute(
        "delete from public.rrp_reference where game = 'pokemon' and set_code = 'sv8pt5' and rrp_aud = 99.95"
    )
    conn.commit()


class Store:
    """The store's products.json, editable between cycles."""

    def __init__(self) -> None:
        self.page: dict[str, Any] = json.loads(FIXTURE.read_text())
        self.status = 200

    def product(self, pid: int) -> dict[str, Any]:
        return next(p for p in self.page["products"] if p["id"] == pid)

    def __call__(self, req: httpx.Request) -> httpx.Response:
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /checkout\n")
        if self.status != 200:
            return httpx.Response(self.status, text="Forbidden")
        if req.url.params.get("page") == "1":
            return httpx.Response(200, json=self.page)
        return httpx.Response(200, json={"products": []})

    def client(self) -> PoliteClient:
        return PoliteClient(
            "TCGTrackerBot/1.0", transport=httpx.MockTransport(self), min_delay=0, max_delay=0, cache_ttl=0
        )


def _products(conn: Conn, rid: str) -> dict[str, dict[str, Any]]:
    rows = conn.execute(
        """select p.sku, p.sealed_product_id::text as sealed, p.lang, p.match_confidence, p.image_url,
                  p.current_availability::text as availability, p.current_price_aud, p.game,
                  s.slug, s.name, s.auto_created, s.rrp_aud, s.set_id::text as set_id, s.type
             from public.retail_products p left join public.sealed_products s on s.id = p.sealed_product_id
            where p.retailer_id = %s""",
        (rid,),
    ).fetchall()
    return {r["sku"]: r for r in rows}


def _events(conn: Conn, rid: str) -> list[dict[str, Any]]:
    return conn.execute(
        """select p.sku, e.event_type::text as type, e.suppressed, e.price_aud, e.previous_price_aud,
                  e.sealed_product_id::text as sealed
             from public.drop_events e join public.retail_products p on p.id = e.retail_product_id
            where p.retailer_id = %s order by e.id""",
        (rid,),
    ).fetchall()


def test_generic_store_cycle_end_to_end(conn: Conn, shop: dict[str, str]) -> None:
    assert URL
    cycle = PostgresCycle(URL)
    [cfg] = [c for c in cycle.load_retailers() if c.slug == shop["slug"]]
    assert (cfg.platform, cfg.base_url, dict(cfg.config)) == (
        "shopify",
        "https://shop.example",
        {"collections": ["pokemon"]},
    )
    adapter = adapter_for(cfg)
    assert isinstance(adapter, ShopifyAdapter)
    store = Store()

    # 1. First scan: a silent baseline (nothing to alert, so the dispatcher isn't woken).
    kick.DISPATCH.clear()
    first = cycle(cfg, "discovery", adapter, store.client())
    assert first.error is None and first.tcg == 7
    assert not kick.DISPATCH.is_set()
    assert all(e["suppressed"] for e in _events(conn, shop["id"]))
    rows = _products(conn, shop["id"])
    etb = rows["8101"]
    assert etb["availability"] == "in_stock_online" and etb["current_price_aud"] == D("89.95")  # trigger
    assert etb["slug"] == "prismatic-evolutions-elite-trainer-box" and etb["auto_created"]
    assert etb["name"] == "Prismatic Evolutions Elite Trainer Box" and etb["type"] == "etb"
    assert etb["rrp_aud"] == D("99.95") and etb["lang"] == "en" and etb["match_confidence"] > D("0.7")
    assert etb["image_url"].startswith("https://cdn.shopify.com/")
    upc = rows["8111"]  # the DB catalogue's 151 set supplies set_id
    assert upc["slug"] == "151-ultra-premium-collection" and upc["set_id"] is not None
    assert rows["8104"]["slug"] == "stellar-crown-mini-tin" and rows["8104"]["game"] == "pokemon"
    op = rows["8109"]
    assert op["lang"] == "jp" and op["availability"] == "unknown"
    assert op["slug"] == "op-09-emperors-in-the-new-world-booster-box"
    assert rows["8102"]["availability"] == "out_of_stock"
    carts = {
        r["sku"]: r["cart_url"]
        for r in conn.execute(
            "select sku, cart_url from public.retail_products where retailer_id = %s", (shop["id"],)
        )
    }
    # One-tap checkout links: only when it is clear which item the link adds.
    assert carts["8101"] == "https://shop.example/cart/81011:1"
    assert carts["8111"] == "https://shop.example/cart/81112:1"  # the only buyable choice
    assert carts["8104"] is None and carts["8102"] is None  # two buyable / all sold out: no guess
    checked = conn.execute(
        "select last_checked_at, blocked_reason from public.retailers where id = %s", (shop["id"],)
    ).fetchone()
    assert checked and checked["last_checked_at"] is not None and checked["blocked_reason"] is None

    # 2. Changes after the baseline alert.
    store.product(8102)["variants"][0]["available"] = True  # restock
    store.product(8101)["variants"][0]["price"] = "79.95"  # -11%
    store.product(8110)["variants"][0]["price"] = "58.95"  # -1.7%: stored, not alerted
    store.product(8103)["title"] = "Pokémon TCG: Phantasmal Flames Elite Trainer Box - PRE-ORDER"
    new = copy.deepcopy(store.product(8101))
    new.update(
        id=8120, handle="journey-together-booster-bundle", title="Pokemon TCG Journey Together Booster Bundle"
    )
    store.page["products"].append(new)
    conn.commit()
    second = cycle(cfg, "watch", adapter, store.client())
    assert second.error is None
    assert kick.DISPATCH.is_set()  # alerts go out now, not on the next dispatcher poll
    kick.DISPATCH.clear()
    fresh = {(e.sku, e.event_type.value) for e in second.new_events}
    assert fresh == {
        ("8102", "IN_STOCK"),
        ("8101", "PRICE_CHANGE"),
        ("8120", "IN_STOCK"),  # new and already buyable: one event
    }
    events = [e for e in _events(conn, shop["id"]) if not e["suppressed"]]
    assert len(events) == 3
    rows = _products(conn, shop["id"])
    assert all(e["sealed"] == rows[e["sku"]]["sealed"] and e["sealed"] for e in events)
    drop = next(e for e in events if e["type"] == "PRICE_CHANGE")
    assert (drop["price_aud"], drop["previous_price_aud"]) == (D("79.95"), D("89.95"))
    assert rows["8102"]["availability"] == "in_stock_online"
    cart = conn.execute(
        "select cart_url from public.retail_products where retailer_id = %s and sku = '8102'", (shop["id"],)
    ).fetchone()
    assert (
        cart and cart["cart_url"] == "https://shop.example/cart/81021:1"
    )  # restocked: now the one buyable variant
    assert rows["8101"]["current_price_aud"] == D("79.95")
    assert rows["8110"]["current_price_aud"] == D("58.95")
    assert rows["8120"]["slug"] == "journey-together-booster-bundle"
    assert rows["8103"]["slug"] == "phantasmal-flames-elite-trainer-box"  # re-matched on the title change

    # 3. The store starts refusing us: blocked_reason is set, then cleared.
    store.status = 403
    conn.commit()
    blocked = cycle(cfg, "watch", adapter, store.client())
    assert blocked.error and blocked.error.startswith("403")
    reason = conn.execute(
        "select blocked_reason from public.retailers where id = %s", (shop["id"],)
    ).fetchone()
    assert reason and reason["blocked_reason"].startswith("403")
    store.status = 200
    conn.commit()
    ok = cycle(cfg, "watch", adapter_for(cfg), store.client())  # a restarted worker
    assert ok.error is None
    reason = conn.execute(
        "select blocked_reason from public.retailers where id = %s", (shop["id"],)
    ).fetchone()
    assert reason and reason["blocked_reason"] is None


def test_rematch_keeps_hand_made_matches(conn: Conn, shop: dict[str, str]) -> None:
    assert URL
    cycle = PostgresCycle(URL)
    [cfg] = [c for c in cycle.load_retailers() if c.slug == shop["slug"]]
    store = Store()
    cycle(cfg, "discovery", adapter_for(cfg), store.client())
    conn.commit()
    rows = _products(conn, shop["id"])
    # An admin points the UPC listing at the ETB product by hand.
    conn.execute(
        """update public.retail_products set sealed_product_id = %s, match_confidence = null
            where retailer_id = %s and sku = '8111'""",
        (rows["8101"]["sealed"], shop["id"]),
    )
    conn.execute(
        "update public.retail_products set sealed_product_id = null, match_confidence = null where retailer_id = %s and sku = '8104'",
        (shop["id"],),
    )
    stats = rematch(conn, retailer_slug=shop["slug"])
    conn.commit()
    assert stats["manual"] == 1 and stats["listings"] == 7 and stats["matched"] >= 6
    after = _products(conn, shop["id"])
    assert after["8111"]["sealed"] == rows["8101"]["sealed"]  # left alone
    assert after["8104"]["sealed"] == rows["8104"]["sealed"]  # re-matched to the same product
