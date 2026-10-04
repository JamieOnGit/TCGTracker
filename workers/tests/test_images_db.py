"""The images job against a migrated database (supabase/tests/run.sh leaves
one with 4 fixture cards and a sealed product). Skipped unless TEST_DATABASE_URL is set."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.config import Env
from tcgworkers.jobs.images import refresh_images
from tcgworkers.sources.images.scrydex import ScrydexClient
from tcgworkers.sources.images.tcgdex import TcgdexClient

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

EN_CHARIZARD = "20000000-0000-0000-0000-000000000001"
JP_CHARIZARD = "20000000-0000-0000-0000-000000000002"
EN_LUFFY = "20000000-0000-0000-0000-000000000003"  # the manga print
ETB = "30000000-0000-0000-0000-000000000001"
NOW = datetime(2026, 10, 3, 6, 0, tzinfo=UTC)


def _reset(c):
    c.rollback()
    c.execute("update public.cards set image_url = null, image_source = null")
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
        "k",
        "t",
        user_agent="test",
        max_requests=100,
        transport=httpx.MockTransport(handler),
        sleep=lambda s: None,
        min_interval=0,
    )
    return client, calls


def _tcgdex(fixtures):
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        parts = request.url.path.strip("/").split("/")  # v2/{lang}/sets[/{id}]
        name = f"{parts[1]}-sets.json" if len(parts) == 3 else f"{parts[1]}-{parts[3]}.json"
        path = fixtures / "tcgdex" / name
        return httpx.Response(200, text=path.read_text()) if path.exists() else httpx.Response(404)

    client = TcgdexClient(
        user_agent="test",
        max_requests=50,
        transport=httpx.MockTransport(handler),
        sleep=lambda s: None,
        min_interval=0,
    )
    client.calls = calls  # type: ignore[attr-defined]
    return client


def _image(conn, table, id_):
    return conn.execute(
        f"select image_url, image_source from public.{table} where id = %s", (id_,)
    ).fetchone()


def test_a_run_fills_card_and_sealed_images(conn, fixtures):
    client, calls = _mock(fixtures)
    stats = refresh_images(conn, Env.from_environ({}), client=client, tcgdex=_tcgdex(fixtures), now=NOW)

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
    # The Chinese expansion is never fetched.
    assert not any("zh1" in c for c in calls)
    assert {
        r["expansion_id"] for r in conn.execute("select expansion_id from public.scrydex_expansions")
    } == {"sv3pt5", "sv2a_ja", "OP05"}


def test_synced_expansions_are_skipped_until_due(conn, fixtures):
    client, _ = _mock(fixtures)
    refresh_images(conn, Env.from_environ({}), client=client, tcgdex=_tcgdex(fixtures), now=NOW)

    again, calls = _mock(fixtures)
    stats = refresh_images(
        conn, Env.from_environ({}), client=again, tcgdex=_tcgdex(fixtures), now=NOW + timedelta(days=1)
    )
    # Expansions released over 90 days ago and synced yesterday: no card pages fetched.
    assert not any("/expansions/" in c and c.endswith("/cards") for c in calls)
    assert stats["expansions_synced"] == 0

    later, calls = _mock(fixtures)
    refresh_images(
        conn, Env.from_environ({}), client=later, tcgdex=_tcgdex(fixtures), now=NOW + timedelta(days=31)
    )
    assert any(c.endswith("/cards") for c in calls)


def test_a_hand_set_image_is_never_overwritten(conn, fixtures):
    conn.execute(
        "update public.cards set image_url = 'https://cdn.example/mine.jpg', image_source = 'manual' where id = %s",
        (EN_CHARIZARD,),
    )
    conn.commit()
    client, _ = _mock(fixtures)
    refresh_images(conn, Env.from_environ({}), client=client, tcgdex=_tcgdex(fixtures), now=NOW)
    assert _image(conn, "cards", EN_CHARIZARD) == {
        "image_url": "https://cdn.example/mine.jpg",
        "image_source": "manual",
    }


def test_without_scrydex_the_free_sources_fill_pokemon_cards_and_sealed(conn, fixtures):
    """No Scrydex keys: TCGdex fills Pokémon cards (English by set name + number + name,
    Japanese by set code + number), a sealed product takes its own store listing's photo,
    and the run reports coverage."""
    conn.execute(
        "update public.retail_products set image_url = 'https://img.jbhifi.example/etb.jpg' where id = 3"
    )
    conn.commit()
    try:
        tcgdex = _tcgdex(fixtures)
        stats = refresh_images(conn, Env.from_environ({}), tcgdex=tcgdex, now=NOW)
        assert stats["scrydex"].startswith("skipped")
        assert _image(conn, "cards", EN_CHARIZARD) == {
            "image_url": "https://assets.tcgdex.net/en/sv/sv03.5/199/high.webp",
            "image_source": "tcgdex:sv03.5-199",
        }
        assert (
            _image(conn, "cards", JP_CHARIZARD)["image_url"]
            == "https://assets.tcgdex.net/ja/SV/SV2a/201/high.webp"
        )
        assert _image(conn, "sealed_products", ETB) == {
            "image_url": "https://img.jbhifi.example/etb.jpg",
            "image_source": "retailer:jb-hi-fi",
        }
        # TCG Pocket sets are never used; One Piece needs Scrydex.
        assert stats["cards_from_tcgdex"] == 2 and stats["sealed_from_retailers"] == 1
        cov = stats["coverage"]
        assert cov["cards"]["total"] == 4 and cov["cards"]["with_image"] == 2 and cov["cards"]["pct"] == 50.0
        assert cov["sealed"]["with_image"] >= 1 and cov["cards"]["by"]["pokemon/en"] == "1/1"

        # Scrydex later replaces the weaker images, and fills One Piece.
        client, _ = _mock(fixtures)
        refresh_images(conn, Env.from_environ({}), client=client, tcgdex=_tcgdex(fixtures), now=NOW)
        assert _image(conn, "cards", EN_CHARIZARD)["image_source"] == "scrydex:sv3pt5-199"
        assert _image(conn, "sealed_products", ETB)["image_source"] == "scrydex:sv-test-etb"
        assert _image(conn, "cards", EN_LUFFY)["image_url"].endswith("OP05-119-manga/large")
    finally:
        conn.execute("update public.retail_products set image_url = null where id = 3")
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
    stats = refresh_images(conn, Env.from_environ({}), client=client, tcgdex=_tcgdex(fixtures), now=NOW)
    searches = [c for c in calls if c.endswith("/v1/cards")]
    # TCGdex filled the two Pokémon cards; the two One Piece cards are searched (one credit each).
    assert len(searches) == 2 and stats["cards_from_search"] == 0
