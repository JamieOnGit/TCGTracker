"""The images job against a migrated database (supabase/tests/run.sh leaves
one with 4 fixture cards and a sealed product). Skipped unless TEST_DATABASE_URL is set.

Every source is mocked (fixtures built from the real services' responses):
Scrydex, TCGdex, pokemontcg.io, optcgapi, and the image-address checks."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.config import Env
from tcgworkers.jobs.images import refresh_images
from tcgworkers.sources.images.http import ImageChecker
from tcgworkers.sources.images.optcg import OptcgClient
from tcgworkers.sources.images.pokemontcg import PokemonTcgClient
from tcgworkers.sources.images.scrydex import ScrydexClient
from tcgworkers.sources.images.tcgdex import TcgdexClient

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

EN_CHARIZARD = "20000000-0000-0000-0000-000000000001"
JP_CHARIZARD = "20000000-0000-0000-0000-000000000002"
EN_LUFFY = "20000000-0000-0000-0000-000000000003"  # the manga print
JP_LUFFY = "20000000-0000-0000-0000-000000000004"
ETB = "30000000-0000-0000-0000-000000000001"
NOW = datetime(2026, 10, 3, 6, 0, tzinfo=UTC)
NO_KEYS = Env.from_environ({})


def _reset(c):
    c.rollback()
    c.execute("update public.cards set image_url = null, image_source = null, tcgplayer_id = null")
    c.execute("update public.sealed_products set image_url = null, image_source = null")
    c.execute("delete from public.scrydex_expansions")
    c.execute("delete from public.pipeline_runs where job = 'images'")
    c.commit()


@pytest.fixture
def conn():
    with psycopg.connect(URL, row_factory=dict_row) as c:
        _reset(c)
        yield c
        _reset(c)


def _quiet(**kw):
    return {"sleep": lambda s: None, "min_interval": 0, **kw}


def _mock(fixtures):
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = (
            request.url.path
        )  # /pokemon/v1/expansions, /onepiece/v1/expansions/OP05/cards, /pokemon/v1/sealed
        calls.append(path)
        parts = path.strip("/").split("/")
        game = parts[0]
        if parts[1:] == ["v1", "cards"]:  # a one-card search: nothing found
            return httpx.Response(200, json={"data": [], "page": 1, "pageSize": 10, "totalCount": 0})
        if parts[-1] == "expansions":
            name = f"{game}-expansions.json"
        elif parts[-1] == "cards":
            name = f"{game}-cards-{parts[-2]}.json"
        else:
            name = f"{game}-sealed.json"
        return httpx.Response(200, text=(fixtures / "scrydex" / name).read_text())

    client = ScrydexClient(
        "k", "t", user_agent="test", max_requests=100, transport=httpx.MockTransport(handler), **_quiet()
    )
    return client, calls


def _tcgdex(fixtures, *, down=False):
    def handler(request: httpx.Request) -> httpx.Response:
        if down:
            return httpx.Response(503)
        parts = request.url.path.strip("/").split("/")  # v2/{lang}/sets | v2/{lang}/cards
        path = fixtures / "tcgdex" / f"{parts[1]}-{parts[2]}.json"
        return httpx.Response(200, text=path.read_text()) if path.exists() else httpx.Response(404)

    return TcgdexClient(
        user_agent="test", max_requests=50, transport=httpx.MockTransport(handler), **_quiet()
    )


def _pokemontcg(fixtures, *, cards=None, down=False):
    """pokemontcg.io: the set list, and ``cards`` (a fixture name) for every search."""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if down:
            return httpx.Response(500)
        if request.url.path == "/v2/sets":
            return httpx.Response(200, text=(fixtures / "pokemontcg" / "sets.json").read_text())
        if cards:
            return httpx.Response(200, text=(fixtures / "pokemontcg" / f"{cards}.json").read_text())
        return httpx.Response(200, json={"data": [], "page": 1, "pageSize": 250, "count": 0, "totalCount": 0})

    client = PokemonTcgClient(
        user_agent="test", max_requests=20, transport=httpx.MockTransport(handler), **_quiet(retries=1)
    )
    client.calls = calls  # type: ignore[attr-defined]
    return client


def _optcg(fixtures, *, empty=False):
    def handler(request: httpx.Request) -> httpx.Response:
        if empty:
            return httpx.Response(200, json=[])
        name = "allSetCards" if "allSetCards" in request.url.path else "allSTCards"
        return httpx.Response(200, text=(fixtures / "optcg" / f"{name}.json").read_text())

    return OptcgClient(user_agent="test", transport=httpx.MockTransport(handler), **_quiet())


def _checker(missing=()):
    """Every image address answers with an image, except those containing a ``missing`` string."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        assert request.method == "HEAD"
        if any(m in str(request.url) for m in missing):
            return httpx.Response(403, headers={"content-type": "application/xml"})
        return httpx.Response(200, headers={"content-type": "image/png"})

    checker = ImageChecker(
        user_agent="test", max_requests=50, transport=httpx.MockTransport(handler), **_quiet()
    )
    checker.urls = seen  # type: ignore[attr-defined]
    return checker


def _run(conn, fixtures, *, client=None, tcgdex=None, pokemontcg=None, optcg=None, checker=None, now=NOW):
    return refresh_images(
        conn,
        NO_KEYS,
        client=client,
        tcgdex=tcgdex or _tcgdex(fixtures),
        pokemontcg=pokemontcg or _pokemontcg(fixtures),
        optcg=optcg or _optcg(fixtures),
        checker=checker or _checker(),
        now=now,
    )


def _image(conn, table, id_):
    return conn.execute(
        f"select image_url, image_source from public.{table} where id = %s", (id_,)
    ).fetchone()


def test_a_run_fills_card_and_sealed_images(conn, fixtures):
    client, calls = _mock(fixtures)
    stats = _run(conn, fixtures, client=client)

    assert _image(conn, "cards", EN_CHARIZARD) == {
        "image_url": "https://images.scrydex.com/sv3pt5-199/large",
        "image_source": "scrydex:sv3pt5-199",
    }
    assert _image(conn, "cards", JP_CHARIZARD)["image_url"] == "https://images.scrydex.com/sv2a_ja-201/large"
    # The manga print takes the manga variant's image, never the base art.
    assert _image(conn, "cards", EN_LUFFY)["image_url"] == "https://images.scrydex.com/OP05-119-manga/large"
    assert _image(conn, "sealed_products", ETB) == {
        "image_url": "https://images.scrydex.com/sv-test-etb/large",
        "image_source": "scrydex:sv-test-etb",
    }
    assert stats["cards_updated"] == 3 and stats["sealed_updated"] == 1
    # Scrydex has no Japanese Luffy: Bandai's official Japanese image of the same print fills it.
    assert _image(conn, "cards", JP_LUFFY) == {
        "image_url": "https://www.onepiece-cardgame.com/images/cardlist/card/OP05-119_p2.png",
        "image_source": "bandai:OP05-119_p2",
    }
    # The Chinese expansion is never fetched.
    assert not any("zh1" in c for c in calls)
    assert {
        r["expansion_id"] for r in conn.execute("select expansion_id from public.scrydex_expansions")
    } == {"sv3pt5", "sv2a_ja", "OP05"}
    assert stats["coverage"]["cards"]["pct"] == 100.0 and stats["missing_cards"]["count"] == 0


def test_synced_expansions_are_skipped_until_due(conn, fixtures):
    client, _ = _mock(fixtures)
    _run(conn, fixtures, client=client)

    again, calls = _mock(fixtures)
    stats = _run(conn, fixtures, client=again, now=NOW + timedelta(days=1))
    # Expansions released over 90 days ago and synced yesterday: no card pages fetched.
    assert not any("/expansions/" in c and c.endswith("/cards") for c in calls)
    assert stats["expansions_synced"] == 0

    later, calls = _mock(fixtures)
    _run(conn, fixtures, client=later, now=NOW + timedelta(days=31))
    assert any(c.endswith("/cards") for c in calls)


def test_a_hand_set_image_is_never_overwritten(conn, fixtures):
    conn.execute(
        "update public.cards set image_url = 'https://cdn.example/mine.jpg', image_source = 'manual', tcgplayer_id = 517045 where id = %s",
        (EN_CHARIZARD,),
    )
    conn.commit()
    client, _ = _mock(fixtures)
    _run(conn, fixtures, client=client, pokemontcg=_pokemontcg(fixtures, cards="cards-charizard"))
    assert _image(conn, "cards", EN_CHARIZARD) == {
        "image_url": "https://cdn.example/mine.jpg",
        "image_source": "manual",
    }


def test_without_scrydex_the_free_sources_fill_every_card_and_sealed(conn, fixtures):
    """No Scrydex keys: TCGdex fills Pokémon cards (English by number + name +
    set, Japanese by number + set code / set size), Bandai's official images
    fill One Piece prints (found via optcgapi), a sealed product takes its own
    store listing's photo, and the run reports coverage."""
    conn.execute(
        "update public.retail_products set image_url = 'https://img.jbhifi.example/etb.jpg' where id = 3"
    )
    conn.commit()
    try:
        checker = _checker()
        pokemontcg = _pokemontcg(fixtures)
        stats = _run(conn, fixtures, pokemontcg=pokemontcg, checker=checker)
        assert stats["scrydex"].startswith("skipped")
        # Not 'Ninetales' sv03-199, not the TCG Pocket 'Charizard ex' A2b-199.
        assert _image(conn, "cards", EN_CHARIZARD) == {
            "image_url": "https://assets.tcgdex.net/en/sv/sv03.5/199/high.webp",
            "image_source": "tcgdex:sv03.5-199",
        }
        # Not SV4a-201 (another set's 201: a different set size).
        assert (
            _image(conn, "cards", JP_CHARIZARD)["image_url"]
            == "https://assets.tcgdex.net/ja/SV/SV2a/201/high.webp"
        )
        # The manga print of OP05-119 in its own set (not the manga reprint from Premium Booster).
        assert _image(conn, "cards", EN_LUFFY) == {
            "image_url": "https://en.onepiece-cardgame.com/images/cardlist/card/OP05-119_p2.png",
            "image_source": "bandai:OP05-119_p2",
        }
        assert _image(conn, "cards", JP_LUFFY)["image_source"] == "bandai:OP05-119_p2"
        assert _image(conn, "sealed_products", ETB) == {
            "image_url": "https://img.jbhifi.example/etb.jpg",
            "image_source": "retailer:jb-hi-fi",
        }
        assert stats["cards_from_tcgdex"] == 2 and stats["cards_from_bandai"] == 2
        assert stats["sealed_from_retailers"] == 1
        # TCGdex found everything, so pokemontcg.io wasn't asked; each image address was checked once.
        assert pokemontcg.calls == [] and stats["image_checks"] == 2
        cov = stats["coverage"]
        assert cov["cards"] == {
            "total": 4,
            "with_image": 4,
            "pct": 100.0,
            "by": {"one-piece/en": "1/1", "one-piece/jp": "1/1", "pokemon/en": "1/1", "pokemon/jp": "1/1"},
        }
        assert stats["missing_cards"] == {"count": 0, "first": []}

        # Scrydex later replaces the free images.
        client, _ = _mock(fixtures)
        _run(conn, fixtures, client=client)
        assert _image(conn, "cards", EN_CHARIZARD)["image_source"] == "scrydex:sv3pt5-199"
        assert _image(conn, "sealed_products", ETB)["image_source"] == "scrydex:sv-test-etb"
        assert _image(conn, "cards", EN_LUFFY)["image_url"].endswith("OP05-119-manga/large")
    finally:
        conn.execute("update public.retail_products set image_url = null where id = 3")
        conn.commit()


def test_pokemontcg_fills_what_tcgdex_cannot_and_a_failing_source_does_not_stop_the_run(conn, fixtures):
    pokemontcg = _pokemontcg(fixtures, cards="cards-charizard")
    stats = _run(conn, fixtures, tcgdex=_tcgdex(fixtures, down=True), pokemontcg=pokemontcg)
    assert "tcgdex" in stats["errors"]
    # Same name and number in Obsidian Flames too: the card's set ('151' = sv3pt5) decides.
    assert _image(conn, "cards", EN_CHARIZARD) == {
        "image_url": "https://images.pokemontcg.io/sv3pt5/199_hires.png",
        "image_source": "pokemontcg:sv3pt5-199",
    }
    # One batched search for the one English card, after the set list.
    assert [r.url.path for r in pokemontcg.calls] == ["/v2/sets", "/v2/cards"]
    q = pokemontcg.calls[1].url.params["q"]
    assert 'name:"Charizard ex"' in q and 'number:"199"' in q
    # The rest of the run went on: One Piece still filled.
    assert stats["cards_from_bandai"] == 2 and stats["cards_from_pokemontcg"] == 1


def test_the_tcgplayer_image_is_the_last_resort_and_is_checked_first(conn, fixtures):
    conn.execute("update public.cards set tcgplayer_id = 512345 where id = %s", (EN_LUFFY,))
    conn.execute("update public.cards set tcgplayer_id = 999 where id = %s", (JP_LUFFY,))
    conn.commit()
    checker = _checker(missing=("/999_",))
    stats = _run(
        conn,
        fixtures,
        tcgdex=_tcgdex(fixtures, down=True),
        pokemontcg=_pokemontcg(fixtures, down=True),
        optcg=_optcg(fixtures, empty=True),
        checker=checker,
    )
    assert set(stats["errors"]) == {"tcgdex", "pokemontcg"}
    assert _image(conn, "cards", EN_LUFFY) == {
        "image_url": "https://tcgplayer-cdn.tcgplayer.com/product/512345_in_1000x1000.jpg",
        "image_source": "tcgplayer:512345",
    }
    # TCGplayer has no image for 999: left on the default image, and listed.
    assert _image(conn, "cards", JP_LUFFY)["image_url"] is None
    missing = stats["missing_cards"]
    assert missing["count"] == 3
    assert "one-piece/jp 新時代の主役 #OP05-119 Monkey.D.Luffy [manga]" in missing["first"]
    assert any(m.endswith("(no TCGplayer id)") and "Charizard" in m for m in missing["first"])

    # Next run the open sources are back: the open image replaces the TCGplayer one.
    _run(conn, fixtures)
    assert _image(conn, "cards", EN_LUFFY)["image_source"] == "bandai:OP05-119_p2"


def test_the_tcgplayer_fallback_can_be_switched_off(conn, fixtures):
    conn.execute("update public.cards set tcgplayer_id = 512345 where id = %s", (EN_LUFFY,))
    conn.execute("update public.site_settings set value = 'false' where key = 'images.tcgplayer_fallback'")
    conn.commit()
    try:
        stats = _run(conn, fixtures, optcg=_optcg(fixtures, empty=True))
        assert _image(conn, "cards", EN_LUFFY)["image_url"] is None
        assert stats["cards_from_tcgplayer"] == 0
    finally:
        conn.execute("update public.site_settings set value = 'true' where key = 'images.tcgplayer_fallback'")
        conn.commit()


def test_cards_still_missing_get_one_scrydex_search_each(conn, fixtures):
    client, calls = _mock(fixtures)
    # Nothing synced from expansions this time: every expansion was synced recently and is old.
    for game, exp in (("pokemon", "sv3pt5"), ("pokemon", "sv2a_ja"), ("one-piece", "OP05")):
        conn.execute(
            "insert into public.scrydex_expansions (game, expansion_id, lang, name, release_date, synced_at) values (%s, %s, 'en', %s, '2020-01-01', %s)",
            (game, exp, exp, NOW),
        )
    conn.commit()
    stats = _run(conn, fixtures, client=client, optcg=_optcg(fixtures, empty=True))
    searches = [c for c in calls if c.endswith("/v1/cards")]
    # TCGdex filled the two Pokémon cards; the two One Piece cards are searched (one credit each).
    assert len(searches) == 2 and stats["cards_from_search"] == 0
