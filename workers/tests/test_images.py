"""Scrydex image matching (no database, no network)."""

from __future__ import annotations

import httpx
import pytest

from tcgworkers.jobs.images import (
    AUTO_SOURCES,
    Candidate,
    OurCard,
    OurSealed,
    alt_prints,
    art_key,
    match_card,
    match_sealed,
    number_key,
    op_print_for,
    pick,
    printed_total,
    product_type,
    recognises,
    similarity,
    wants,
)
from tcgworkers.matching.matcher import normalise_number
from tcgworkers.sources.images.http import ImageChecker, OutOfBudget, SourceError
from tcgworkers.sources.images.optcg import bandai_image, parse_print
from tcgworkers.sources.images.pokemontcg import PokemonTcgClient, query_for
from tcgworkers.sources.images.scrydex import (
    BudgetExhausted,
    ScrydexClient,
    ScrydexError,
    front_image,
    lang_of,
)
from tcgworkers.sources.images.tcgdex import set_of


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


# ------------------------------------------------------- free-source matching
def _card(
    number, name="Charizard", set_name="Base Set", *, lang="en", variant="standard", total="", src=None
):
    return OurCard(
        "x", lang, number, name, variant, set_name, True, "jt-x", src is not None, "pokemon", src, total
    )


def _cand(ref, set_name, total, *codes):
    return Candidate(f"https://img/{ref}", ref, set_name, codes, total)


def test_printed_totals_and_promo_numbers():
    assert printed_total(_card("199/165")) == 165
    assert printed_total(_card("SV107/SV122")) == 122
    assert printed_total(_card("199", total="165")) == 165
    assert printed_total(_card("SWSH050")) is None
    assert number_key("SVP 085") == number_key("085") == "85"
    assert number_key("SV107/SV122") == "SV107" and number_key("TG01") == "TG1"


def test_pick_uses_set_size_and_set_and_never_guesses():
    base, base2, cc = (
        _cand("base1-4", "Base", 102, "base1", "BS"),
        _cand("base4-4", "Base Set 2", 130, "base4"),
        _cand("cel25c-4_A", "Celebrations: Classic Collection", 25, "cel25c"),
    )
    # A different printed set size rules a reprint out.
    assert pick(_card("4/102"), [base, base2, cc], names_checked=True) is base
    assert pick(_card("4/130", set_name="Base Set 2"), [base, base2, cc], names_checked=True) is base2
    # ...except in the card's own set: classic-collection reprints keep their original number.
    assert (
        pick(
            _card("4/102", set_name="Celebrations: Classic Collection"), [base, base2, cc], names_checked=True
        )
        is cc
    )
    # Two equally good images: no guess.
    assert pick(_card("4"), [base, base2], names_checked=True) is None
    # Only one candidate, no evidence against it: taken when the name was checked...
    assert (
        pick(_card("SWSH050", set_name="SWSH: Sword & Shield Promo Cards"), [base], names_checked=True)
        is base
    )
    # ...but a Japanese card (names not comparable) needs its set or set size to agree.
    assert pick(_card("4", lang="jp", set_name="Other"), [base], names_checked=False) is None
    assert pick(_card("4/102", lang="jp", set_name="Other"), [base], names_checked=False) is base


def test_a_card_missing_from_its_own_set_is_never_taken_from_another():
    mcd = _cand("mcd21-25", "McDonald's Collection 2021", 25, "mcd21")
    card = _card("025/025", "Pikachu", "Celebrations")
    sets = [("Celebrations", ("cel25",)), ("McDonald's Collection 2021", ("mcd21",))]
    assert recognises(card, sets)
    assert pick(card, [mcd], names_checked=True, recognised=True) is None
    # A set the source doesn't have: other evidence may decide.
    assert pick(card, [mcd], names_checked=True, recognised=False) is mcd


def test_a_series_prefix_is_not_a_set_code():
    supreme_victors = ("Supreme Victors", ("pl3", "SV"))
    assert not recognises(_card("161/131", "Umbreon ex", "SV: Prismatic Evolutions"), [supreme_victors])
    assert recognises(_card("201/165", set_name="SV2a: Pokemon Card 151"), [("x", ("SV2a",))])
    assert recognises(_card("1", set_name="SWSH12: Silver Tempest"), [("x", ("swsh12",))])


def test_promo_sets_are_recognised_by_series():
    card = _card("SWSH050", "Charizard V", "SWSH: Sword & Shield Promo Cards")
    promo = _cand("swshp-SWSH050", "SWSH Black Star Promos", None, "swshp")
    assert recognises(card, [("SWSH Black Star Promos", ("swshp",))])
    assert pick(card, [promo], names_checked=True, recognised=True) is promo


def test_source_priority():
    assert AUTO_SOURCES.index("tcgdex") < AUTO_SOURCES.index("tcgplayer") < AUTO_SOURCES.index("retailer")
    assert wants(_card("1"), "tcgplayer")  # no image yet
    assert wants(_card("1", src="tcgplayer:1"), "tcgdex")  # an open image beats TCGplayer's
    assert not wants(_card("1", src="tcgdex:x"), "tcgplayer")
    assert not wants(_card("1", src="tcgdex:x"), "tcgdex")  # never re-fetched
    assert not wants(_card("1", src="manual"), "scrydex")  # hand-set: never touched


ROWS = [
    {
        "card_name": "Monkey.D.Luffy (119)",
        "card_set_id": "OP05-119",
        "card_image_id": "OP05-119",
        "set_name": "Awakening of the New Era",
        "set_id": "OP-05",
        "card_image": "https://optcgapi.com/a.jpg",
    },
    {
        "card_name": "Monkey.D.Luffy (119) (Alternate Art)",
        "card_set_id": "OP05-119",
        "card_image_id": "OP05-119_p1",
        "set_name": "Awakening of the New Era",
        "set_id": "OP-05",
    },
    {
        "card_name": "Monkey.D.Luffy (119) (Alternate Art) (Manga)",
        "card_set_id": "OP05-119",
        "card_image_id": "OP05-119_p2",
        "set_name": "Awakening of the New Era",
        "set_id": "OP-05",
    },
    {
        "card_name": "Monkey.D.Luffy (OP05-119) (Reprint)",
        "card_set_id": "OP05-119",
        "card_image_id": "OP05-119_r1",
        "set_name": "Premium Booster -The Best-",
        "set_id": "PRB-01",
    },
    {
        "card_name": "Monkey.D.Luffy (OP05-119) (Manga)",
        "card_set_id": "OP05-119",
        "card_image_id": "OP05-119_r2",
        "set_name": "Premium Booster -The Best-",
        "set_id": "PRB-01",
    },
    {
        "card_name": "Monkey.D.Luffy - OP05-119 (SP)",
        "card_set_id": "OP05-119",
        "card_image_id": "OP05-119_p9",
        "set_name": "Premium Booster -The Best- Vol. 2",
        "set_id": "PRB-02",
    },
]


def test_one_piece_prints_parse_like_justtcg_names():
    prints = [parse_print(r) for r in ROWS]
    assert [(p.name, p.variant, p.set_code) for p in prints if p] == [
        ("Monkey.D.Luffy", "standard", "OP05"),
        ("Monkey.D.Luffy", "alt-art", "OP05"),
        ("Monkey.D.Luffy", "manga-alt-art", "OP05"),
        ("Monkey.D.Luffy", "standard", "PRB01"),
        ("Monkey.D.Luffy", "manga", "PRB01"),
        ("Monkey.D.Luffy", "sp", "PRB02"),
    ]
    assert parse_print({"card_set_id": "OP05-119", "card_image_id": "../x"}) is None
    assert (
        bandai_image("OP05-119_p1", "en")
        == "https://en.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png"
    )
    assert art_key("parallel") == art_key("alt-art") == "alt"
    assert art_key("manga-alt-art") == art_key("manga") == "manga"
    assert art_key("sp-gold") == "gold-sp" and art_key("standard") == "standard"


def test_one_piece_cards_take_the_print_from_their_own_set():
    prints = [p for p in (parse_print(r) for r in ROWS) if p]

    def op(variant, set_name="Awakening of the New Era"):
        c = OurCard(
            "x", "en", "OP05-119", "Monkey.D.Luffy", variant, set_name, True, "jt-x", game="one-piece"
        )
        p = op_print_for(c, prints)
        return p.image_id if p else None

    assert op("standard") == "OP05-119"
    assert op("parallel") == "OP05-119_p1"
    assert op("manga") == op("manga-alt-art") == "OP05-119_p2"  # not the Premium Booster manga reprint
    assert op("manga", "Premium Booster -The Best-") == "OP05-119_r2"
    assert op("standard", "Premium Booster -The Best-") == "OP05-119_r1"
    assert op("sp", "Premium Booster -The Best- Vol. 2") == "OP05-119_p9"
    assert op("sp") is None  # no SP print in its own set: left alone
    # A set none of the prints come from: the base art, or the only print of that kind.
    assert op("standard", "Some Promo Box") == "OP05-119"
    assert op("sp", "Some Promo Box") == "OP05-119_p9"
    assert op("alt-art", "Some Promo Box") == "OP05-119_p1"


def test_tcgdex_cards_belong_to_their_set():
    sets = {"sv03.5", "tk-xy-sy", "swsh12tg"}
    assert set_of("sv03.5-199", "199", sets) == "sv03.5"
    assert set_of("tk-xy-sy-1", "1", sets) == "tk-xy-sy"
    assert set_of("swsh12tg-TG30", "TG30", sets) == "swsh12tg"
    assert set_of("A2b-199", "199", sets) is None  # TCG Pocket: not a listed set


def test_pokemontcg_queries_batch_cards_and_retry_server_errors():
    q = query_for([("Charizard VMAX", ["SV107"]), ('Bad "name"', ["004", "4"])])
    assert q == '(name:"Charizard VMAX" (number:"SV107")) OR (name:"Bad name" (number:"004" OR number:"4"))'
    answers = iter([500, 502, 200])
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        code = next(answers)
        return httpx.Response(code, json={"data": [{"id": "a"}], "totalCount": 1} if code == 200 else {})

    client = PokemonTcgClient(
        user_agent="t",
        max_requests=5,
        transport=httpx.MockTransport(handler),
        sleep=sleeps.append,
        min_interval=0,
    )
    assert client.search("x") == [{"id": "a"}] and client.requests == 3 and sleeps == [2, 4]
    with pytest.raises(OutOfBudget):
        PokemonTcgClient(user_agent="t", max_requests=0).search("x")
    down = PokemonTcgClient(
        user_agent="t",
        max_requests=9,
        transport=httpx.MockTransport(lambda r: httpx.Response(503)),
        sleep=lambda s: None,
        min_interval=0,
        retries=2,
    )
    with pytest.raises(SourceError):
        down.search("x")
    assert down.requests == 3


def test_image_checks_need_an_image_answer():
    def handler(request: httpx.Request) -> httpx.Response:
        if "html" in request.url.path:
            return httpx.Response(200, headers={"content-type": "text/html"})
        if "gone" in request.url.path:
            return httpx.Response(403)
        return httpx.Response(200, headers={"content-type": "image/jpeg"})

    checker = ImageChecker(
        user_agent="t", max_requests=10, transport=httpx.MockTransport(handler), min_interval=0
    )
    assert checker.ok("https://x/a.jpg") and checker.ok("https://x/a.jpg")
    assert not checker.ok("https://x/html") and not checker.ok("https://x/gone.jpg")
    assert checker.requests == 3  # the repeat was remembered
