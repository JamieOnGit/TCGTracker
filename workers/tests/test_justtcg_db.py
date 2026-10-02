"""The JustTCG prices job against a migrated database (supabase/tests/run.sh
leaves one with 4 fixture cards). Skipped unless TEST_DATABASE_URL is set."""

from __future__ import annotations

import os
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal as D

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.config import Env
from tcgworkers.jobs.prices import refresh_justtcg, refresh_prices
from tcgworkers.sources.population.base import SourceNotApproved
from tcgworkers.sources.pricing.justtcg import JustTcgClient, JustTcgError

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

EN_CHARIZARD = "20000000-0000-0000-0000-000000000001"
JP_CHARIZARD = "20000000-0000-0000-0000-000000000002"
EN_LUFFY = "20000000-0000-0000-0000-000000000003"
JP_LUFFY = "20000000-0000-0000-0000-000000000004"
NOW = datetime(2026, 9, 28, 6, 0, tzinfo=UTC)
LUFFY_EN = "c0000000-0000-5000-a000-000000000119:en:manga"


def _cleanup(c):
    c.rollback()
    c.execute(
        "delete from public.market_cap_snapshots where population is null and date between '2026-09-20' and '2026-09-27'"
    )
    c.execute("delete from public.price_points where source = 'justtcg'")
    c.execute("delete from public.card_external_ids where source = 'justtcg'")
    c.execute("delete from public.mapping_queue where source = 'justtcg'")
    c.execute("delete from public.justtcg_sets")
    c.execute("delete from public.cards where auto_created")
    c.execute("delete from public.sets where auto_created")
    c.execute("delete from public.fx_rates where source = 'test'")
    c.execute("delete from public.pipeline_runs where job = 'prices'")
    c.commit()


@pytest.fixture
def conn():
    with psycopg.connect(URL, row_factory=dict_row) as c:
        _cleanup(c)
        # USD -> AUD: 1.50 today, 1.40 on the 25th-26th (history converts at its own day's rate).
        for d, rate in ((date(2026, 9, 25), "1.4"), (date(2026, 9, 26), "1.4"), (NOW.date(), "1.5")):
            c.execute(
                "insert into public.fx_rates (currency, date, rate_to_aud, source) values ('USD', %s, %s, 'test')"
                " on conflict (currency, date) do update set rate_to_aud = excluded.rate_to_aud",
                (d, rate),
            )
        c.commit()
        yield c
        _cleanup(c)


def _mock(fixtures, *, max_requests=100, fail=None):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if fail:
            return fail(request)
        p = request.url.params
        if request.url.path == "/v1/sets":
            return httpx.Response(200, text=(fixtures / f"justtcg/sets-{p['game']}.json").read_text())
        if "graded" not in p:  # raw prices: one set has some, the others none
            if p["set"] == "awakening-of-the-new-era-one-piece-card-game":
                return httpx.Response(200, text=(fixtures / "justtcg/cards-op05-raw.json").read_text())
            return httpx.Response(200, json={"data": [], "meta": {"has_more": False}})
        name = {
            "sv-scarlet-violet-151-pokemon": "cards-151-p2.json"
            if p.get("cursor") == "page2"
            else "cards-151-p1.json",
            "sv2a-pokemon-card-151-pokemon-japan": "cards-sv2a.json",
            "awakening-of-the-new-era-one-piece-card-game": "cards-op05.json",
        }[p["set"]]
        return httpx.Response(200, text=(fixtures / "justtcg" / name).read_text())

    client = JustTcgClient(
        "key",
        user_agent="test",
        max_requests=max_requests,
        transport=httpx.MockTransport(handler),
        sleep=lambda s: None,
        min_interval=0,
    )
    return client, calls


def _price(conn, card, key, type_="sold", day=None):
    row = conn.execute(
        """select price, price_aud from public.price_points where source = 'justtcg' and card_id = %s
             and grade_key = %s and type = %s and (%s::date is null or observed_at::date = %s::date)
           order by observed_at desc limit 1""",
        (card, key, type_, day, day),
    ).fetchone()
    return row


def test_a_run_links_matches_queues_and_stores_every_grader(conn, fixtures):
    client, calls = _mock(fixtures)
    stats = refresh_justtcg(conn, Env.from_environ({}), client=client, now=NOW)

    assert stats["source"] == "justtcg" and stats["licence"]["display"] is True
    assert stats["sets_refreshed"] == 3 and stats["sets_remaining"] == 0
    assert stats["requests"] == 10  # 3 set lists + 4 graded card pages + 3 raw
    assert stats["no_number"] == 1  # the booster bundle
    assert stats["auto_linked"] == 1  # EN Luffy: same set name, number, variant and name
    assert stats["queued_for_review"] == 3  # EN + JP Charizard (sets named differently), JP Luffy
    assert stats["auto_created_cards"] == 1  # Umbreon VMAX

    # EN Luffy, every grader, converted at today's rate (x1.5).
    assert _price(conn, EN_LUFFY, "psa-10")["price_aud"] == D("4800.00")
    assert _price(conn, EN_LUFFY, "bgs-10")["price_aud"] == D("7500.00")
    assert _price(conn, EN_LUFFY, "psa-10", "ask")["price"] == D("3200.00")
    # Queued records get no prices until an admin decides.
    assert _price(conn, EN_CHARIZARD, "psa-10") is None
    queued = {
        r["external_id"]: r
        for r in conn.execute("select * from public.mapping_queue where source = 'justtcg'")
    }
    charizard = queued["c0000000-0000-5000-a000-000000000199:en:standard"]
    assert charizard["status"] == "pending" and str(charizard["suggested_card_id"]) == EN_CHARIZARD
    assert charizard["payload"]["set_name"] == "SV: Scarlet & Violet 151"

    # The auto-created Umbreon card has its price; labelled/qualified grades are never stored.
    umbreon = conn.execute(
        """select e.card_id from public.card_external_ids e where e.source = 'justtcg' and e.match_method = 'auto_created'"""
    ).fetchone()
    assert _price(conn, umbreon["card_id"], "psa-10")["price"] == D("2100.00")
    keys = {
        r["grade_key"]
        for r in conn.execute("select distinct grade_key from public.price_points where source = 'justtcg'")
    }
    assert keys == {"psa-10", "bgs-10", "raw"}  # only linked/created cards are priced in this run

    # Raw Near Mint (the main market price) for a card we have; other conditions are ignored,
    # and a raw-only card we don't have is neither created nor queued.
    assert _price(conn, EN_LUFFY, "raw")["price_aud"] == D("1350.00")
    assert stats["not_linked"] == 1
    assert (
        conn.execute(
            "select count(*) as n from public.mapping_queue where source = 'justtcg' and external_id like 'c0000000-0000-5000-a000-000000000777%'"
        ).fetchone()["n"]
        == 0
    )

    sets = {(r["justtcg_set_id"], r["lang"]): r for r in conn.execute("select * from public.justtcg_sets")}
    assert (
        "awakening-of-the-new-era-one-piece-card-game",
        "jp",
    ) in sets  # JP printings get their own set mapping
    assert all(r["refreshed_at"] == NOW and r["history_backfilled_at"] == NOW for r in sets.values())
    assert all(c.url.params.get("include") == "price_history.1y" for c in calls if c.url.path == "/v2/cards")
    run = conn.execute(
        "select status from public.pipeline_runs where job = 'prices' order by id desc limit 1"
    ).fetchone()
    assert run["status"] == "succeeded"


def test_history_backfills_daily_prices_at_their_own_fx_rate(conn, fixtures):
    client, _ = _mock(fixtures)
    stats = refresh_justtcg(conn, Env.from_environ({}), client=client, now=NOW)
    assert stats["history"]["written"] == 2 and stats["history"]["snapshots"] == 2
    # 26 Sep at 1.40, 27 Sep at the closest earlier rate (also 1.40).
    assert _price(conn, EN_LUFFY, "psa-10", day=date(2026, 9, 26))["price_aud"] == D("4340.00")
    assert _price(conn, EN_LUFFY, "psa-10", day=date(2026, 9, 27))["price_aud"] == D("4410.00")
    snaps = conn.execute(
        """select date, floor_aud, population, market_cap_aud from public.market_cap_snapshots
            where card_id = %s and grade_key = 'psa-10' and date < '2026-09-28' order by date""",
        (EN_LUFFY,),
    ).fetchall()
    assert [(s["date"], s["floor_aud"]) for s in snaps] == [
        (date(2026, 9, 26), D("4340.00")),
        (date(2026, 9, 27), D("4410.00")),
    ]
    assert all(s["population"] is None and s["market_cap_aud"] is None for s in snaps)


def test_fresh_sets_are_skipped_and_history_is_only_fetched_once(conn, fixtures):
    client, _ = _mock(fixtures)
    refresh_justtcg(conn, Env.from_environ({}), client=client, now=NOW)

    again, calls = _mock(fixtures)
    stats = refresh_justtcg(conn, Env.from_environ({}), client=again, now=NOW + timedelta(hours=2))
    assert stats["sets_due"] == 0 and all(c.url.path == "/v1/sets" for c in calls)

    later, calls = _mock(fixtures)
    stats = refresh_justtcg(conn, Env.from_environ({}), client=later, now=NOW + timedelta(hours=21))
    assert stats["sets_refreshed"] == 3
    card_calls = [c for c in calls if c.url.path == "/v2/cards"]
    assert card_calls and all("include" not in c.url.params for c in card_calls)
    # Same price next day: the sold snapshot doesn't grow, the ask is replaced.
    assert (
        conn.execute(
            "select count(*) as n from public.price_points where source = 'justtcg' and card_id = %s and grade_key = 'psa-10' and type = 'ask'",
            (EN_LUFFY,),
        ).fetchone()["n"]
        == 1
    )


def test_the_request_budget_stops_cleanly_and_the_next_run_continues(conn, fixtures):
    client, _ = _mock(fixtures, max_requests=5)  # 3 set lists + 2 card pages
    stats = refresh_justtcg(conn, Env.from_environ({}), client=client, now=NOW)
    assert (
        stats["stopped"] == "request budget used"
        and stats["sets_refreshed"] < 3
        and stats["sets_remaining"] > 0
    )
    run = conn.execute(
        "select status from public.pipeline_runs where job = 'prices' order by id desc limit 1"
    ).fetchone()
    assert run["status"] == "succeeded"

    rest, _ = _mock(fixtures)
    stats = refresh_justtcg(conn, Env.from_environ({}), client=rest, now=NOW + timedelta(minutes=5))
    assert stats["sets_refreshed"] == stats["sets_due"] and stats["sets_remaining"] == 0
    assert _price(conn, EN_LUFFY, "psa-10") is not None


def test_a_bad_key_fails_the_run_and_an_unknown_game_is_skipped(conn, fixtures):
    client, _ = _mock(fixtures, fail=lambda r: httpx.Response(401, json={"code": "INVALID_API_KEY"}))
    with pytest.raises(JustTcgError):
        refresh_justtcg(conn, Env.from_environ({}), client=client, now=NOW)
    run = conn.execute(
        "select status from public.pipeline_runs where job = 'prices' order by id desc limit 1"
    ).fetchone()
    assert run["status"] == "failed"

    def unknown_japan(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("game") == "pokemon-japan":
            return httpx.Response(400, json={"code": "INVALID_REQUEST", "error": "Invalid game parameter"})
        p = request.url.params
        if request.url.path == "/v1/sets":
            return httpx.Response(200, text=(fixtures / f"justtcg/sets-{p['game']}.json").read_text())
        page = {
            "sv-scarlet-violet-151-pokemon": "cards-151-p1.json",
            "awakening-of-the-new-era-one-piece-card-game": "cards-op05.json",
        }
        body = (
            (fixtures / "justtcg" / page[p["set"]])
            .read_text()
            .replace('"has_more": true', '"has_more": false')
        )
        return httpx.Response(200, text=body)

    ok, _ = _mock(fixtures, fail=unknown_japan)
    stats = refresh_justtcg(conn, Env.from_environ({}), client=ok, now=NOW)
    assert "pokemon-japan" in stats["errors"] and stats["sets_refreshed"] == 2


def test_the_scheduled_job_prefers_justtcg_and_needs_a_key(conn, fixtures):
    with pytest.raises(SourceNotApproved):
        refresh_prices(conn, Env.from_environ({}))
    client, _ = _mock(fixtures)
    stats = refresh_prices(conn, Env.from_environ({}), client=client)
    assert stats["source"] == "justtcg"


def test_an_empty_first_run_does_not_hold_sets_back(conn, fixtures):
    """The first live run fetched every set but stored nothing: the next run must fetch them all again, with history."""

    def empty(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/sets":
            return httpx.Response(
                200, text=(fixtures / f"justtcg/sets-{request.url.params['game']}.json").read_text()
            )
        return httpx.Response(200, json={"data": [], "meta": {"has_more": False}})

    client, _ = _mock(fixtures, fail=empty)
    stats = refresh_justtcg(conn, Env.from_environ({}), client=client, now=NOW)
    assert stats["sets_refreshed"] == 3 and stats["cards_seen"] == 0 and stats["products"] == 0

    again, calls = _mock(fixtures)
    stats = refresh_justtcg(conn, Env.from_environ({}), client=again, now=NOW + timedelta(minutes=30))
    assert stats["sets_due"] == 3 and stats["cards_seen"] > 0
    assert all(c.url.params.get("include") == "price_history.1y" for c in calls if c.url.path == "/v2/cards")
    assert _price(conn, EN_LUFFY, "psa-10") is not None
    assert stats["history"]["written"] == 2


def test_graded_variants_parse_with_loose_casing_and_other_usd_regions():
    from tcgworkers.sources.pricing.justtcg import JtGame, parse_card

    card = {
        "id": "u1",
        "name": "Pikachu - 025/165",
        "number": "025/165",
        "set": {"id": "s", "name": "S"},
        "variants": [
            {
                "type": "Graded",
                "grading": {"company": "psa", "grade": "10"},
                "markets": [{"region": "US", "currency": "usd", "price": 99}],
            },
        ],
    }
    [rec] = parse_card(card, JtGame("pokemon", "pokemon"))
    assert rec.prices["psa-10"].price_usd == D("99.00")
