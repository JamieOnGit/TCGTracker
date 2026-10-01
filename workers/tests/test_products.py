"""Product matcher: retail titles from Australian Shopify / WooCommerce stores
-> (game, lang, set, product type) -> a sealed_products slug. Deterministic;
anything unsure stays unmatched."""

from __future__ import annotations

from decimal import Decimal

import pytest

from tcgworkers.drops.products import Catalogue, CatalogueSet, analyse, detect_lang, match_title, slugify

CAT = Catalogue.build(
    [
        # DB rows win over the built-in list and carry their sets.id
        CatalogueSet("pokemon", "en", "sv3pt5", "151", None, "11111111-1111-1111-1111-111111111111"),
        CatalogueSet("one-piece", "jp", "OP05", "新時代の主役", None, "22222222-2222-2222-2222-222222222222"),
        CatalogueSet(
            "one-piece", "en", "OP13", "Carrying On His Will", None, "33333333-3333-3333-3333-333333333333"
        ),
    ]
)

# (title, expected slug or None, lang)
TABLE: list[tuple[str, str | None, str | None]] = [
    # Real Toys"R"Us AU titles (2026-10-01): new sets after the series name must not
    # be filed under the series' base set "Mega Evolution".
    ("Pokémon TCG Mega Evolutions Chaos Rising Booster Box", "chaos-rising-booster-box", "en"),
    ("Pokemon TCG Mega Evolutions Perfect Order Booster", "perfect-order-booster-pack", "en"),
    ("Pokemon TCG Mega Evolutions 3 Perfect Order Checklane Blister", "perfect-order-blister", "en"),
    ("Pokemon TCG Mega Evolutions Pitch Black Booster - 36pks - Box Set", "pitch-black-booster-box", "en"),
    ("Pokemon TCG Mega Evolutions Pitch Black Booster Bundle", "pitch-black-booster-bundle", "en"),
    ("Pokemon TCG Mega Evolution Booster Box", "mega-evolution-booster-box", "en"),
    ("Pokémon TCG Mega Evolutions Chaos Rising Three Booster Blister", "chaos-rising-3-pack-blister", "en"),
    ("Pokemon TCG Mega Evolutions Chaos Rising Checklane Blister", "chaos-rising-blister", "en"),
    # --- Pokémon EN
    ("Pokemon TCG: Scarlet & Violet 151 Ultra Premium Collection", "151-ultra-premium-collection", "en"),
    ("Pokemon Prismatic Evolutions ETB", "prismatic-evolutions-elite-trainer-box", "en"),
    ("Pokémon TCG: Prismatic Evolutions Elite Trainer Box", "prismatic-evolutions-elite-trainer-box", "en"),
    ("[Sealed] Pokemon TCG Prismatic Evolutions Booster Bundle", "prismatic-evolutions-booster-bundle", "en"),
    ("Pokemon TCG Scarlet & Violet Surging Sparks Booster Box", "surging-sparks-booster-box", "en"),
    (
        "Pokémon TCG: Scarlet & Violet—Surging Sparks Booster Display (36 Packs)",
        "surging-sparks-booster-box",
        "en",
    ),
    ("Pokémon TCG: Surging Sparks Sleeved Booster", "surging-sparks-booster-pack", "en"),
    ("Pokemon TCG Stellar Crown 3 Pack Blister", "stellar-crown-3-pack-blister", "en"),
    ("Pokemon TCG Stellar Crown Checklane Blister", "stellar-crown-blister", "en"),
    ("Stellar Crown Mini Tin", "stellar-crown-mini-tin", "en"),
    ("Pokemon TCG Paldean Fates Tin", "paldean-fates-tin", "en"),
    (
        "Pokemon TCG Mega Evolution Phantasmal Flames Elite Trainer Box",
        "phantasmal-flames-elite-trainer-box",
        "en",
    ),
    ("Pokémon TCG: Mega Evolution Booster Bundle", "mega-evolution-booster-bundle", "en"),
    (
        "Pokemon TCG Destined Rivals Pokemon Center Elite Trainer Box",
        "destined-rivals-pokemon-center-elite-trainer-box",
        "en",
    ),
    ("Pokemon TCG Journey Together Build & Battle Box", "journey-together-build-battle-box", "en"),
    ("Pokemon TCG Silver Tempest Build and Battle Stadium", "silver-tempest-build-battle-stadium", "en"),
    ("Pokémon TCG: Crown Zenith Premium Collection – Shiny Zacian", "crown-zenith-premium-collection", "en"),
    (
        "Pokemon Prismatic Evolutions Super Premium Collection",
        "prismatic-evolutions-super-premium-collection",
        "en",
    ),
    ("Pokemon TCG Scarlet & Violet Booster Box", "scarlet-violet-booster-box", "en"),
    ("POKÉMON TCG Sword and Shield 11 – Lost Origin Booster Bundle", "lost-origin-booster-bundle", "en"),
    ("Pokemon TCG Evolving Skies Booster Pack", "evolving-skies-booster-pack", "en"),
    ("Pokémon TCG: Black Bolt Elite Trainer Box", "black-bolt-elite-trainer-box", "en"),
    ("Pokemon TCG White Flare Binder Collection", "white-flare-collection", "en"),
    ("Pokémon TCG Crown Zenith Pikachu VMAX Box", "crown-zenith-collection", "en"),
    ("Pokémon TCG 151 Poster Collection", "151-collection", "en"),
    # --- Pokémon JP
    ("[Single Pack] Pokémon TCG - M5 - Abyss Eye - JP", "abyss-eye-booster-pack", "jp"),
    ("Pokemon 151 Japanese Booster Box", "pokemon-card-151-booster-box", "jp"),
    ("Pokemon TCG Triple Beat Booster Box Japanese (sv1a)", "triplet-beat-booster-box", "jp"),
    (
        "Pokemon Card Game Terastal Festival ex Booster Box (Japanese)",
        "terastal-festival-ex-booster-box",
        "jp",
    ),
    ("Pokémon Japanese Mega Brave M1L Booster Box", "mega-brave-booster-box", "jp"),
    (
        "Pokemon Card Game SV8a Terastal Festival ex - JP Booster Pack",
        "terastal-festival-ex-booster-pack",
        "jp",
    ),
    ("Pokemon Japan Battle Partners Booster Box sv9", "battle-partners-booster-box", "jp"),
    # --- One Piece
    (
        "One Piece Card Game OP-09 Emperors in the New World Booster Box",
        "op-09-emperors-in-the-new-world-booster-box",
        "en",
    ),
    ("ONE PIECE CARD GAME OP09 Booster Box", "op-09-emperors-in-the-new-world-booster-box", "en"),
    ("One Piece TCG: Two Legends [OP-08] Booster Pack", "op-08-two-legends-booster-pack", "en"),
    (
        "One Piece Card Game - Awakening of the New Era - Booster Box (Japanese)",
        "op-05-awakening-of-the-new-era-booster-box",
        "jp",
    ),
    (
        "One Piece Card Game Extra Booster Anime 25th Collection EB-02 Booster Box",
        "eb-02-anime-25th-collection-booster-box",
        "en",
    ),
    (
        "One Piece Card Game Premium Booster -ONE PIECE CARD THE BEST- [PRB-01] Booster Box",
        "prb-01-one-piece-card-the-best-booster-box",
        "en",
    ),
    (
        "ONE PIECE CARD GAME PREMIUM BOOSTER THE BEST VOL.2 PRB-02 BOX",
        "prb-02-one-piece-card-the-best-vol-2-collection",
        "en",
    ),
    (
        "One Piece Card Game OP-13 Carrying On His Will Booster Box",
        "op-13-carrying-on-his-will-booster-box",
        "en",
    ),
    ("One Piece Card Game Royal Blood OP-10 Double Pack Set Vol.7", "op-10-royal-blood-double-pack", "en"),
    # --- unmatched on purpose
    ("Sleeved booster", None, "en"),  # no set
    ("ONE PIECE CARD GAME PREMIUM BOOSTER PRB-02", None, "en"),  # box or pack? don't guess
    ("Pokémon TCG Charizard ex Premium Collection", None, "en"),  # no set
    ("Pokemon TCG Prismatic Evolutions", None, "en"),  # no product type
    ("Pokemon Stellar Crown Booster Box Case (6)", None, "en"),  # a case of several boxes
    ("Pokemon TCG Surging Sparks ETB x 6", None, "en"),
    ("Pokemon Korean 151 Booster Box", None, None),  # language we don't list
    ("Pokemon Simplified Chinese Gem Pack Vol 1", None, None),
    ("One Piece Card Game OP-09 Booster Box Pokemon Bundle", None, "en"),  # games disagree
    ("Pokemon TCG Scarlet & Violet Paldea Evolved Obsidian Flames Bundle", None, "en"),  # two sets
]


@pytest.mark.parametrize(("title", "slug", "lang"), TABLE)
def test_matcher_table(title: str, slug: str | None, lang: str | None) -> None:
    a = analyse(title, CAT)
    assert (a.match.slug if a.match else None) == slug, a.reason
    assert a.lang == lang


def test_table_is_big_enough() -> None:
    assert len(TABLE) >= 40


def test_db_sets_supply_ids_and_jp_one_piece_names_fall_back_to_english() -> None:
    m = match_title("Pokemon TCG: Scarlet & Violet 151 Elite Trainer Box", CAT)
    assert m and m.set.id == "11111111-1111-1111-1111-111111111111" and m.name == "151 Elite Trainer Box"
    jp = match_title("ONE PIECE CARD GAME OP-05 Booster Box Japanese", CAT)
    assert jp and jp.lang == "jp" and jp.set.id == "22222222-2222-2222-2222-222222222222"
    assert jp.name == "OP-05 Awakening of the New Era Booster Box"  # the JP set's name is in Japanese
    builtin = match_title("Pokemon Prismatic Evolutions ETB", CAT)
    assert builtin and builtin.set.id is None and builtin.rrp_type == "elite-trainer-box"


def test_names_slugs_and_confidence() -> None:
    m = match_title("Pokemon TCG: Scarlet & Violet 151 Ultra Premium Collection", CAT)
    assert (
        m
        and m.name == "151 Ultra-Premium Collection"
        and m.game == "pokemon"
        and m.product_type == "ultra-premium-collection"
    )
    by_code = match_title("One Piece Card Game OP-09 Emperors in the New World Booster Box", CAT)
    generic = match_title("Pokémon TCG Crown Zenith Pikachu VMAX Box", CAT)
    assert by_code and generic and by_code.confidence > generic.confidence >= Decimal("0.7")
    assert by_code.confidence <= Decimal("0.99")


def test_store_hints() -> None:
    assert match_title("Abyss Eye Booster Box", CAT) is None  # no language marker, no game
    jp = match_title("Abyss Eye Booster Box", CAT, game_hint="pokemon", lang_hint="jp")
    assert jp and jp.lang == "jp"
    assert detect_lang("Booster Box", "jp") == "jp" and detect_lang("Booster Box JP", "en") == "jp"


def test_deterministic() -> None:
    title = "Pokémon TCG: Scarlet & Violet—Surging Sparks Booster Display (36 Packs)"
    assert {match_title(title, CAT) for _ in range(5)} == {match_title(title, CAT)}


def test_slugify_matches_the_sql_function() -> None:
    assert slugify("Pokémon Card 151 Booster Box") == "pokemon-card-151-booster-box"
    assert slugify("Champion's Path Build & Battle Box") == "champions-path-build-battle-box"
    assert (
        slugify("PRB-02 One Piece Card The Best Vol. 2 Booster Box")
        == "prb-02-one-piece-card-the-best-vol-2-booster-box"
    )


def test_a_bare_booster_at_booster_box_prices_is_a_booster_box() -> None:
    from decimal import Decimal

    title = "Pokemon TCG Mega Evolutions Perfect Order Booster"
    box = analyse(title, CAT, price_aud=Decimal("314.99")).match
    pack = analyse(title, CAT, price_aud=Decimal("7.99")).match
    assert box is not None and box.slug == "perfect-order-booster-box"
    assert pack is not None and pack.slug == "perfect-order-booster-pack"
