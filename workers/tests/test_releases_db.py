"""Release calendar sync against Postgres: insert, update, editor locks,
dismissals, no duplicate sets, retiring moved dates. Skipped unless
TEST_DATABASE_URL is set; CI sets it."""

from __future__ import annotations

import json
import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row

from tcgworkers.config import Env
from tcgworkers.jobs.releases import refresh_releases, today_au
from tcgworkers.sources.releases.bandai import BandaiClient

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")
PAGE = (Path(__file__).parent / "fixtures/bandai/op-products-page1.html").read_text(encoding="utf-8")
SV3PT5 = "10000000-0000-0000-0000-000000000001"
NOW = datetime(2026, 10, 4, 9, 0, tzinfo=UTC)
TODAY = today_au(NOW)
Conn = psycopg.Connection[dict[str, Any]]


def _clean(c: Conn) -> None:
    c.rollback()
    c.execute("delete from public.release_events where external_key is not null")
    c.execute("delete from public.release_dismissed")
    c.execute("delete from public.retail_products where sku like 'rel-test-%'")
    c.execute("delete from public.sealed_products where slug like 'rel-test-%'")
    c.commit()


@pytest.fixture
def conn() -> Any:
    assert URL
    with psycopg.connect(URL, row_factory=dict_row) as c:
        _clean(c)
        yield c
        _clean(c)


def _bandai(pages: dict[int, str] | None = None, status: int = 200) -> BandaiClient:
    pages = pages or {1: PAGE}

    def handler(req: httpx.Request) -> httpx.Response:
        n = int(req.url.params["page"])
        return httpx.Response(status, text=pages.get(n, "<html></html>"))

    return BandaiClient(
        user_agent="TCGTrackerBot/1.0", transport=httpx.MockTransport(handler), sleep=lambda s: None
    )


def _jb_product(c: Conn, sku: str, title: str, when: date | None, *, sealed: str | None = None) -> None:
    c.execute(
        """insert into public.retail_products (retailer_id, sku, url, title, game, sealed_product_id, release_date)
           select id, %s, %s, %s, 'pokemon', %s, %s from public.retailers where slug = 'jb-hi-fi'""",
        (sku, f"https://www.jbhifi.com.au/products/{sku}", title, sealed, when),
    )


def _sealed(c: Conn, slug: str, ptype: str, rrp: str) -> str:
    row = c.execute(
        """insert into public.sealed_products (game, lang, set_id, type, name, slug, rrp_aud)
           values ('pokemon', 'en', %s, %s, %s, %s, %s) returning id::text as id""",
        (SV3PT5, ptype, slug, slug, rrp),
    ).fetchone()
    assert row
    return row["id"]


def _auto(c: Conn) -> dict[str, dict[str, Any]]:
    rows = c.execute("select * from public.release_events where external_key is not null").fetchall()
    return {r["external_key"]: r for r in rows}


def _run(c: Conn, bandai: BandaiClient | None = None, now: datetime = NOW) -> dict[str, Any]:
    out = refresh_releases(c, Env.from_environ({}), bandai=bandai or _bandai(), now=now)
    c.commit()
    assert out is not None
    return out


def test_official_bandai_and_jb_street_dates_fill_the_calendar(conn: Conn) -> None:
    etb = _sealed(conn, "rel-test-etb", "etb", "89.95")
    bb = _sealed(conn, "rel-test-bundle", "booster-bundle", "54.95")
    day = TODAY + timedelta(days=12)
    _jb_product(conn, "rel-test-1", "Pokemon TCG: Scarlet & Violet 151 Elite Trainer Box", day, sealed=etb)
    _jb_product(conn, "rel-test-2", "Pokemon TCG: Scarlet & Violet 151 Booster Bundle", day, sealed=bb)
    _jb_product(conn, "rel-test-3", "Pokemon TCG: Mini Portfolio", TODAY + timedelta(days=30))
    _jb_product(conn, "rel-test-4", "Pokemon TCG: Old Tin", TODAY - timedelta(days=400))  # long gone: ignored
    conn.commit()

    stats = _run(conn)
    events = _auto(conn)
    op18 = events["bandai:op18"]
    assert op18["game"] == "one-piece" and op18["confidence"] == "official" and op18["kind"] == "set_release"
    assert (
        op18["release_date"] == date(2026, 11, 20) and op18["date_precision"] == "day" and op18["published"]
    )
    assert op18["slug"] == "booster-pack-the-dominance-of-god-op-18"
    assert op18["source_url"] == "https://en.onepiece-cardgame.com/products/op18.html"

    # The set's two JB products are one release, listing both with their AU RRP.
    set_key = f"jb-hi-fi:pokemon:en:set:{SV3PT5}:{day.isoformat()}"
    sv = events[set_key]
    assert sv["confidence"] == "retailer" and sv["kind"] == "set_release" and str(sv["set_id"]) == SV3PT5
    assert (
        sv["release_date"] == day and sv["retailer_slugs"] == ["jb-hi-fi"] and sv["source_name"] == "JB Hi-Fi"
    )
    assert {(p["name"], p["rrp_aud"]) for p in sv["products"]} == {
        ("Scarlet & Violet 151 Elite Trainer Box", 89.95),
        ("Scarlet & Violet 151 Booster Bundle", 54.95),
    }
    portfolio = events["jb-hi-fi:pokemon:en:sku:rel-test-3"]
    assert portfolio["title"] == "Mini Portfolio" and portfolio["kind"] == "product_release"
    assert not any("rel-test-4" in k for k in events)
    assert stats["inserted"] == len(events) and stats["bandai"] >= 4

    # Running again changes nothing.
    again = _run(conn)
    assert again["inserted"] == 0 and again["updated"] == len(events) and again["retired"] == 0


def test_moved_dates_update_or_retire_and_editors_stay_in_charge(conn: Conn) -> None:
    _jb_product(conn, "rel-test-5", "Pokemon TCG: Mini Portfolio", TODAY + timedelta(days=30))
    conn.commit()
    _run(conn)
    key = "jb-hi-fi:pokemon:en:sku:rel-test-5"

    # JB moves the date: the same release moves with it.
    conn.execute(
        "update public.retail_products set release_date = %s where sku = 'rel-test-5'",
        (TODAY + timedelta(days=40),),
    )
    conn.commit()
    _run(conn)
    assert _auto(conn)[key]["release_date"] == TODAY + timedelta(days=40)

    # An editor fixes the title in Admin: locked, and the sync no longer touches it.
    conn.execute(
        "select set_config('request.jwt.claims', %s, true)",
        (json.dumps({"sub": "00000000-0000-0000-0000-0000000000e1", "role": "authenticated"}),),
    )
    conn.execute(
        "update public.release_events set title = 'Pokémon Mini Portfolio (2026)' where external_key = %s",
        (key,),
    )
    conn.commit()
    ev = _auto(conn)[key]
    assert ev["locked"] and ev["title"] == "Pokémon Mini Portfolio (2026)"
    conn.execute(
        "update public.retail_products set release_date = %s where sku = 'rel-test-5'",
        (TODAY + timedelta(days=50),),
    )
    conn.commit()
    stats = _run(conn)
    ev = _auto(conn)[key]
    assert (
        stats["locked"] == 1
        and ev["title"] == "Pokémon Mini Portfolio (2026)"
        and ev["release_date"] == TODAY + timedelta(days=40)
    )

    # Deleted by an editor: never comes back.
    conn.execute("delete from public.release_events where external_key = 'bandai:op18'")
    conn.commit()
    stats = _run(conn)
    assert "bandai:op18" not in _auto(conn) and stats["dismissed"] == 1

    # Gone from Bandai's list: unpublished (kept, not deleted).
    smaller = PAGE.replace(
        'href="https://en.onepiece-cardgame.com/products/eb05.html"',
        'href="https://en.onepiece-cardgame.com/products/eb05-moved.html"',
    )
    _run(conn, _bandai({1: smaller}))
    events = _auto(conn)
    assert not events["bandai:eb05"]["published"] and events["bandai:eb05-moved"]["published"]


def test_bandai_down_keeps_its_releases_and_a_set_with_an_editor_release_is_not_doubled(conn: Conn) -> None:
    _run(conn)
    stats = _run(conn, _bandai(status=503))
    assert "bandai_error" in stats and stats["retired"] == 0
    assert all(e["published"] for k, e in _auto(conn).items() if k.startswith("bandai:"))

    # The seed has an editor's release for 151 (no external key): JB's 151 dates don't add a second one.
    conn.execute(
        """insert into public.release_events (game, lang, slug, title, release_date, set_id, confidence)
           values ('pokemon', 'en', 'rel-test-151', '151 (editor)', %s, %s, 'official')""",
        (TODAY + timedelta(days=12), SV3PT5),
    )
    etb = _sealed(conn, "rel-test-etb2", "etb", "89.95")
    _jb_product(conn, "rel-test-6", "Pokemon TCG: 151 ETB", TODAY + timedelta(days=12), sealed=etb)
    conn.commit()
    try:
        stats = _run(conn)
        assert stats["covered"] == 1 and not any(":set:" in k for k in _auto(conn))
    finally:
        conn.execute("delete from public.release_events where slug = 'rel-test-151'")
        conn.commit()


def test_auto_sync_can_be_switched_off(conn: Conn) -> None:
    conn.execute("update public.site_settings set value = 'false' where key = 'releases.auto_sync'")
    conn.commit()
    try:
        assert refresh_releases(conn, Env.from_environ({}), bandai=_bandai(), now=NOW) is None
        assert _auto(conn) == {}
    finally:
        conn.execute("update public.site_settings set value = 'true' where key = 'releases.auto_sync'")
        conn.commit()
