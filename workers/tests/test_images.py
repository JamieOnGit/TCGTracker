"""Scrydex image matching (no database, no network)."""

from __future__ import annotations

import httpx
import pytest

from tcgworkers.jobs.images import (
    OurCard,
    OurSealed,
    alt_prints,
    match_card,
    match_sealed,
    product_type,
    similarity,
)
from tcgworkers.matching.matcher import normalise_number
from tcgworkers.sources.images.scrydex import (
    BudgetExhausted,
    ScrydexClient,
    ScrydexError,
    front_image,
    lang_of,
)


def _img(key: str) -> list[dict[str, str]]:
    return [
        {
            "type": "front",
            "small": f"https://img/{key}/s",
            "medium": f"https://img/{key}/m",
            "large": f"https://img/{key}/l",
        }
    ]


def _index(*cards: OurCard) -> dict[tuple[str, str], list[OurCard]]:
    out: dict[tuple[str, str], list[OurCard]] = {}
    for c in cards:
        out.setdefault((c.lang, normalise_number(c.number)), []).append(c)
    return out


def test_front_image_prefers_large_and_front():
    assert front_image({"images": [{"type": "back", "large": "https://b"}, *_img("x")]}) == "https://img/x/l"
    assert front_image({"images": [{"type": "front", "small": "https://s"}]}) == "https://s"
    assert front_image({"images": [{"type": "front", "large": "http://insecure"}]}) is None
    assert front_image({}) is None


def test_languages():
    assert lang_of({"language_code": "JA"}) == "jp"
    assert lang_of({"expansion": {"language_code": "EN"}}) == "en"
    assert lang_of({"language_code": "ZH"}) is None


def test_pokemon_cards_match_by_number_name_and_set():
    sir = OurCard("1", "en", "199", "Charizard ex", "sir", "SV: Scarlet & Violet 151", True)
    other = OurCard("2", "en", "199", "Charizard ex", "standard", "Obsidian Flames", True)
    scx = {"name": "Charizard ex", "printed_number": "199/165", "expansion": {"name": "151"}}
    # Same number and name in two of our sets: the set name decides.
    assert match_card(scx, "en", _index(sir, other)) == [sir]
    # A Pokémon special illustration rare has its own number, so it takes that number's image.
    assert match_card(scx, "en", _index(sir)) == [sir]
    # Wrong language or name: nothing.
    assert match_card(scx, "jp", _index(sir)) == []
    assert match_card({**scx, "name": "Pikachu"}, "en", _index(sir)) == []


def test_reprints_in_several_sets_without_a_set_match_are_left_alone():
    a = OurCard("1", "en", "25", "Pikachu", "standard", "Base Set", True)
    b = OurCard("2", "en", "25", "Pikachu", "standard", "Jungle", True)
    assert (
        match_card(
            {"name": "Pikachu", "number": "25", "expansion": {"name": "Celebrations"}}, "en", _index(a, b)
        )
        == []
    )


def test_one_piece_alternate_prints_need_their_own_variant_image():
    base = OurCard("1", "en", "OP05-119", "Monkey.D.Luffy", "standard", "Awakening of the New Era", True)
    manga = OurCard("2", "en", "OP05-119", "Monkey.D.Luffy", "manga", "Awakening of the New Era", True)
    alt = OurCard("3", "en", "OP05-119", "Monkey.D.Luffy", "alt-art", "Awakening of the New Era", True)
    scx = {
        "name": "Monkey.D.Luffy",
        "number": "OP05-119",
        "expansion": {"name": "Awakening of the New Era"},
        "images": _img("base"),
        "variants": [
            {"name": "mangaArt", "images": _img("manga")},
            {"name": "alternateArt", "images": _img("alt")},
        ],
    }
    idx = _index(base, manga, alt)
    assert match_card(scx, "en", idx, "one-piece") == [base]  # never the base art on an alt print
    assert sorted((c.id, u) for c, u in alt_prints(scx, "en", idx, "one-piece")) == [
        ("2", "https://img/manga/l"),
        ("3", "https://img/alt/l"),
    ]
    assert alt_prints({**scx, "variants": []}, "en", idx, "one-piece") == []


def test_sealed_products_match_by_type_and_name():
    etb = OurSealed("e", "pokemon", "en", "Prismatic Evolutions Elite Trainer Box", "etb", True)
    bb = OurSealed("b", "pokemon", "en", "Prismatic Evolutions Booster Box", "booster-box", True)
    bundle = OurSealed("u", "pokemon", "en", "Prismatic Evolutions Booster Bundle", "booster-bundle", True)
    ours = [etb, bb, bundle]
    assert (
        match_sealed(
            {
                "name": "Pokémon TCG: Prismatic Evolutions Elite Trainer Box",
                "type": "Elite Trainer Box",
                "language_code": "EN",
            },
            "pokemon",
            ours,
        )
        is etb
    )
    assert (
        match_sealed(
            {"name": "Prismatic Evolutions Booster Bundle", "type": "Booster Bundle", "language_code": "EN"},
            "pokemon",
            ours,
        )
        is bundle
    )
    # A different product type never takes the image, however similar the name.
    assert (
        match_sealed(
            {"name": "Prismatic Evolutions Tin", "type": "Tin", "language_code": "EN"}, "pokemon", ours
        )
        is None
    )
    # Wrong language or unrelated name: nothing.
    assert (
        match_sealed(
            {
                "name": "Prismatic Evolutions Elite Trainer Box",
                "type": "Elite Trainer Box",
                "language_code": "JA",
            },
            "pokemon",
            ours,
        )
        is None
    )
    assert (
        match_sealed(
            {"name": "Surging Sparks Elite Trainer Box", "type": "Elite Trainer Box", "language_code": "EN"},
            "pokemon",
            ours,
        )
        is None
    )


def test_product_types_and_similarity():
    assert product_type("Elite Trainer Box") == "etb"
    assert product_type("Booster Display Box") == "booster-box"
    assert product_type("Sleeved Booster Pack") == "booster-pack"
    assert product_type("3-Pack Blister") == "blister"
    assert similarity("Pokémon TCG: 151 Booster Bundle", "151 Booster Bundle") == 1.0
    assert similarity("a b", "") == 0.0


def _client(handler, max_requests=20):
    return ScrydexClient(
        "key",
        "team",
        user_agent="t",
        max_requests=max_requests,
        transport=httpx.MockTransport(handler),
        sleep=lambda s: None,
        min_interval=0,
    )


def test_client_pages_sends_both_headers_and_respects_the_budget():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        page = int(request.url.params["page"])
        data = [{"id": f"e{page}-{i}"} for i in range(100 if page == 1 else 3)]
        return httpx.Response(200, json={"data": data, "page": page, "pageSize": 100, "totalCount": 103})

    client = _client(handler)
    assert len(client.expansions("pokemon")) == 103
    assert all(r.headers["X-Api-Key"] == "key" and r.headers["X-Team-ID"] == "team" for r in seen)
    assert client.requests == 2
    with pytest.raises(BudgetExhausted):
        list(_client(handler, max_requests=1).expansions("pokemon"))


def test_client_errors_do_not_leak_the_key():
    client = _client(lambda r: httpx.Response(401, json={"error": "invalid"}))
    with pytest.raises(ScrydexError) as err:
        client.expansions("pokemon")
    assert err.value.status == 401 and "key" not in str(err.value).replace("pokemon", "")
