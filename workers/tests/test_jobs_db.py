"""End-to-end pipeline test against a migrated database (supabase/tests/run.sh
leaves one behind). Skipped unless TEST_DATABASE_URL is set; CI sets it."""

from __future__ import annotations

import os
from decimal import Decimal as D

import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.jobs.registry import refresh_floors, snapshot_market_caps

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


@pytest.fixture
def conn():
    with psycopg.connect(URL, row_factory=dict_row) as c:
        c.execute("delete from public.floor_prices; delete from public.market_cap_snapshots;")
        c.execute("delete from public.population_snapshots; delete from public.price_points;")
        c.commit()
        yield c


def test_prices_and_population_become_a_ranked_market_cap(conn):
    cards = {r["lang"] + r["game"]: r["id"] for r in conn.execute("select id, game, lang from public.cards")}
    assert len(cards) == 4, "run supabase/tests/run.sh first"
    for i, card in enumerate(cards.values()):
        conn.execute(
            """insert into public.population_snapshots (card_id, grader, grade, population, source)
               values (%s, 'PSA', 10, %s, 'test')""",
            (card, 100 * (i + 1)),
        )
        conn.execute(
            """insert into public.price_points (card_id, grader, grade, type, price, currency, fx_rate, fx_date,
                 price_aud, source, observed_at)
               values (%s, 'PSA', 10, 'ask', 1000, 'USD', 1.5, current_date, 1500, 'test-source', now())""",
            (card,),
        )
    conn.commit()

    refresh_floors(conn, "test")
    snapshot_market_caps(conn, "test")
    conn.commit()

    rows = conn.execute(
        "select card_id, grade_key, lang, population, floor_aud, basis, market_cap_aud "
        "from public.market_cap_rankings where grade_key = 'psa-10' order by market_cap_aud desc"
    ).fetchall()
    assert len(rows) == 4
    # EN Charizard has an active marketplace listing in the fixture DB -> marketplace ask wins.
    en_charizard = next(r for r in rows if r["card_id"] == cards["enpokemon"])
    assert en_charizard["basis"] == "marketplace_ask" and en_charizard["floor_aud"] == D("4500.00")
    others = [r for r in rows if r["card_id"] != cards["enpokemon"]]
    assert all(r["basis"] == "external_ask" and r["floor_aud"] == D("1500.00") for r in others)
    assert all(r["market_cap_aud"] == r["population"] * r["floor_aud"] for r in rows)
    runs = conn.execute("select job, status from public.pipeline_runs where job in ('floors','snapshots')")
    assert {(r["job"], r["status"]) for r in runs} >= {("floors", "succeeded"), ("snapshots", "succeeded")}
