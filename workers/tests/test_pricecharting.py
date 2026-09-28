from __future__ import annotations

import json
from decimal import Decimal

import httpx
import pytest

from tcgworkers.sources.pricing.pricecharting import (
    PRICE_FIELDS,
    PriceChartingClient,
    PriceChartingError,
    PriceChartingSource,
    licence,
    parse_console,
    parse_csv,
    parse_product_name,
    product_from_api,
)

TOKEN = "c0b53bce27c1bdab90b1605249e600dc43dfd1d5"  # the public demo token from the docs


@pytest.mark.parametrize(
    ("console", "expected"),
    [
        ("Pokemon Scarlet & Violet 151", ("pokemon", "en", "Scarlet & Violet 151")),
        ("Pokemon Japanese Scarlet & Violet 151", ("pokemon", "jp", "Scarlet & Violet 151")),
        ("Pokemon Japanese Eevee Heroes", ("pokemon", "jp", "Eevee Heroes")),
        ("Pokemon Promo", ("pokemon", "en", "Promo")),
        ("One Piece Awakening of the New Era", ("one-piece", "en", "Awakening of the New Era")),
        ("One Piece Japanese Awakening of the New Era", ("one-piece", "jp", "Awakening of the New Era")),
        ("One Piece Extra Booster EB04", ("one-piece", "en", "Extra Booster EB04")),
    ],
)
def test_console_names(console, expected):
    c = parse_console(console)
    assert not c.excluded and (c.game, c.lang, c.set_name) == expected


@pytest.mark.parametrize(
    "console",
    [
        "Pokemon Chinese Gem Pack",
        "Pokemon Korean Terastal",
        "One Piece Carddass Hyper Battle",
        "One Piece Japanese Carddass Part 1",
        "Super Nintendo",
        "Pokemon Japanese ",
    ],
)
def test_excluded_consoles(console):
    assert parse_console(console).excluded


@pytest.mark.parametrize(
    ("product", "expected"),
    [
        ("Charizard ex #199", ("Charizard ex", "199", "standard")),
        ("Monkey.D.Luffy [Alternate Art Manga] #OP05-119", ("Monkey.D.Luffy", "OP05-119", "manga-alt-art")),
        ("Shanks [Manga Alternate Art] #OP01-120", ("Shanks", "OP01-120", "manga-alt-art")),
        ("Roronoa Zoro [Alternate Art] #op06-118", ("Roronoa Zoro", "OP06-118", "alt-art")),
        ("Goldroger [Manga] #OP09-118", ("Goldroger", "OP09-118", "manga")),
        ("Umbreon VMAX #215", ("Umbreon VMAX", "215", "standard")),
        ("Charizard [1st Edition] #4", ("Charizard", "4", "1st-edition")),
        ("Pikachu [Reverse Holo] #25", ("Pikachu", "25", "reverse-holo")),
        ("Evolving Skies Booster Box", ("Evolving Skies Booster Box", None, "standard")),
    ],
)
def test_product_names(product, expected):
    p = parse_product_name(product)
    assert (p.name, p.number, p.variant) == expected


def test_grade_mapping_is_grader_agnostic_below_10():
    assert PRICE_FIELDS["manual-only-price"] == ("PSA", Decimal("10"))
    assert PRICE_FIELDS["graded-price"] == ("ANY", Decimal("9"))  # PSA *or* BGS 9 -> any-9, never psa-9
    assert PRICE_FIELDS["box-only-price"] == ("ANY", Decimal("9.5"))
    assert PRICE_FIELDS["new-price"] == ("ANY", Decimal("8"))
    assert PRICE_FIELDS["cib-price"] == ("ANY", Decimal("7"))
    assert PRICE_FIELDS["bgs-10-price"] == ("BGS", Decimal("10"))
    assert PRICE_FIELDS["condition-17-price"] == ("CGC", Decimal("10"))
    assert PRICE_FIELDS["condition-18-price"] == ("SGC", Decimal("10"))
    assert PRICE_FIELDS["loose-price"] == (None, None)


def test_csv_parses_by_column_name_into_cents(fixtures):
    rows = {
        p.id: p for p in parse_csv((fixtures / "pricecharting/price-guide-pokemon-cards.csv").read_text())
    }
    charizard = rows["5809582"]
    assert charizard.console_name == "Pokemon Scarlet & Violet 151"
    assert charizard.prices["manual-only-price"] == 123400  # "$1,234.00"
    assert charizard.prices["loose-price"] == 10000
    assert charizard.tcg_id == "517045" and charizard.release_date == "2023-09-22"
    assert "cib-price" not in rows["5326231"].prices  # empty cell = no price


def test_csv_with_reordered_columns_still_parses():
    text = "product-name,id,console-name,manual-only-price\nCharizard ex #199,5809582,Pokemon Scarlet & Violet 151,12.34\n"
    (p,) = parse_csv(text)
    assert p.id == "5809582" and p.prices == {"manual-only-price": 1234}


def test_not_a_csv_is_rejected():
    with pytest.raises(ValueError):
        list(parse_csv("<html><body>Please log in</body></html>"))


def test_api_product_uses_integer_cents_and_skips_zero(fixtures):
    p = product_from_api(json.loads((fixtures / "pricecharting/api-product-6235917.json").read_text()))
    assert p is not None
    assert p.prices["manual-only-price"] == 125000 and p.prices["loose-price"] == 31000
    assert "cib-price" not in p.prices and "box-only-price" not in p.prices


def _client(handler, clock=None, sleeps=None):
    t = [0.0]
    sleeps = sleeps if sleeps is not None else []

    def sleep(s):
        sleeps.append(s)
        t[0] += s

    return PriceChartingClient(
        TOKEN, transport=httpx.MockTransport(handler), clock=clock or (lambda: t[0]), sleep=sleep
    ), sleeps


def test_api_calls_are_spaced_one_second_apart(fixtures):
    body = (fixtures / "pricecharting/api-product-6235917.json").read_text()
    seen = []

    def handler(request):
        seen.append(request.url)
        return httpx.Response(200, text=body)

    client, sleeps = _client(handler)
    client.product("6235917")
    client.product("6235917")
    assert sleeps == [1.0] and client.api_calls == 2
    assert seen[0].params["t"] == TOKEN and seen[0].params["id"] == "6235917"


def test_csv_downloads_are_ten_minutes_apart(fixtures):
    csv_text = (fixtures / "pricecharting/price-guide-pokemon-cards.csv").read_text()
    urls = []

    def handler(request):
        urls.append(request.url)
        return httpx.Response(200, text=csv_text)

    client, sleeps = _client(handler)
    source = PriceChartingSource(client)
    assert len(list(source.products())) == 10
    assert sleeps == [600.0]
    assert [u.params["category"] for u in urls] == ["pokemon-cards", "one-piece-cards"]


def test_errors_never_leak_the_token():
    client, _ = _client(lambda r: httpx.Response(403, text=f"bad token {TOKEN}"))
    with pytest.raises(PriceChartingError) as info:
        client.download_csv("pokemon-cards")
    assert TOKEN not in str(info.value) and info.value.status == 403


def test_html_instead_of_csv_is_an_error():
    client, _ = _client(lambda r: httpx.Response(200, text="<html>Subscribe</html>"))
    with pytest.raises(PriceChartingError, match="PRICECHARTING_CSV_URL_TEMPLATE"):
        client.download_csv("pokemon-cards")


def test_api_error_status_raises():
    client, _ = _client(lambda r: httpx.Response(200, json={"status": "error", "error-message": "nope"}))
    with pytest.raises(PriceChartingError):
        client.product("1")


def test_source_yields_external_prices_per_grade(fixtures):
    texts = {
        "pokemon-cards": (fixtures / "pricecharting/price-guide-pokemon-cards.csv").read_text(),
        "one-piece-cards": (fixtures / "pricecharting/price-guide-one-piece-cards.csv").read_text(),
    }
    client, _ = _client(lambda r: httpx.Response(200, text=texts[r.url.params["category"]]))
    prices = list(PriceChartingSource(client).fetch())
    luffy = [p for p in prices if p.external_id == "6235917"]
    assert {(p.grader, p.grade) for p in luffy} == {
        (None, None),
        ("ANY", Decimal("8")),
        ("ANY", Decimal("9")),
        ("PSA", Decimal("10")),
        ("CGC", Decimal("10")),
    }
    assert all(p.currency == "USD" and p.lang == "en" and p.game == "one-piece" for p in luffy)
    assert not [p for p in prices if p.external_id in ("9000002", "9000003")]  # excluded consoles


def test_licence_display_flag_defaults_off():
    assert licence({}).display is False and licence({}).redistribute is False
    assert licence({"PRICECHARTING_DISPLAY_OK": "true"}).display is True
