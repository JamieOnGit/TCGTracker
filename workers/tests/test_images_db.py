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
from tcgworkers.sources.population.base import SourceNotApproved

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


def _image(conn, table, id_):
    return conn.execute(
        f"select image_url, image_source from public.{table} where id = %s", (id_,)
    ).fetchone()


def test_a_run_fills_card_and_sealed_images(conn, fixtures):
    client, calls = _mock(fixtures)
    stats = refresh_images(conn, Env.from_environ({}), client=client, now=NOW)

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
    refresh_images(conn, Env.from_environ({}), client=client, now=NOW)

    again, calls = _mock(fixtures)
    stats = refresh_images(conn, Env.from_environ({}), client=again, now=NOW + timedelta(days=1))
    # Expansions released over 90 days ago and synced yesterday: no card pages fetched.
    assert not any(c.endswith("/cards") for c in calls)
    assert stats["expansions_synced"] == 0

    later, calls = _mock(fixtures)
    refresh_images(conn, Env.from_environ({}), client=later, now=NOW + timedelta(days=31))
    assert any(c.endswith("/cards") for c in calls)


def test_a_hand_set_image_is_never_overwritten(conn, fixtures):
    conn.execute(
        "update public.cards set image_url = 'https://cdn.example/mine.jpg', image_source = 'manual' where id = %s",
        (EN_CHARIZARD,),
    )
    conn.commit()
    client, _ = _mock(fixtures)
    refresh_images(conn, Env.from_environ({}), client=client, now=NOW)
    assert _image(conn, "cards", EN_CHARIZARD) == {
        "image_url": "https://cdn.example/mine.jpg",
        "image_source": "manual",
    }


def test_the_job_needs_scrydex_keys(conn):
    with pytest.raises(SourceNotApproved):
        refresh_images(conn, Env.from_environ({}))
