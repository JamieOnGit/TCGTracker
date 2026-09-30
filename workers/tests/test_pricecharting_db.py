"""PriceCharting ingestion against a migrated database (supabase/tests/run.sh
leaves one with 4 fixture cards). Skipped unless TEST_DATABASE_URL is set."""

from __future__ import annotations

import json
import os
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal as D

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.config import Env
from tcgworkers.db import load_rules
from tcgworkers.jobs.prices import refresh_prices
from tcgworkers.sources.pricing.ingest import Fx, PcIngestor, StaleFx, latest_usd_fx
from tcgworkers.sources.pricing.pricecharting import PcProduct, PriceChartingClient, parse_csv

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

EN_CHARIZARD = "20000000-0000-0000-0000-000000000001"
JP_CHARIZARD = "20000000-0000-0000-0000-000000000002"
EN_LUFFY = "20000000-0000-0000-0000-000000000003"
JP_LUFFY = "20000000-0000-0000-0000-000000000004"
NOW = datetime(2026, 9, 28, 6, 0, tzinfo=UTC)
FX = Fx(D("1.50000000"), date(2026, 9, 26))


def _cleanup(c):
    c.rollback()
    c.execute("delete from public.price_points where source = 'pricecharting'")
    c.execute("delete from public.card_external_ids where source = 'pricecharting'")
    c.execute("delete from public.mapping_queue where source = 'pricecharting'")
    c.execute("delete from public.pricecharting_consoles")
    c.execute("delete from public.cards where auto_created")
    c.execute("delete from public.sets where auto_created")
    c.execute("delete from public.fx_rates where source = 'test'")
    c.execute("delete from public.pipeline_runs where job = 'prices'")
    c.commit()


@pytest.fixture
def conn():
    with psycopg.connect(URL, row_factory=dict_row) as c:
        _cleanup(c)
        yield c
        _cleanup(c)


def _products(fixtures):
    return [
        *parse_csv((fixtures / "pricecharting/price-guide-pokemon-cards.csv").read_text()),
        *parse_csv((fixtures / "pricecharting/price-guide-one-piece-cards.csv").read_text()),
    ]


def _ingest(conn, products, now=NOW):
    ing = PcIngestor(conn, rules=load_rules(conn), now=now)
    stats = ing.ingest(products, FX)
    conn.commit()
    return stats


def test_every_record_goes_through_the_matcher(conn, fixtures):
    stats = _ingest(conn, _products(fixtures))
    assert stats.products == 8
    assert stats.excluded_console == 2  # Chinese Pokémon + One Piece Carddass
    assert stats.no_number == 1  # the booster box
    assert stats.auto_linked == 1  # EN Luffy manga: same set name, number, variant, name
    assert stats.queued_for_review == 3  # EN + JP Charizard (set named differently), JP Luffy
    assert stats.auto_created_cards == 1  # Umbreon VMAX: nothing like it in the catalogue

    links = {
        r["external_id"]: r
        for r in conn.execute("select * from public.card_external_ids where source = 'pricecharting'")
    }
    assert str(links["6235917"]["card_id"]) == EN_LUFFY and links["6235917"]["match_method"] == "auto"
    assert links["2513024"]["match_method"] == "auto_created"

    queue = {
        r["external_id"]: r
        for r in conn.execute("select * from public.mapping_queue where source = 'pricecharting'")
    }
    assert (
        queue["5809582"]["status"] == "pending" and str(queue["5809582"]["suggested_card_id"]) == EN_CHARIZARD
    )
    assert str(queue["5326231"]["suggested_card_id"]) == JP_CHARIZARD  # JP only ever suggests JP
    assert str(queue["8506781"]["suggested_card_id"]) == JP_LUFFY
    assert queue["2513024"]["status"] == "created_card" and queue["2513024"]["resolved_card_id"] is not None

    umbreon = conn.execute(
        "select c.*, s.auto_created as set_auto, s.name as set_name from public.cards c join public.sets s on s.id = c.set_id "
        "where c.id = %s",
        (links["2513024"]["card_id"],),
    ).fetchone()
    assert umbreon["auto_created"] and umbreon["set_auto"] and umbreon["set_name"] == "Evolving Skies"
    assert (umbreon["game"], umbreon["lang"], umbreon["number"], umbreon["name"]) == (
        "pokemon",
        "en",
        "215",
        "Umbreon VMAX",
    )

    consoles = {r["console_name"]: r for r in conn.execute("select * from public.pricecharting_consoles")}
    assert consoles["One Piece Carddass Hyper Battle"]["excluded"]
    assert not consoles["One Piece Awakening of the New Era"]["confirmed"]
    assert consoles["Pokemon Japanese Scarlet & Violet 151"]["lang"] == "jp"


def test_prices_are_converted_and_stored_with_honest_grade_keys(conn, fixtures):
    _ingest(conn, _products(fixtures))
    rows = conn.execute(
        """select grade_key, type::text as type, price, currency, price_aud, fx_rate, observed_at, url
             from public.price_points where source = 'pricecharting' and card_id = %s order by grade_key, type""",
        (EN_LUFFY,),
    ).fetchall()
    keys = {(r["grade_key"], r["type"]) for r in rows}
    assert keys == {(g, t) for g in ("any-8", "any-9", "cgc-10", "psa-10", "raw") for t in ("ask", "sold")}
    assert not any(r["grade_key"] == "psa-9" for r in rows)
    psa10 = next(r for r in rows if r["grade_key"] == "psa-10" and r["type"] == "sold")
    assert (
        psa10["price"] == D("1200.00") and psa10["currency"] == "USD" and psa10["price_aud"] == D("1800.00")
    )
    assert psa10["observed_at"] == datetime(2026, 9, 28, tzinfo=UTC)
    assert psa10["url"] == "https://www.pricecharting.com/game/6235917"
    # Review-queue products get no prices until an admin decides.
    n = conn.execute(
        "select count(*) as n from public.price_points where card_id = %s", (EN_CHARIZARD,)
    ).fetchone()["n"]
    assert n == 0


def test_reruns_are_idempotent_and_sold_history_only_grows_on_change(conn, fixtures):
    products = _products(fixtures)
    _ingest(conn, products)
    count = lambda t: conn.execute(  # noqa: E731
        "select count(*) as n from public.price_points where source = 'pricecharting' and type = %s", (t,)
    ).fetchone()["n"]
    asks, solds = count("ask"), count("sold")
    _ingest(conn, products)  # same day again
    assert (count("ask"), count("sold")) == (asks, solds)

    luffy = next(p for p in products if p.id == "6235917")
    changed = PcProduct(
        luffy.id, luffy.console_name, luffy.product_name, {**luffy.prices, "manual-only-price": 130000}
    )
    _ingest(conn, [changed], now=NOW + timedelta(days=1))
    assert count("ask") == asks  # asks replaced, not accumulated
    assert count("sold") == solds + 1  # only the PSA 10 value changed
    ask = conn.execute(
        """select price, observed_at from public.price_points
            where source = 'pricecharting' and type = 'ask' and source_ref = '6235917:manual-only-price'"""
    ).fetchall()
    assert len(ask) == 1 and ask[0]["price"] == D("1300.00")


def test_store_types_setting_controls_ask_and_sold(conn, fixtures):
    conn.execute(
        "update public.site_settings set value = '[\"sold\"]' where key = 'pricecharting.store_types'"
    )
    conn.commit()
    try:
        _ingest(conn, _products(fixtures))
        types = {
            r["type"]
            for r in conn.execute(
                "select distinct type::text as type from public.price_points where source = 'pricecharting'"
            )
        }
        assert types == {"sold"}
    finally:
        conn.execute(
            "update public.site_settings set value = '[\"sold\", \"ask\"]' where key = 'pricecharting.store_types'"
        )
        conn.commit()


def test_admin_rejected_products_are_skipped(conn, fixtures):
    _ingest(conn, _products(fixtures))
    conn.execute("update public.mapping_queue set status = 'rejected' where external_id = '5809582'")
    conn.commit()
    stats = _ingest(conn, _products(fixtures))
    assert stats.rejected == 1


def test_fx_must_exist_and_be_recent(conn):
    with pytest.raises(StaleFx):
        latest_usd_fx(conn, max_age_days=7, today=date(2026, 9, 28))
    conn.execute(
        "insert into public.fx_rates (currency, date, rate_to_aud, source) values ('USD', '2026-09-01', 1.5, 'test')"
    )
    with pytest.raises(StaleFx):
        latest_usd_fx(conn, max_age_days=7, today=date(2026, 9, 28))
    assert latest_usd_fx(conn, max_age_days=30, today=date(2026, 9, 28)).rate_to_aud == D("1.5")


def _mock_pc(fixtures, *, fail_one_piece=False):
    texts = {
        "pokemon-cards": (fixtures / "pricecharting/price-guide-pokemon-cards.csv").read_text(),
        "one-piece-cards": (fixtures / "pricecharting/price-guide-one-piece-cards.csv").read_text(),
    }
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/api/product":
            return httpx.Response(200, text=(fixtures / "pricecharting/api-product-6235917.json").read_text())
        if request.url.path == "/api/products":
            return httpx.Response(200, text=(fixtures / "pricecharting/api-products-search.json").read_text())
        category = request.url.params["category"]
        if fail_one_piece and category == "one-piece-cards":
            return httpx.Response(404, text="not found")
        return httpx.Response(200, text=texts[category])

    client = PriceChartingClient("tok", transport=httpx.MockTransport(handler), sleep=lambda s: None)
    return client, calls


def test_prices_job_csv_path_then_skips_until_tomorrow(conn, fixtures):
    conn.execute(
        "insert into public.fx_rates (currency, date, rate_to_aud, source) values ('USD', current_date, 1.5, 'test')"
    )
    conn.commit()
    client, calls = _mock_pc(fixtures)
    env = Env.from_environ({})
    stats = refresh_prices(conn, env, client=client)
    assert stats["mode"] == "csv" and stats["auto_linked"] == 1 and stats["licence"]["display"] is False
    run = conn.execute(
        "select status, stats from public.pipeline_runs where job = 'prices' order by id desc limit 1"
    ).fetchone()
    assert run["status"] == "succeeded" and run["stats"]["mode"] == "csv"

    again = refresh_prices(conn, env, client=client)
    assert again["mode"] == "skipped" and len(calls) == 2


def test_prices_job_falls_back_to_the_api_when_a_csv_fails(conn, fixtures):
    conn.execute(
        "insert into public.fx_rates (currency, date, rate_to_aud, source) values ('USD', current_date, 1.5, 'test')"
    )
    # EN Luffy is already linked; JP Luffy has no link, so the API search looks for it.
    conn.execute(
        """insert into public.card_external_ids (card_id, source, external_id, lang, match_method)
           values (%s, 'pricecharting', '6235917', 'en', 'manual')""",
        (EN_LUFFY,),
    )
    conn.commit()
    client, calls = _mock_pc(fixtures, fail_one_piece=True)
    stats = refresh_prices(conn, Env.from_environ({}), client=client)
    assert stats["mode"] == "csv+api" and "one-piece-cards" in stats["csv_errors"]
    assert "/api/product" in calls and "/api/products" in calls
    psa10 = conn.execute(
        """select price from public.price_points where source = 'pricecharting' and card_id = %s
             and grade_key = 'psa-10' and type = 'sold'""",
        (EN_LUFFY,),
    ).fetchone()
    assert psa10["price"] == D("1250.00")  # from the API (integer cents), not the failed CSV
    queued = conn.execute(
        "select external_id from public.mapping_queue where external_id = '8506781'"
    ).fetchone()
    assert queued is not None  # JP Luffy found by search, sent to review
    assert json.loads(json.dumps(stats, default=str))  # stats are JSON-safe
