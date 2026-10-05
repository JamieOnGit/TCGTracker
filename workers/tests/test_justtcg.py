"""JustTCG parsing and client behaviour (no database, no network)."""

from __future__ import annotations

import json
from decimal import Decimal as D

import httpx
import pytest

from tcgworkers.sources.pricing.justtcg import (
    DEFAULT_GAMES,
    BudgetExhausted,
    JtGame,
    JustTcgClient,
    JustTcgError,
    games_from_setting,
    licence,
    parse_card,
    parse_name,
    variant_for,
)

POKEMON = JtGame("pokemon", "pokemon")
ONE_PIECE = JtGame("one-piece-card-game", "one-piece")
JAPAN = JtGame("pokemon-japan", "pokemon", "jp")


def _load(fixtures, name):
    return json.loads((fixtures / "justtcg" / name).read_text())


def test_names_lose_the_number_and_keep_variant_words():
    assert parse_name("Charizard ex - 199/165", "199/165") == ("Charizard ex", [])
    assert parse_name("Monkey.D.Luffy (Manga)", "OP05-119") == ("Monkey.D.Luffy", ["Manga"])
    assert parse_name("Monkey.D.Luffy (Alternate Art) (Manga)", "OP05-119") == (
        "Monkey.D.Luffy",
        ["Alternate Art", "Manga"],
    )
    assert parse_name("Pikachu (Promo) (085)", "085") == ("Pikachu", [])


def test_variants_match_our_catalogue_words():
    assert variant_for([], "Holofoil") == "standard"
    assert variant_for([], "Normal") == "standard"
    assert variant_for([], "Reverse Holofoil") == "reverse-holo"
    assert variant_for(["Manga"], None) == "manga"
    assert variant_for(["Alternate Art", "Manga"], None) == "manga-alt-art"
    assert variant_for(["Alternate Art"], None) == "alt-art"


def test_graded_prices_per_company_and_grade_skipping_labels_and_qualifiers(fixtures):
    card = _load(fixtures, "cards-151-p1.json")["data"][0]
    [rec] = parse_card(card, POKEMON)
    assert rec.external_id == "c0000000-0000-5000-a000-000000000199:en:standard"
    assert (rec.name, rec.number, rec.lang, rec.set_name) == (
        "Charizard ex",
        "199/165",
        "en",
        "SV: Scarlet & Violet 151",
    )
    assert sorted(rec.prices) == ["bgs-9.5", "cgc-10", "psa-10", "psa-9", "sgc-10"]
    # The OC-qualified PSA 10 (700) and the CGC Pristine 10 (900) are left out.
    assert rec.prices["psa-10"].price_usd == D("1250.00")
    assert rec.prices["cgc-10"].price_usd == D("820.00")
    assert [str(p) for _, p in rec.prices["psa-10"].history] == ["1200.00", "1225.00", "1240.00"]


def test_one_piece_languages_become_separate_records_and_others_are_skipped(fixtures):
    card = _load(fixtures, "cards-op05.json")["data"][0]
    recs = {r.lang: r for r in parse_card(card, ONE_PIECE)}
    assert set(recs) == {"en", "jp"}  # French is not in our catalogue
    assert recs["en"].variant == "manga" and sorted(recs["en"].prices) == ["bgs-10", "psa-10"]
    assert recs["jp"].prices["psa-10"].price_usd == D("2900.00")
    assert recs["en"].external_id != recs["jp"].external_id


def test_a_japanese_only_game_fixes_the_language(fixtures):
    [rec] = parse_card(_load(fixtures, "cards-sv2a.json")["data"][0], JAPAN)
    assert rec.lang == "jp" and rec.external_id.endswith(":jp:standard")


def test_cards_without_a_number_are_kept_but_flagged_and_companies_filter(fixtures):
    [box] = parse_card(_load(fixtures, "cards-151-p1.json")["data"][1], POKEMON)
    assert box.number is None
    only_psa = parse_card(_load(fixtures, "cards-151-p1.json")["data"][0], POKEMON, ("PSA",))[0]
    assert sorted(only_psa.prices) == ["psa-10", "psa-9"]


def test_games_setting_falls_back_to_defaults():
    assert games_from_setting(None) == DEFAULT_GAMES
    assert games_from_setting([{"id": "x", "game": "mtg"}]) == DEFAULT_GAMES
    assert games_from_setting([{"id": "one-piece-card-game", "game": "one-piece", "lang": "jp"}]) == (
        JtGame("one-piece-card-game", "one-piece", "jp"),
    )


def test_licence_allows_display_but_not_redistribution():
    lic = licence()
    assert lic.display is True and lic.redistribute is False and "JustTCG" in lic.attribution


# ------------------------------------------------------------------ client
def _client(handler, *, max_requests=50):
    sleeps: list[float] = []
    client = JustTcgClient(
        "secret-key",
        user_agent="test",
        max_requests=max_requests,
        transport=httpx.MockTransport(handler),
        sleep=sleeps.append,
        min_interval=0,
    )
    return client, sleeps


def test_client_pages_with_the_cursor_and_sends_the_key(fixtures):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        page = "cards-151-p2.json" if request.url.params.get("cursor") == "page2" else "cards-151-p1.json"
        return httpx.Response(200, text=(fixtures / "justtcg" / page).read_text())

    client, _ = _client(handler)
    cards = list(client.cards("pokemon", "sv-scarlet-violet-151-pokemon", history="1y"))
    assert [c["number"] for c in cards] == ["199/165", None, "215/203"]
    assert all(r.headers["x-api-key"] == "secret-key" for r in seen)
    assert seen[0].url.params["graded"] == "only" and seen[0].url.params["include"] == "price_history.1y"
    assert seen[1].url.params["cursor"] == "page2" and client.requests == 2


def test_client_backs_off_on_429_honouring_retry_after():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "3"}, json={"code": "RATE_LIMIT_EXCEEDED"})
        return httpx.Response(200, json={"data": [], "meta": {"hasMore": False}})

    client, sleeps = _client(handler)
    assert client.sets("pokemon") == []
    assert 3.0 in sleeps and calls["n"] == 2


def test_daily_limit_stops_without_retrying():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"code": "DAILY_LIMIT_EXCEEDED"})

    client, _ = _client(handler)
    with pytest.raises(JustTcgError) as err:
        client.sets("pokemon")
    assert err.value.code == "DAILY_LIMIT_EXCEEDED" and client.requests == 1


def test_errors_never_contain_the_key_and_the_budget_is_enforced():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text=f"bad key {request.headers['x-api-key']}")

    client, _ = _client(handler)
    with pytest.raises(JustTcgError) as err:
        client.sets("pokemon")
    assert "secret-key" not in str(err.value) and err.value.status == 401

    ok, _ = _client(lambda r: httpx.Response(200, json={"data": [], "meta": {}}), max_requests=1)
    ok.sets("pokemon")
    with pytest.raises(BudgetExhausted):
        ok.sets("pokemon")


def test_the_probe_summarises_what_came_back(fixtures):
    from tcgworkers.sources.pricing.justtcg_probe import summarise

    out = summarise(_load(fixtures, "cards-151-p1.json"))
    assert out["cards"] == 2 and out["variants_by_type"] == {"graded": 8}
    assert out["graded_companies"]["PSA"] == 4 and out["first_priced"]["number"] == "199/165"
    assert summarise({"data": [], "meta": {"has_more": False}})["cards"] == 0


def test_equally_stale_sets_take_turns_between_games():
    from datetime import UTC, datetime

    from tcgworkers.jobs.prices import _due_sets
    from tcgworkers.sources.pricing.justtcg import DEFAULT_GAMES

    class Rows:
        def __init__(self, rows):
            self.rows = rows

        def fetchone(self):
            return self.rows[0]

        def __iter__(self):
            return iter(self.rows)

    class Conn:
        def execute(self, sql, *args):
            if "exists" in sql:
                return Rows([{"e": True}])  # prices stored before: the normal path
            return Rows([])  # no set fetched yet

    listed = {
        "pokemon": [{"id": f"en-{i}"} for i in range(3)],
        "pokemon-japan": [{"id": f"jp-{i}"} for i in range(2)],
        "one-piece-card-game": [{"id": f"op-{i}"} for i in range(2)],
    }
    due = _due_sets(Conn(), DEFAULT_GAMES, listed, 20, datetime(2026, 10, 5, tzinfo=UTC))
    # English Pokémon no longer goes first in full: Japanese and One Piece get turns.
    assert [s["id"] for _, s, _ in due] == ["en-0", "jp-0", "op-0", "en-1", "jp-1", "op-1", "en-2"]
