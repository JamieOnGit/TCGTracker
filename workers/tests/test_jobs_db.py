"""End-to-end pipeline test against a migrated database (supabase/tests/run.sh
leaves one behind). Skipped unless TEST_DATABASE_URL is set; CI sets it."""

from __future__ import annotations

import os
from decimal import Decimal as D

import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.jobs.registry import refresh_floors, snapshot_market_caps, warn_expiring_listings

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


def _clean(c):
    c.rollback()
    c.execute("delete from public.floor_prices; delete from public.market_cap_snapshots;")
    c.execute("delete from public.population_snapshots; delete from public.price_points;")
    c.commit()


@pytest.fixture
def conn():
    with psycopg.connect(URL, row_factory=dict_row) as c:
        _clean(c)
        yield c
        _clean(c)  # leave nothing for the other suites' tests


def _seed(conn, cards, *, without_population=()):
    for i, (key, card) in enumerate(cards.items()):
        if key not in without_population:
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


def _cards(conn):
    cards = {r["lang"] + r["game"]: r["id"] for r in conn.execute("select id, game, lang from public.cards")}
    assert len(cards) == 4, "run supabase/tests/run.sh first"
    return cards


def test_prices_and_population_become_a_ranked_market_cap(conn):
    cards = _cards(conn)
    _seed(conn, cards)

    refresh_floors(conn, "test")
    snapshot_market_caps(conn, "test")
    conn.commit()

    rows = conn.execute(
        "select card_id, grade_key, lang, population, floor_aud, basis, market_cap_aud, rank_value "
        "from public.market_cap_rankings where grade_key = 'psa-10' order by rank_value desc"
    ).fetchall()
    assert len(rows) == 4
    # EN Charizard has an active marketplace listing in the fixture DB -> marketplace ask wins.
    en_charizard = next(r for r in rows if r["card_id"] == cards["enpokemon"])
    assert en_charizard["basis"] == "marketplace_ask" and en_charizard["floor_aud"] == D("4500.00")
    others = [r for r in rows if r["card_id"] != cards["enpokemon"]]
    assert all(r["basis"] == "external_ask" and r["floor_aud"] == D("1500.00") for r in others)
    assert all(r["market_cap_aud"] == r["population"] * r["floor_aud"] for r in rows)
    assert all(r["rank_value"] == r["market_cap_aud"] for r in rows)
    runs = conn.execute("select job, status from public.pipeline_runs where job in ('floors','snapshots')")
    assert {(r["job"], r["status"]) for r in runs} >= {("floors", "succeeded"), ("snapshots", "succeeded")}


def test_cards_without_population_rank_by_price_until_population_exists(conn):
    cards = _cards(conn)
    no_pop = next(k for k in cards if k != "enpokemon")
    _seed(conn, cards, without_population={no_pop})

    refresh_floors(conn, "test")
    snapshot_market_caps(conn, "test")
    conn.commit()

    snap = conn.execute(
        "select population, market_cap_aud, floor_aud from public.market_cap_snapshots "
        "where card_id = %s and grade_key = 'psa-10'",
        (cards[no_pop],),
    ).fetchone()
    assert snap["population"] is None and snap["market_cap_aud"] is None and snap["floor_aud"] == D("1500.00")

    rows = {
        r["card_id"]: r
        for r in conn.execute(
            "select card_id, population, market_cap_aud, floor_aud, rank_value "
            "from public.market_cap_rankings where grade_key = 'psa-10'"
        )
    }
    assert len(rows) == 4, "price-only cards are ranked while market.rank_by_price_until_population is on"
    assert rows[cards[no_pop]]["rank_value"] == D("1500.00")
    assert rows[cards[no_pop]]["market_cap_aud"] is None

    # With the setting off, only cards with a real market cap are ranked.
    conn.execute(
        "update public.site_settings set value = 'false' where key = 'market.rank_by_price_until_population'"
    )
    try:
        conn.execute("refresh materialized view public.market_cap_rankings")
        ids = {
            r["card_id"]
            for r in conn.execute("select card_id from public.market_cap_rankings where grade_key = 'psa-10'")
        }
        assert cards[no_pop] not in ids and len(ids) == 3
    finally:
        conn.rollback()


def test_listing_expiry_warning_is_queued_once_per_expiry(conn):
    listing = conn.execute(
        "select id, seller_id, expires_at from public.listings where status = 'active' order by id limit 1"
    ).fetchone()
    assert listing, "run supabase/tests/run.sh first"
    try:
        conn.execute(
            "update public.listings set expires_at = now() + interval '2 days' where id = %s",
            (listing["id"],),
        )
        conn.execute("delete from public.email_outbox where template = 'listing_expiring'")
        conn.execute("delete from public.notifications where type = 'listing_expiring'")
        conn.commit()

        warn_expiring_listings(conn, "test")
        warn_expiring_listings(conn, "test")  # hourly job: must not repeat

        emails = conn.execute(
            "select user_id, template, data from public.email_outbox where template = 'listing_expiring'"
        ).fetchall()
        assert len(emails) == 1 and emails[0]["user_id"] == listing["seller_id"]
        assert emails[0]["data"]["listing_id"] == listing["id"] and emails[0]["data"]["expires_at"]
        bell = conn.execute(
            "select count(*) as n from public.notifications where type = 'listing_expiring'"
        ).fetchone()
        assert bell["n"] == 1

        # Renewing moves the expiry, so the next warning is a new one.
        conn.execute(
            "update public.listings set expires_at = now() + interval '3 days' where id = %s",
            (listing["id"],),
        )
        conn.commit()
        warn_expiring_listings(conn, "test")
        n = conn.execute(
            "select count(*) as n from public.email_outbox where template = 'listing_expiring'"
        ).fetchone()
        assert n["n"] == 2
    finally:
        conn.rollback()
        conn.execute(
            "update public.listings set expires_at = %s where id = %s", (listing["expires_at"], listing["id"])
        )
        conn.execute("delete from public.email_outbox where template = 'listing_expiring'")
        conn.execute("delete from public.notifications where type = 'listing_expiring'")
        conn.commit()


def test_cheap_cards_are_ranked_without_daily_snapshots_and_old_snapshots_thin_to_weekly(conn):
    cards = _cards(conn)
    _seed(conn, cards)
    cheap = cards["jppokemon"]
    conn.execute("update public.price_points set price_aud = 2 where card_id = %s", (cheap,))
    # 70 days of daily history for another card: older than 60 days keeps Mondays only.
    conn.execute(
        """insert into public.market_cap_snapshots (card_id, grade_key, date, floor_aud, basis)
           select %s, 'psa-10', d::date, 1000, 'external_ask'
             from generate_series(current_date - 70, current_date - 1, interval '1 day') d""",
        (cards["enone-piece"],),
    )
    conn.commit()

    refresh_floors(conn, "test")
    snapshot_market_caps(conn, "test")
    conn.commit()

    # Under market.snapshot_min_aud (A$5): no snapshot, but still ranked from its current floor.
    assert not conn.execute(
        "select 1 from public.market_cap_snapshots where card_id = %s", (cheap,)
    ).fetchone()
    ranked = conn.execute(
        "select floor_aud from public.market_cap_rankings where card_id = %s and grade_key = 'psa-10'",
        (cheap,),
    ).fetchone()
    assert ranked["floor_aud"] == D("2.00")

    old = conn.execute(
        """select date from public.market_cap_snapshots
            where card_id = %s and date < (now() at time zone 'Australia/Melbourne')::date - 60""",
        (cards["enone-piece"],),
    ).fetchall()
    assert old and all(r["date"].isoweekday() == 1 for r in old)
    recent = conn.execute(
        """select count(*) as n from public.market_cap_snapshots
            where card_id = %s and date >= (now() at time zone 'Australia/Melbourne')::date - 60""",
        (cards["enone-piece"],),
    ).fetchone()
    assert recent["n"] >= 60  # the last 60 days stay daily


def test_floors_stream_in_batches_with_the_same_result(conn, monkeypatch):
    from tcgworkers.jobs import registry

    cards = _cards(conn)
    _seed(conn, cards)
    cols = "card_id, grade_key, floor_aud, basis, source, sample_size, last_sold_aud, median_sold_30d_aud"

    refresh_floors(conn, "test")
    conn.commit()
    whole = conn.execute(f"select {cols} from public.floor_prices order by card_id, grade_key").fetchall()
    conn.execute("delete from public.floor_prices")
    conn.commit()

    # One row per fetch and one floor per write: every group boundary falls on a batch edge.
    monkeypatch.setattr(registry, "FLOOR_FETCH", 1)
    monkeypatch.setattr(registry, "FLOOR_BATCH", 1)
    refresh_floors(conn, "test")
    conn.commit()
    streamed = conn.execute(f"select {cols} from public.floor_prices order by card_id, grade_key").fetchall()
    assert len(whole) >= 4 and streamed == whole
