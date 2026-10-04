"""The release calendar, filled with Australian dates (job ``releases``, every 6 h).

* **One Piece, official:** Bandai's English site, edition NA/EU/OC (Oceania),
  see ``sources/releases/bandai.py``. Boosters and decks with a set code
  (``[OP-18]``) link to our set when we have it.
* **Australian retailers:** the street date JB Hi-Fi publishes on each
  product (``retail_products.release_date``, saved by the drop monitor).
  Products of one set out on one day become one release ("Retailer listing")
  listing each product; products we can't place in a set are one release
  each. A set that already has an editor's or an official release is left to
  that one, so the calendar never shows the same set twice.

Rules that keep an editor in charge: a release an editor has edited is
``locked`` and never overwritten; one an editor deleted is in
``release_dismissed`` and never re-added. An automatic release whose source
no longer lists it (date moved, listing gone) is unpublished, never deleted.
Only dates from 60 days ago onwards are synced; past releases stay as they are.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import psycopg

from tcgworkers.config import Env
from tcgworkers.db import load_rules, pipeline_run
from tcgworkers.sources.releases.bandai import SOURCE_NAME as BANDAI_SOURCE
from tcgworkers.sources.releases.bandai import BandaiClient, BandaiError, BandaiRelease, fetch_releases

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]
AU_TZ = ZoneInfo("Australia/Sydney")
PAST_DAYS = 60  # keep syncing releases this recent ("Recently released")
AHEAD_DAYS = 400  # ignore placeholder dates far in the future
# Retailers whose published street dates we trust for the calendar.
RETAILERS = {"jb-hi-fi": "JB Hi-Fi"}
_BOOSTERISH = re.compile(r"booster|etb|elite|display|bundle|collection|tin|deck|blister", re.I)


@dataclass
class AutoRelease:
    key: str
    game: str
    lang: str
    title: str
    kind: str
    release_date: date
    confidence: str
    source_name: str
    source_url: str | None
    set_id: str | None = None
    products: list[dict[str, Any]] = field(default_factory=list)
    retailer_slugs: list[str] | None = None
    summary: str | None = None


def today_au(now: datetime | None = None) -> date:
    return (now or datetime.now(AU_TZ)).astimezone(AU_TZ).date()


def slugify(value: str) -> str:
    v = unicodedata.normalize("NFKD", value)
    v = "".join(ch for ch in v if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", v).strip("-")[:80].strip("-") or "release"


# ------------------------------------------------------------------ Bandai
def _op_set_id(conn: Conn, code: str | None) -> str | None:
    if not code:
        return None
    c = code.lower()
    row = conn.execute(
        """select id::text as id from public.sets
            where game = 'one-piece' and lang = 'en' and lower(code) in (%s, %s) limit 1""",
        (c, c.replace("-", "")),
    ).fetchone()
    return row["id"] if row else None


def bandai_releases(conn: Conn, found: list[BandaiRelease]) -> list[AutoRelease]:
    out = []
    for r in found:
        out.append(
            AutoRelease(
                key=r.key,
                game="one-piece",
                lang="en",
                title=r.title,
                kind="set_release" if r.is_set else "product_release",
                release_date=r.release_date,
                confidence="official",
                source_name=BANDAI_SOURCE,
                source_url=r.url,
                set_id=_op_set_id(conn, r.code) if r.is_set or r.category == "decks" else None,
                products=[{"name": r.title, "type": r.product_type, "rrp_aud": None}],
            )
        )
    return out


# --------------------------------------------------------------- retailers
def _clean_title(title: str) -> str:
    t = re.sub(
        r"^\s*(pok[eé]mon\s+tcg|pok[eé]mon\s+trading\s+card\s+game|one\s+piece\s+(?:tcg|card\s+game))\s*[:\-–]\s*",
        "",
        title,
        flags=re.I,
    )
    return re.sub(r"\s+", " ", t).strip()[:120] or title[:120]


def _lang_of(title: str, product_lang: str | None) -> str:
    if product_lang:
        return product_lang
    return "jp" if re.search(r"\bjapanese\b|\(jp\)|\bjpn\b", title, re.I) else "en"


def retailer_releases(conn: Conn, today: date) -> list[AutoRelease]:
    rows = conn.execute(
        """select r.slug as retailer, rp.sku, rp.title, rp.url, rp.game, rp.product_type, rp.release_date,
                  sp.lang as product_lang, sp.rrp_aud, sp.type as sealed_type,
                  s.id::text as set_id, s.name as set_name, s.lang as set_lang
             from public.retail_products rp
             join public.retailers r on r.id = rp.retailer_id
             left join public.sealed_products sp on sp.id = rp.sealed_product_id
             left join public.sets s on s.id = sp.set_id
            where r.slug = any(%s) and rp.game is not null and not rp.is_marketplace_seller
              and rp.release_date between %s and %s
            order by rp.release_date, rp.title""",
        (list(RETAILERS), today - timedelta(days=PAST_DAYS), today + timedelta(days=AHEAD_DAYS)),
    ).fetchall()
    groups: dict[tuple[str, ...], AutoRelease] = {}
    for r in rows:
        lang = r["set_lang"] or _lang_of(r["title"], r["product_lang"])
        name = _clean_title(r["title"])
        product = {
            "name": name,
            "type": r["sealed_type"] or r["product_type"],
            "rrp_aud": float(r["rrp_aud"]) if r["rrp_aud"] is not None else None,
        }
        if r["set_id"]:
            gk: tuple[str, ...] = (r["retailer"], r["game"], lang, r["set_id"], r["release_date"].isoformat())
            if gk not in groups:
                groups[gk] = AutoRelease(
                    key=f"{r['retailer']}:{r['game']}:{lang}:set:{r['set_id']}:{r['release_date'].isoformat()}",
                    game=r["game"],
                    lang=lang,
                    title=r["set_name"][:120],
                    kind="product_release",
                    release_date=r["release_date"],
                    confidence="retailer",
                    source_name=RETAILERS[r["retailer"]],
                    source_url=r["url"],
                    set_id=r["set_id"],
                    retailer_slugs=[r["retailer"]],
                )
            ev = groups[gk]
            if all(p["name"] != name for p in ev.products):
                ev.products.append(product)
            if _BOOSTERISH.search(name):
                ev.kind = "set_release"
        else:
            gk = (r["retailer"], r["sku"])
            groups[gk] = AutoRelease(
                key=f"{r['retailer']}:{r['game']}:{lang}:sku:{r['sku']}",
                game=r["game"],
                lang=lang,
                title=name,
                kind="product_release",
                release_date=r["release_date"],
                confidence="retailer",
                source_name=RETAILERS[r["retailer"]],
                source_url=r["url"],
                products=[product],
                retailer_slugs=[r["retailer"]],
            )
    for ev in groups.values():
        ev.products = ev.products[:50]
        if len(ev.products) > 1:
            ev.summary = f"{len(ev.products)} products listed by {ev.source_name} for this date."[:300]
    return list(groups.values())


def _covered_sets(conn: Conn) -> set[tuple[str, str, str]]:
    """(game, lang, set id) that already have an editor's or an official release."""
    rows = conn.execute(
        """select game, lang, set_id::text as set_id from public.release_events
            where set_id is not null and published
              and (external_key is null or confidence = 'official' or locked)"""
    ).fetchall()
    return {(r["game"], r["lang"], r["set_id"]) for r in rows}


# ------------------------------------------------------------------ writing
_UPSERT = """
insert into public.release_events (game, lang, slug, title, kind, release_date, date_precision, confidence, set_id,
    products, retailer_slugs, summary, source_name, source_url, external_key, published)
values (%(game)s, %(lang)s, %(slug)s, %(title)s, %(kind)s, %(release_date)s, 'day', %(confidence)s, %(set_id)s,
    %(products)s::jsonb, %(retailer_slugs)s, %(summary)s, %(source_name)s, %(source_url)s, %(key)s, true)
on conflict (external_key) do update set
    title = excluded.title, kind = excluded.kind, release_date = excluded.release_date,
    date_precision = 'day', confidence = excluded.confidence,
    set_id = coalesce(excluded.set_id, release_events.set_id), products = excluded.products,
    retailer_slugs = excluded.retailer_slugs, summary = coalesce(excluded.summary, release_events.summary),
    source_name = excluded.source_name, source_url = excluded.source_url, published = true
  where not release_events.locked
returning (xmax = 0) as inserted"""


def _save(conn: Conn, ev: AutoRelease) -> str:
    """'inserted' / 'updated' / 'locked' / 'slug_taken'."""
    params = {
        "game": ev.game,
        "lang": ev.lang,
        "title": ev.title,
        "kind": ev.kind,
        "release_date": ev.release_date,
        "confidence": ev.confidence,
        "set_id": ev.set_id,
        "products": json.dumps(ev.products),
        "retailer_slugs": ev.retailer_slugs,
        "summary": ev.summary,
        "source_name": ev.source_name,
        "source_url": ev.source_url if ev.source_url and ev.source_url.startswith("https://") else None,
        "key": ev.key,
    }
    base = slugify(ev.title if ev.lang == "en" else f"{ev.title} {ev.lang}")
    existing = conn.execute(
        "select slug from public.release_events where external_key = %s", (ev.key,)
    ).fetchone()
    candidates = [existing["slug"]] if existing else [base, f"{base}-{ev.release_date.isoformat()}"]
    for slug in candidates:
        try:
            with conn.transaction():
                row = conn.execute(_UPSERT, {**params, "slug": slug}).fetchone()
        except psycopg.errors.UniqueViolation:
            continue  # another release already uses this slug
        if row is None:
            return "locked"
        return "inserted" if row["inserted"] else "updated"
    return "slug_taken"


def sync(conn: Conn, events: list[AutoRelease], *, sources_ok: list[str], today: date) -> dict[str, int]:
    dismissed = {r["external_key"] for r in conn.execute("select external_key from public.release_dismissed")}
    covered = _covered_sets(conn)
    stats = {
        "inserted": 0,
        "updated": 0,
        "locked": 0,
        "slug_taken": 0,
        "dismissed": 0,
        "covered": 0,
        "retired": 0,
    }
    seen: set[str] = set()
    for ev in events:
        seen.add(ev.key)
        if ev.key in dismissed:
            stats["dismissed"] += 1
            continue
        if ev.confidence == "retailer" and ev.set_id and (ev.game, ev.lang, ev.set_id) in covered:
            stats["covered"] += 1
            continue
        stats[_save(conn, ev)] += 1
    # Automatic releases a source no longer lists (moved date, listing gone):
    # unpublish upcoming ones, only for sources that answered this run.
    for prefix in sources_ok:
        cur = conn.execute(
            """update public.release_events set published = false
                where external_key like %s and not locked and published
                  and release_date >= %s and not (external_key = any(%s))""",
            (prefix + ":%", today, list(seen)),
        )
        stats["retired"] += cur.rowcount
    return stats


def refresh_releases(
    conn: Conn, env: Env, *, bandai: BandaiClient | None = None, now: datetime | None = None
) -> dict[str, Any] | None:
    extra = load_rules(conn).extra
    if extra.get("releases.auto_sync", True) is False:
        log.info("releases: releases.auto_sync is off")
        return None
    today = today_au(now)
    with pipeline_run(conn, "releases") as stats:
        events: list[AutoRelease] = []
        sources_ok: list[str] = []
        try:
            client = bandai or BandaiClient(user_agent=env.user_agent)
            found = fetch_releases(client, since=today - timedelta(days=PAST_DAYS))
            events += bandai_releases(conn, found)
            sources_ok.append("bandai")
            stats["bandai"] = len(found)
        except BandaiError as exc:
            log.warning("releases: Bandai unavailable: %s", exc)
            stats["bandai_error"] = str(exc)[:300]
        retail = retailer_releases(conn, today)
        events += retail
        sources_ok += list(RETAILERS)
        stats["retailer"] = len(retail)
        stats.update(sync(conn, events, sources_ok=sources_ok, today=today))
        log.info("releases: %s", dict(stats))
        return dict(stats)
