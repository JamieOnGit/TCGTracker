"""The release calendar, filled with Australian dates (job ``releases``, every 6 h).

* **One Piece, official:** Bandai's English site, edition NA/EU/OC (Oceania),
  see ``sources/releases/bandai.py``. Boosters and decks with a set code
  (``[OP-18]``) link to our set when we have it.
* **Australian stores:** the street date every store we monitor publishes
  (``retail_products.release_date``, saved by the drop monitor: JB Hi-Fi's
  own field; titles and descriptions elsewhere, e.g. "(Releases 6 Nov
  2026)"). Each product takes the date most stores give it; products of one
  set family out on the same date become one release ("Retailer listing")
  listing each product and every store that has it. A set that already has
  an editor's or an official release is left to that one, so the calendar
  never shows the same set twice.

Rules that keep an editor in charge: a release an editor has edited is
``locked`` and never overwritten; one an editor deleted is in
``release_dismissed`` and never re-added. An automatic release whose source
no longer lists it (date moved, listing gone) is unpublished, never deleted.
Only dates from 60 days ago onwards are synced; past releases stay as they are.
"""

from __future__ import annotations

import hashlib
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
from tcgworkers.drops.products import TYPES, detect_lang, plain
from tcgworkers.sources.releases.bandai import SOURCE_NAME as BANDAI_SOURCE
from tcgworkers.sources.releases.bandai import BandaiClient, BandaiError, BandaiRelease, fetch_releases

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]
AU_TZ = ZoneInfo("Australia/Sydney")
PAST_DAYS = 60  # keep syncing releases this recent ("Recently released")
AHEAD_DAYS = 400  # ignore placeholder dates far in the future
# Retailers whose published street dates we trust for the calendar.


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
    precision: str = "day"  # 'day' or 'month'


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
# Product listings at every Australian store we monitor that carry a street
# date (JB Hi-Fi's own field; titles and descriptions elsewhere, see
# drops/release_dates.py).
RETAILER_KEY = "au"  # external_key prefix
LEGACY_PREFIXES = ("jb-hi-fi",)  # retired by this version: superseded by "au:" releases
_BOOSTERISH = re.compile(r"booster|etb|elite|display|bundle|collection|tin|deck|blister", re.I)
# A store's own notes in a title: "(Releases 6 Nov 2026)", "(Pre-Order)", "| Pokemon TCG".
_NOTE = re.compile(r"\((?:[^()]*\b(?:releas\w*|pre-?orders?|preorder|ships?|eta|assorted)\b[^()]*)\)", re.I)
_SUFFIX = re.compile(r"\s*\|\s*(?:pok[eé]mon|one piece)[^|]*$", re.I)
_PREFIX = re.compile(
    r"^\s*(?:japanese\s+)?(?:pok[eé]mon|one\s+piece)\s*[:\-–]?\s*(?:(?:tcg|trading\s+card\s+game|card\s+game)\s*[:\-–]?\s*)?"
    r"(?:japanese\s*[:\-–]?\s*)?",
    re.I,
)
# The series a set belongs to, leading the name: "Mega Evolution - Delta Reign …".
_SERIES = re.compile(
    r"^\s*(?:mega\s+evolutions?|scarlet\s*(?:and|&)\s*violet|sword\s*(?:and|&)\s*shield)"
    r"(?:\s+\d{1,2}(?=\s*[:\-–]))?\s*[:\-–]?\s*",
    re.I,
)
# Words that don't name a set: brand, series, store wording.
_FILLER = {
    "pokemon", "tcg", "trading", "card", "cards", "game", "mega", "evolution", "evolutions", "me", "scarlet",
    "violet", "sv", "sword", "shield", "swsh", "and", "preorder", "official", "english", "en",
    "new", "sealed", "the", "japanese", "jp", "one", "piece",
}  # fmt: skip


def _clean_title(title: str) -> str:
    t = _NOTE.sub(" ", title)
    t = re.sub(r"\bpre[\s-]?orders?\b|\bpreorders?\b", " ", t, flags=re.I)
    t = _SUFFIX.sub("", t)
    t = _PREFIX.sub("", t)
    t = _SERIES.sub("", t)
    t = re.sub(r"\s*\((?:pre-?order|preorder)\)\s*", " ", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip(" -–:")[:120] or title[:120]


def _lang_of(title: str, product_lang: str | None) -> str:
    if product_lang:
        return product_lang
    return detect_lang(title) or "en"


def family_of(name: str) -> tuple[str, str, str | None]:
    """(family key, family display name, product type code) of a cleaned product name:
    the first two set words before the product type. "Mega Evolution Delta Reign
    Elite Trainer Box" -> ("delta reign", "Delta Reign", "etb")."""
    text = plain(name)
    found = [(m.start(), t) for t in TYPES if (m := t.pattern.search(text))]
    head = text[: min(found, key=lambda x: x[0])[0]] if found else text
    ptype = min(found, key=lambda x: x[0])[1].code if found else None
    words = [w for w in head.split() if w not in _FILLER]
    if not words:
        words = [w for w in text.split() if w not in _FILLER][:3]
    key_words = words[:2]
    display = " ".join(
        w if w in ("ex", "gx", "v", "vmax", "vstar") else w[:1].upper() + w[1:] for w in key_words
    )
    return " ".join(key_words), display, ptype


def _pick_date(dates: list[tuple[date, str]]) -> tuple[date, str]:
    """The date most stores give (exact days beat month-only); ties go to the earliest."""
    days = [d for d in dates if d[1] == "day"]
    pool = days or dates
    counts: dict[tuple[date, str], int] = {}
    for d in pool:
        counts[d] = counts.get(d, 0) + 1
    return sorted(counts, key=lambda d: (-counts[d], d[0]))[0]


def _members_id(members: list[dict[str, Any]]) -> str:
    """A short, stable id for which products a release groups."""
    ids = sorted(str(m["type"] or plain(m["names"][0])) for m in members)
    return hashlib.sha1("|".join(ids).encode()).hexdigest()[:10]


def _stores_label(names: list[str]) -> str:
    names = sorted(set(names))
    if len(names) <= 3:
        return ", ".join(names)
    return f"{', '.join(names[:3])} and {len(names) - 3} more"


def retailer_releases(conn: Conn, today: date) -> list[AutoRelease]:
    rows = conn.execute(
        """select r.slug as retailer, r.name as retailer_name, rp.sku, rp.title, rp.url, rp.game,
                  rp.release_date, rp.release_date_precision as precision,
                  sp.lang as product_lang, sp.rrp_aud, sp.type as sealed_type, sp.set_id::text as set_id,
                  s.lang as set_lang
             from public.retail_products rp
             join public.retailers r on r.id = rp.retailer_id and r.enabled
             left join public.sealed_products sp on sp.id = rp.sealed_product_id
             left join public.sets s on s.id = sp.set_id
            where rp.game is not null and not rp.is_marketplace_seller
              and rp.release_date between %s and %s
            order by rp.release_date, rp.title""",
        (today - timedelta(days=PAST_DAYS), today + timedelta(days=AHEAD_DAYS)),
    ).fetchall()
    # 1. One entry per product (same game, language, set family and product type,
    #    whichever store lists it), with every store's date for it.
    products: dict[tuple[str, ...], dict[str, Any]] = {}
    for r in rows:
        name = _clean_title(r["title"])
        lang = r["set_lang"] or _lang_of(r["title"], r["product_lang"])
        fkey, fname, ptype = family_of(name)
        ptype = r["sealed_type"] or ptype
        pkey = (r["game"], lang, fkey, ptype or plain(name))
        p = products.setdefault(
            pkey,
            {"game": r["game"], "lang": lang, "fkey": fkey, "fname": fname, "names": [], "type": ptype,
             "rrp": None, "dates": [], "stores": {}, "urls": [], "set_ids": []},
        )  # fmt: skip
        p["names"].append(name)
        p["dates"].append((r["release_date"], r["precision"] or "day"))
        p["stores"][r["retailer"]] = r["retailer_name"]
        p["urls"].append(r["url"])
        if r["rrp_aud"] is not None:
            p["rrp"] = float(r["rrp_aud"])
        if r["set_id"]:
            p["set_ids"].append(r["set_id"])
    # 2. Products of one family out on the same date are one release.
    groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for p in products.values():
        p["date"], p["precision"] = _pick_date(p["dates"])
        groups.setdefault(
            (p["game"], p["lang"], p["fkey"], p["date"].isoformat(), p["precision"]), []
        ).append(p)
    out: list[AutoRelease] = []
    for (game, lang, fkey, day, precision), members in groups.items():
        names = [max(set(m["names"]), key=m["names"].count) for m in members]
        stores = {slug: n for m in members for slug, n in m["stores"].items()}
        set_ids = [i for m in members for i in m["set_ids"]]
        title = names[0] if len(members) == 1 else members[0]["fname"] or names[0]
        kind = (
            "set_release"
            if len(members) > 1 and any(_BOOSTERISH.search(n) for n in names)
            else "product_release"
        )
        out.append(
            AutoRelease(
                # Same family and products = same release, so a moved date updates it in place
                # (and an editor's lock on it holds).
                key=f"{RETAILER_KEY}:{game}:{lang}:{slugify(fkey or title)}:{_members_id(members)}",
                game=game,
                lang=lang,
                title=title[:120],
                kind=kind,
                release_date=date.fromisoformat(day),
                precision=precision,
                confidence="retailer",
                source_name=f"Australian stores: {_stores_label(list(stores.values()))}"[:200],
                source_url=next((u for m in members for u in m["urls"] if u.startswith("https://")), None),
                set_id=max(set(set_ids), key=set_ids.count) if set_ids else None,
                products=[
                    {"name": n, "type": m["type"], "rrp_aud": m["rrp"]}
                    for n, m in zip(names, members, strict=True)
                ][:50],
                retailer_slugs=sorted(stores),
                summary=(
                    f"Listed for this date by {len(stores)} Australian {'store' if len(stores) == 1 else 'stores'}"
                    f" ({_stores_label(list(stores.values()))}). Retailer dates can move."
                )[:300],
            )
        )
    return out


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
values (%(game)s, %(lang)s, %(slug)s, %(title)s, %(kind)s, %(release_date)s, %(precision)s, %(confidence)s, %(set_id)s,
    %(products)s::jsonb, %(retailer_slugs)s, %(summary)s, %(source_name)s, %(source_url)s, %(key)s, true)
on conflict (external_key) do update set
    title = excluded.title, kind = excluded.kind, release_date = excluded.release_date,
    date_precision = excluded.date_precision, confidence = excluded.confidence,
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
        "precision": ev.precision if ev.precision in ("day", "month") else "day",
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
        sources_ok += [RETAILER_KEY, *LEGACY_PREFIXES]
        stats["retailer"] = len(retail)
        stats.update(sync(conn, events, sources_ok=sources_ok, today=today))
        log.info("releases: %s", dict(stats))
        return dict(stats)
