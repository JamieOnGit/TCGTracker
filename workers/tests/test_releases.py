"""Release calendar sources: Bandai's official Oceania product list and JB Hi-Fi street dates."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import httpx
import pytest

from tcgworkers.drops.adapters.jb_hi_fi import jb_release_date, parse_hits
from tcgworkers.jobs.releases import _clean_title, _lang_of, slugify
from tcgworkers.sources.releases.bandai import (
    BandaiClient,
    BandaiError,
    fetch_releases,
    parse_page,
    tidy_title,
)

PAGE = (Path(__file__).parent / "fixtures/bandai/op-products-page1.html").read_text(encoding="utf-8")


def test_bandai_page_gives_dated_oceania_releases_and_skips_premium_bandai() -> None:
    found = parse_page(PAGE)
    by_key = {r.key: r for r in found}
    op18 = by_key["bandai:op18"]
    assert op18.title == "Booster Pack: The Dominance of God (OP-18)"
    assert op18.code == "OP-18" and op18.is_set and op18.release_date == date(2026, 11, 20)
    assert op18.url == "https://en.onepiece-cardgame.com/products/op18.html"
    assert by_key["bandai:eb05"].title == "Extra Booster: One Piece Heroines Edition vol.2 (EB-05)"
    assert not by_key["bandai:gift-collection"].is_set  # "OTHERS", not a set
    # Premium Bandai (US web store, "Delivery Month") and undated items are not Australian releases.
    assert all("collection-drama" not in r.url and "card_collection_asl" not in r.url for r in found)
    assert all(r.release_date for r in found)


@pytest.mark.parametrize(
    ("raw", "title", "code", "ptype"),
    [
        ("STARTER DECK -Egghead- [ST-22]", "Starter Deck: Egghead (ST-22)", "ST-22", "starter-deck"),
        (
            "PREMIUM BOOSTER -ONE PIECE CARD THE BEST vol.2- [PRB-02]",
            "Premium Booster: One Piece Card the Best vol.2 (PRB-02)",
            "PRB-02",
            "premium-booster",
        ),
        ("Double Pack Set vol.9 [DP-09]", "Double Pack Set vol.9 (DP-09)", "DP-09", None),
        ("ONE PIECE CARD GAME 3rd Anniversary Set", "One Piece Card Game 3rd Anniversary Set", None, None),
    ],
)
def test_bandai_titles_are_tidied(raw: str, title: str, code: str | None, ptype: str | None) -> None:
    assert tidy_title(raw) == (title, code, ptype)


def test_fetch_stops_once_pages_are_older_than_the_window() -> None:
    old = PAGE.replace("2026-", "2020-")
    pages = {1: PAGE, 2: old, 3: PAGE}
    seen: list[str] = []
    slept: list[float] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(str(req.url))
        assert req.headers["User-Agent"].startswith("TCGTrackerBot/")
        return httpx.Response(200, text=pages[int(req.url.params["page"])])

    client = BandaiClient(
        user_agent="TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/)",
        transport=httpx.MockTransport(handler),
        sleep=slept.append,
    )
    found = fetch_releases(client, since=date(2026, 9, 1))
    assert len(seen) == 2 and slept == [5.0]  # page 2 is all old: page 3 is never fetched
    assert found and all(r.release_date >= date(2026, 9, 1) for r in found)


def test_bandai_errors_are_raised_for_the_job_to_record() -> None:
    client = BandaiClient(
        user_agent="ua", transport=httpx.MockTransport(lambda r: httpx.Response(503)), sleep=lambda s: None
    )
    with pytest.raises(BandaiError):
        fetch_releases(client, since=date(2026, 1, 1))


def test_jb_release_dates_are_australian_calendar_days() -> None:
    # Midnight Sydney (AEDT, UTC+11) is 13:00 the previous day in UTC.
    assert jb_release_date(1793883600) == date(2026, 11, 6)
    assert jb_release_date(1785420000) == date(2026, 7, 31)  # AEST, UTC+10
    assert jb_release_date("2023/06/16") == date(2023, 6, 16)
    assert jb_release_date("2023-09-22") == date(2023, 9, 22)
    assert jb_release_date(None) is None and jb_release_date(0) is None and jb_release_date("soon") is None


def test_jb_hits_carry_the_release_date() -> None:
    from datetime import UTC, datetime

    obs = parse_hits(
        {
            "hits": [
                {
                    "sku": "1",
                    "handle": "x",
                    "title": "Pokemon TCG: Mini Portfolio",
                    "price": 9,
                    "release_date": 1793883600,
                }
            ]
        },
        observed_at=datetime.now(UTC),
    )
    assert obs[0].release_date == date(2026, 11, 6)


def test_retailer_titles_and_languages() -> None:
    assert _clean_title("Pokemon TCG: Mini Portfolio") == "Mini Portfolio"
    assert (
        _clean_title("Pokemon TCG - Mega Evolutions 4: Chaos Rising Display Box")
        == "Chaos Rising Display Box"
    )
    assert (
        _lang_of("Pokemon TCG Japanese Booster Box", None) == "jp"
        and _lang_of("Pokemon TCG Booster", None) == "en"
    )
    assert _lang_of("anything", "jp") == "jp"
    assert slugify("Booster Pack: The Dominance of God (OP-18)") == "booster-pack-the-dominance-of-god-op-18"


def test_accessories_are_left_off_and_keys_survive_trailing_slashes() -> None:
    item = (
        '<li class="linkListColBox"><a href="https://en.onepiece-cardgame.com/products/{slug}" class="x">'
        '<span class="linkListColCat">{cat}</span><h4 class="linkListColTitle">{title}</h4>'
        '<p class="linkListColDate"><span class="head">Release Date</span><time datetime="2026-08-28">x</time></p></a></li>'
    )
    page = "".join(
        item.format(slug=s, cat=c, title=t)
        for s, c, t in [
            ("op17/", "BOOSTERS", "BOOSTER PACK -THE WORLD'S STRONGEST WARRIORS- [OP-17]"),
            ("sleeve042.html", "OTHERS", "Official Card Sleeves 16"),
            ("playmat_x.html", "OTHERS", "Official Playmat - Flame-Flame Fruit"),
            ("storage008.html", "OTHERS", "Official Storage Box - Flame-Flame Fruit"),
            ("dp12.html", "OTHERS", "Double Pack Set Vol.12 [DP-12]"),
        ]
    )
    found = parse_page(page)
    assert [r.key for r in found] == ["bandai:op17", "bandai:dp12"]


# ------------------------------------------------- dates on store product pages
from tcgworkers.drops.release_dates import find_release_date, plain_text  # noqa: E402

TODAY = date(2026, 10, 4)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # Seen live on Australian stores, October 2026.
        (
            "Pokémon TCG: Mega Evolution - Delta Reign Booster Box (Releases 6 Nov 2026)",
            (date(2026, 11, 6), "day"),
        ),
        (
            "Pokémon TCG: 30th Celebration 5 Booster Tin (Assorted) (Releases Dec 2026)",
            (date(2026, 12, 1), "month"),
        ),
        ("Delta Reign releases November 6, 2026.", (date(2026, 11, 6), "day")),
        (
            "📦 Pre-Order Releases 6 November 2026 Shipping commences 2-5 business days",
            (date(2026, 11, 6), "day"),
        ),
        ("This is a pre-order item releasing 6 November 2026", (date(2026, 11, 6), "day")),
        ("Pre-order Product Release Date: 06-November-2026 A Legendary Storm", (date(2026, 11, 6), "day")),
        # Other common wordings; numeric dates are Australian (day first).
        ("Expected release: 30/10/2026", (date(2026, 10, 30), "day")),
        ("Street date 2026-10-30", (date(2026, 10, 30), "day")),
        ("Launches on October 30th, 2026", (date(2026, 10, 30), "day")),
        # Not release dates.
        ("Shipping commences 2-5 business days from release date", None),
        ("Published 6 November 2026", None),
        ("Release date: TBC", None),
        ("Releases 6 November 2031", None),  # too far ahead: a typo
    ],
)
def test_store_release_dates(text: str, expected: tuple[date, str] | None) -> None:
    assert find_release_date(text, today=TODAY) == expected


def test_description_text_skips_styles_and_the_title_wins() -> None:
    body = "<style>.x{content:'Releases 1 Jan 2026'}</style><p>Releases &amp; ships 3 Dec 2026</p>"
    assert "1 Jan" not in plain_text(body)
    assert find_release_date("Booster Box (Releases 6 Nov 2026)", "Releases 3 Dec 2026", today=TODAY) == (
        date(2026, 11, 6),
        "day",
    )


def test_shopify_and_woocommerce_listings_carry_the_store_release_date() -> None:
    from datetime import UTC, datetime

    from tcgworkers.drops.adapters.shopify import parse_product as shopify
    from tcgworkers.drops.adapters.woocommerce import parse_product as woo

    now = datetime(2026, 10, 4, tzinfo=UTC)
    s = shopify(
        {
            "id": 1,
            "handle": "delta-reign-etb",
            "title": "Pokémon TCG: Delta Reign Elite Trainer Box (Pre-Order)",
            "body_html": "<p>Delta Reign releases November 6, 2026.</p>",
            "tags": ["preorder"],
            "variants": [{"id": 9, "available": True, "price": "89.95"}],
        },
        retailer="pokesource",
        base_url="https://pokesource.com.au",
        collection="pokemon",
        observed_at=now,
    )
    assert s is not None and (s.release_date, s.release_date_precision) == (date(2026, 11, 6), "day")
    w = woo(
        {
            "id": 2,
            "name": "Delta Reign Booster Box",
            "permalink": "https://shop.example.com.au/p/2",
            "short_description": "<p>Release Date: 06-November-2026</p>",
            "is_in_stock": True,
            "is_purchasable": True,
        },
        retailer="example",
        category="pokemon",
        observed_at=now,
    )
    assert w is not None and w.release_date == date(2026, 11, 6)
