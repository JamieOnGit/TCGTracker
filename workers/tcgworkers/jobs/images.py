"""Product images from Scrydex: every card and sealed product we list.

Each run (daily):

1. **Cards.** Lists each game's expansions (English and Japanese), then
   fetches the cards of every expansion that is new to us, released in the
   last ``images.recent_days`` (90), or last synced more than
   ``images.resync_days`` (30) ago. A Scrydex card is matched to ours by
   language + card number + name; the set name breaks ties between reprints.
   Alternate prints (manga, parallel...) only take an image when the match is
   unambiguous, so a base-art image never lands on an alt-art card.
2. **Sealed products.** Pages through each game's sealed products and
   matches ours by language, product type (booster box, ETB, pack...) and
   name similarity.

Images set by hand (``image_source`` not starting ``scrydex:``) are never
overwritten. The image URL is Scrydex's own (hotlinking is allowed and free);
``image_source`` records the Scrydex id for rights review.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from tcgworkers.config import Env
from tcgworkers.db import load_rules, pipeline_run
from tcgworkers.matching.matcher import normalise_name, normalise_number
from tcgworkers.sources.images.scrydex import (
    GAMES,
    SOURCE,
    BudgetExhausted,
    ScrydexClient,
    ScrydexError,
    front_image,
    lang_of,
)
from tcgworkers.sources.images.tcgdex import LANGS as TCGDEX_LANGS
from tcgworkers.sources.images.tcgdex import TcgdexClient, TcgdexError, card_image

# Where an image came from decides what may replace it: Scrydex > TCGdex >
# a store's listing photo. Anything else (an image set by hand) is never touched.
AUTO_SOURCES = ("scrydex", "tcgdex", "retailer")


def replaceable(source: str) -> str:
    """SQL: rows whose image a ``source`` image may set or replace."""
    weaker = AUTO_SOURCES[AUTO_SOURCES.index(source) :]
    return "(image_source is null or " + " or ".join(f"image_source like '{w}:%%'" for w in weaker) + ")"


log = logging.getLogger(__name__)
Conn = Any


def _norm_set(name: str | None) -> str:
    v = unicodedata.normalize("NFKD", name or "")
    v = "".join(ch for ch in v if not unicodedata.combining(ch)).lower()
    # Sources prefix series differently ("SV: Scarlet & Violet 151", "SV2a: Pokemon Card 151").
    v = re.sub(r"^[a-z0-9]{1,6}:\s*", "", v)
    return re.sub(r"[^a-z0-9]+", "", v)


def _sets_match(a: str | None, b: str | None) -> bool:
    x, y = _norm_set(a), _norm_set(b)
    return bool(x and y) and (x == y or (min(len(x), len(y)) >= 3 and (x in y or y in x)))


def _names_match(a: str, b: str) -> bool:
    x, y = normalise_name(a), normalise_name(b)
    return bool(x and y) and (x == y or x.startswith(y + " ") or y.startswith(x + " "))


# ----------------------------------------------------------------- sealed
_STOP = {
    "pokemon",
    "tcg",
    "the",
    "card",
    "cards",
    "game",
    "trading",
    "of",
    "and",
    "en",
    "english",
    "jp",
    "japanese",
}

_TYPES: list[tuple[str, str]] = [
    (r"elite trainer|\betb\b", "etb"),
    (r"booster (box|display)|display box", "booster-box"),
    (r"booster bundle|\bbundle\b", "booster-bundle"),
    (r"blister|checklane", "blister"),
    (r"\btins?\b", "tin"),
    (r"starter deck|theme deck|battle deck|\bdeck\b", "starter-deck"),
    (r"collection|premium|box set|gift", "collection"),
    (r"booster pack|\bpack\b|sleeved booster|\bbooster\b", "booster-pack"),
]


def product_type(text: str) -> str | None:
    t = normalise_name(text)
    for pattern, kind in _TYPES:
        if re.search(pattern, t):
            return kind
    return None


def _tokens(name: str) -> set[str]:
    return {t for t in normalise_name(name).split() if t not in _STOP}


def similarity(a: str, b: str) -> float:
    x, y = _tokens(a), _tokens(b)
    return len(x & y) / len(x | y) if x and y else 0.0


# ------------------------------------------------------------------- data
@dataclass
class OurCard:
    id: str
    lang: str
    number: str
    name: str
    variant: str
    set_name: str
    managed: bool  # image unset or set by an automatic source (never a hand-set one)
    set_code: str = ""
    has_image: bool = False


@dataclass
class OurSealed:
    id: str
    game: str
    lang: str
    name: str
    type: str
    managed: bool


@dataclass
class ImageStats:
    expansions_listed: int = 0
    expansions_synced: int = 0
    cards_seen: int = 0
    cards_updated: int = 0
    cards_from_tcgdex: int = 0
    cards_from_search: int = 0
    sealed_seen: int = 0
    sealed_updated: int = 0
    sealed_from_retailers: int = 0
    requests: int = 0
    tcgdex_requests: int = 0
    stopped: str | None = None
    errors: dict[str, str] = field(default_factory=dict)


def _load_cards(conn: Conn, game: str) -> dict[tuple[str, str], list[OurCard]]:
    by_key: dict[tuple[str, str], list[OurCard]] = defaultdict(list)
    for r in conn.execute(
        f"""select c.id::text as id, c.lang, c.number, c.name, c.variant, coalesce(s.name, '') as set_name,
                  coalesce(s.code, '') as set_code, {replaceable("scrydex")} as managed, c.image_url is not null as has_image
             from public.cards c left join public.sets s on s.id = c.set_id
            where c.game = %s and not c.is_excluded""",
        (game,),
    ):
        card = OurCard(
            r["id"],
            r["lang"],
            r["number"],
            r["name"],
            r["variant"],
            r["set_name"],
            r["managed"],
            r["set_code"],
            r["has_image"],
        )
        by_key[(card.lang, normalise_number(card.number))].append(card)
    return by_key


# One Piece prints that share the base card's artwork; others (manga,
# parallel, alt-art...) need their own image from the card's Scrydex variants.
SAME_ART = {"standard", "holo", "reverse-holo", "1st-edition", "unlimited"}


def same_art(game: str, variant: str) -> bool:
    """Pokémon gives every distinct artwork its own card number (a special
    illustration rare is 199/165), so every Pokémon print uses its number's
    image. One Piece parallel / manga prints share the number but not the art."""
    return game == "pokemon" or variant in SAME_ART


def variant_image(scx: dict[str, Any], variant: str) -> str | None:
    """The image of a Scrydex variant matching one of ours ('manga', 'alt-art'...)."""
    words = [w for w in re.split(r"[^a-z0-9]+", variant.lower()) if w and w not in ("art", "alt")] or ["alt"]
    for v in scx.get("variants") or []:
        if not isinstance(v, dict):
            continue
        label = normalise_name(f"{v.get('name') or ''} {v.get('type') or ''}")
        if all(w in label.replace("alternate", "alt") for w in words):
            url = front_image(v)
            if url:
                return url
    return None


def match_card(
    scx: dict[str, Any], lang: str, index: dict[tuple[str, str], list[OurCard]], game: str = "pokemon"
) -> list[OurCard]:
    """Our cards a Scrydex card's base image belongs to (empty when unsure).
    Alternate prints are handled separately via ``variant_image``."""
    number = normalise_number(str(scx.get("printed_number") or scx.get("number") or ""))
    named = [c for c in index.get((lang, number), []) if _names_match(c.name, str(scx.get("name") or ""))]
    if not named:
        return []
    expansion = (scx.get("expansion") or {}).get("name")
    in_set = [c for c in named if _sets_match(c.set_name, expansion)]
    pool = in_set or named
    if len({c.set_name for c in pool}) > 1:
        return []  # a reprint in several of our sets and no set match: leave it
    return [c for c in pool if same_art(game, c.variant)]


def alt_prints(
    scx: dict[str, Any], lang: str, index: dict[tuple[str, str], list[OurCard]], game: str = "one-piece"
) -> list[tuple[OurCard, str]]:
    """Our alternate prints of this card with a matching Scrydex variant image."""
    number = normalise_number(str(scx.get("printed_number") or scx.get("number") or ""))
    expansion = (scx.get("expansion") or {}).get("name")
    out = []
    for c in index.get((lang, number), []):
        if same_art(game, c.variant) or not _names_match(c.name, str(scx.get("name") or "")):
            continue
        if expansion and c.set_name and not _sets_match(c.set_name, expansion):
            continue
        url = variant_image(scx, c.variant)
        if url:
            out.append((c, url))
    return out


def _update_card(conn: Conn, card_id: str, url: str, ref: str, source: str = SOURCE) -> int:
    return int(
        conn.execute(
            f"""update public.cards set image_url = %s, image_source = %s
                 where id = %s and {replaceable(source)} and image_url is distinct from %s""",
            (url, f"{source}:{ref}", card_id, url),
        ).rowcount
    )


def _due_expansions(
    conn: Conn, game: str, expansions: list[dict[str, Any]], now: datetime, recent_days: int, resync_days: int
) -> list[dict[str, Any]]:
    synced = {
        r["expansion_id"]: r["synced_at"]
        for r in conn.execute(
            "select expansion_id, synced_at from public.scrydex_expansions where game = %s", (game,)
        )
    }
    due = []
    for e in expansions:
        if lang_of(e) is None or not e.get("id"):
            continue
        last = synced.get(e["id"])
        released = _date(e.get("release_date"))
        recent = released is not None and released >= (now.date() - timedelta(days=recent_days))
        if last is None or recent or now - last >= timedelta(days=resync_days):
            due.append(e)
    # Never-synced first, then the newest releases.
    due.sort(key=lambda e: (e["id"] in synced, -(_date(e.get("release_date")) or date.min).toordinal()))
    return due


def _date(v: Any) -> date | None:
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10].replace("/", "-")) if v else None
    except ValueError:
        return None


def _mark_synced(conn: Conn, game: str, e: dict[str, Any], matched: int, now: datetime) -> None:
    conn.execute(
        """insert into public.scrydex_expansions (game, expansion_id, lang, name, release_date, synced_at, matched_cards)
           values (%s, %s, %s, %s, %s, %s, %s)
           on conflict (game, expansion_id) do update set name = excluded.name, release_date = excluded.release_date,
             synced_at = excluded.synced_at, matched_cards = excluded.matched_cards""",
        (
            game,
            e["id"],
            lang_of(e),
            str(e.get("name") or e["id"])[:200],
            _date(e.get("release_date")),
            now,
            matched,
        ),
    )


def sync_cards(
    conn: Conn, client: ScrydexClient, stats: ImageStats, *, now: datetime, recent_days: int, resync_days: int
) -> None:
    for game, scx_game in GAMES.items():
        expansions = client.expansions(scx_game)
        stats.expansions_listed += len(expansions)
        index = _load_cards(conn, game)
        for e in _due_expansions(conn, game, expansions, now, recent_days, resync_days):
            lang = lang_of(e)
            assert lang is not None
            matched = 0
            for scx in client.cards(scx_game, e["id"]):
                stats.cards_seen += 1
                url = front_image(scx)
                if not url:
                    continue
                item = {**scx, "expansion": scx.get("expansion") or e}
                card_lang = lang_of(scx) or lang
                targets = [(c, url) for c in match_card(item, card_lang, index, game)] + alt_prints(
                    item, card_lang, index, game
                )
                for card, image in targets:
                    if card.managed:
                        stats.cards_updated += _update_card(conn, card.id, image, str(scx.get("id")))
                        matched += 1
            _mark_synced(conn, game, e, matched, now)
            conn.commit()
            stats.expansions_synced += 1


def _load_sealed(conn: Conn) -> list[OurSealed]:
    return [
        OurSealed(r["id"], r["game"], r["lang"], r["name"], r["type"], r["managed"])
        for r in conn.execute(
            f"""select id::text as id, game, lang, name, type, {replaceable("scrydex")} as managed
                 from public.sealed_products"""
        )
    ]


def match_sealed(
    scx: dict[str, Any], game: str, ours: list[OurSealed], threshold: float = 0.6
) -> OurSealed | None:
    lang = lang_of(scx)
    name = str(scx.get("name") or "")
    kind = product_type(f"{scx.get('type') or ''} {name}")
    scored = []
    for p in ours:
        if p.game != game or p.lang != lang:
            continue
        if kind and p.type and kind != p.type and product_type(p.name) not in (None, kind):
            continue
        scored.append((similarity(name, p.name), p))
    scored.sort(key=lambda x: -x[0])
    if not scored or scored[0][0] < threshold:
        return None
    if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.1:
        return None  # two of ours look alike: don't guess
    return scored[0][1]


def sync_sealed(conn: Conn, client: ScrydexClient, stats: ImageStats) -> None:
    ours = _load_sealed(conn)
    if not ours:
        return
    for game, scx_game in GAMES.items():
        for scx in client.sealed(scx_game):
            stats.sealed_seen += 1
            url = front_image(scx)
            p = match_sealed(scx, game, ours) if url else None
            if p is None or not p.managed:
                continue
            stats.sealed_updated += conn.execute(
                f"""update public.sealed_products set image_url = %s, image_source = %s
                     where id = %s and {replaceable("scrydex")} and image_url is distinct from %s""",
                (url, f"{SOURCE}:{scx.get('id')}", p.id, url),
            ).rowcount
        conn.commit()


# ---------------------------------------------------------------- fallbacks
def _code_of(set_name: str, set_code: str) -> set[str]:
    """Set codes a set may go by: its own code and a 'SV2a:' style name prefix."""
    out = {re.sub(r"[^a-z0-9.]", "", set_code.lower())}
    m = re.match(r"^\s*([A-Za-z0-9.\-]{2,8})\s*:", set_name)
    if m:
        out.add(re.sub(r"[^a-z0-9.]", "", m.group(1).lower()))
    return {c for c in out if c and not c.startswith("jt")}


def _tcgdex_set_for(set_name: str, set_code: str, sets: list[dict[str, Any]]) -> dict[str, Any] | None:
    codes = _code_of(set_name, set_code)
    by_code = [t for t in sets if re.sub(r"[^a-z0-9.]", "", str(t["id"]).lower()) in codes]
    if len(by_code) == 1:
        return by_code[0]
    exact = [t for t in sets if _norm_set(t.get("name")) == _norm_set(set_name)]
    if len(exact) == 1:
        return exact[0]
    loose = [t for t in sets if _sets_match(t.get("name"), set_name)]
    return loose[0] if len(loose) == 1 else None


def fill_from_tcgdex(conn: Conn, client: TcgdexClient, stats: ImageStats) -> None:
    """Pokémon cards still without an image: find their set on TCGdex (by set
    code, else by name), then the card by number (and, in English, by name;
    TCGdex's Japanese names are in Japanese, so the set code + number decide)."""
    missing: dict[tuple[str, str, str], list[OurCard]] = defaultdict(list)
    for cards in _load_cards(conn, "pokemon").values():
        for c in cards:
            if c.managed and not c.has_image and c.lang in TCGDEX_LANGS:
                missing[(c.lang, c.set_name, c.set_code)].append(c)
    if not missing:
        return
    sets_by_lang: dict[str, list[dict[str, Any]]] = {}
    for (lang, set_name, set_code), cards in missing.items():
        tlang = TCGDEX_LANGS[lang]
        if tlang not in sets_by_lang:
            sets_by_lang[tlang] = client.sets(tlang)
        tset = _tcgdex_set_for(set_name, set_code, sets_by_lang[tlang])
        if tset is None:
            continue
        by_number: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for t in client.set_cards(tlang, str(tset["id"])):
            by_number[normalise_number(str(t.get("localId") or ""))].append(t)
        for c in cards:
            options = by_number.get(normalise_number(c.number), [])
            if lang == "en":
                options = [t for t in options if _names_match(c.name, str(t.get("name") or ""))]
            if len(options) != 1:
                continue
            url = card_image(options[0])
            if url:
                stats.cards_from_tcgdex += _update_card(conn, c.id, url, str(options[0].get("id")), "tcgdex")
        conn.commit()


def search_missing(conn: Conn, client: ScrydexClient, stats: ImageStats, cap: int) -> None:
    """Cards still without an image after the expansion sync: one Scrydex search
    each (one credit), up to ``cap`` a run, most valuable first."""
    rows = conn.execute(
        f"""select c.id::text as id, c.game, c.lang, c.number, c.name, c.variant, coalesce(s.name, '') as set_name
              from public.cards c left join public.sets s on s.id = c.set_id
              left join lateral (select max(f.floor_aud) as v from public.floor_prices f where f.card_id = c.id) f on true
             where c.image_url is null and not c.is_excluded and c.game in ('pokemon', 'one-piece')
               and {replaceable("scrydex").replace("image_source", "c.image_source")}
             order by f.v desc nulls last, c.name
             limit %s""",
        (cap,),
    ).fetchall()
    for r in rows:
        card = OurCard(r["id"], r["lang"], r["number"], r["name"], r["variant"], r["set_name"], True)
        index = {(card.lang, normalise_number(card.number)): [card]}
        name = str(r["name"]).replace('"', "")
        q = f'name:"{name}" number:"{r["number"].split("/")[0]}"'
        for scx in client.search_cards(GAMES[r["game"]], q):
            url = front_image(scx)
            lang = lang_of(scx)
            if not url or lang != card.lang:
                continue
            targets = [(c, url) for c in match_card(scx, lang, index, r["game"])] + alt_prints(
                scx, lang, index, r["game"]
            )
            if targets:
                stats.cards_from_search += _update_card(conn, card.id, targets[0][1], str(scx.get("id")))
                break
        conn.commit()


def fill_sealed_from_retailers(conn: Conn, stats: ImageStats) -> None:
    """Sealed products still without an image take the photo from one of their
    own linked store listings (an exact match): an official store first, then
    the most recently seen listing. Scrydex replaces it if it later has one."""
    stats.sealed_from_retailers += conn.execute(
        f"""update public.sealed_products sp set image_url = r.image_url, image_source = 'retailer:' || r.slug
              from (select distinct on (rp.sealed_product_id) rp.sealed_product_id, rp.image_url, re.slug
                      from public.retail_products rp join public.retailers re on re.id = rp.retailer_id
                     where rp.sealed_product_id is not null and rp.image_url like 'https://%%'
                       and not coalesce(rp.is_marketplace_seller, false)
                     order by rp.sealed_product_id, (re.kind = 'official') desc, rp.last_seen_at desc nulls last) r
             where sp.id = r.sealed_product_id and sp.image_url is null
               and {replaceable("retailer").replace("image_source", "sp.image_source")}"""
    ).rowcount
    conn.commit()


def coverage(conn: Conn) -> dict[str, Any]:
    """How many products have an image, overall and per game and language."""
    out: dict[str, Any] = {}
    for table, key in (("cards", "cards"), ("sealed_products", "sealed")):
        excluded = "where not is_excluded" if table == "cards" else ""
        rows = conn.execute(
            f"""select game, lang, count(*) as total, count(image_url) as with_image
                  from public.{table} {excluded} group by game, lang order by game, lang"""
        ).fetchall()
        total = sum(r["total"] for r in rows)
        done = sum(r["with_image"] for r in rows)
        out[key] = {
            "total": total,
            "with_image": done,
            "pct": round(100 * done / total, 1) if total else None,
            "by": {f"{r['game']}/{r['lang']}": f"{r['with_image']}/{r['total']}" for r in rows},
        }
    return out


def refresh_images(
    conn: Conn,
    env: Env,
    *,
    client: ScrydexClient | None = None,
    tcgdex: TcgdexClient | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Scrydex first (when its keys are set), then the free fallbacks, then a
    coverage report. Without Scrydex keys the free sources still run."""
    rules = load_rules(conn)
    extra = rules.extra
    now = now or datetime.now(UTC)
    if client is None and env.scrydex_api_key and env.scrydex_team_id:
        client = ScrydexClient(
            env.scrydex_api_key,
            env.scrydex_team_id,
            user_agent=env.user_agent,
            max_requests=int(extra.get("images.scrydex_max_requests_per_run", 1500)),
        )
    tcgdex = tcgdex or TcgdexClient(
        user_agent=env.user_agent, max_requests=int(extra.get("images.tcgdex_max_requests_per_run", 1000))
    )
    stats = ImageStats()
    with pipeline_run(conn, "images") as out:
        if client is not None:
            try:
                sync_sealed(conn, client, stats)
                sync_cards(
                    conn,
                    client,
                    stats,
                    now=now,
                    recent_days=int(extra.get("images.recent_days", 90)),
                    resync_days=int(extra.get("images.resync_days", 30)),
                )
            except BudgetExhausted:
                stats.stopped = "Scrydex request budget used"
                conn.commit()
            except ScrydexError as exc:
                if exc.status in (401, 403):
                    raise
                stats.stopped = str(exc)[:300]
                conn.commit()
        else:
            out["scrydex"] = "skipped: SCRYDEX_API_KEY / SCRYDEX_TEAM_ID not set"
        # Free fallbacks: never stop the run.
        try:
            fill_from_tcgdex(conn, tcgdex, stats)
        except TcgdexError as exc:
            conn.rollback()
            stats.errors["tcgdex"] = str(exc)[:300]
        fill_sealed_from_retailers(conn, stats)
        if client is not None and stats.stopped is None:
            try:
                search_missing(conn, client, stats, int(extra.get("images.scrydex_search_max_per_run", 300)))
            except (BudgetExhausted, ScrydexError) as exc:
                conn.commit()
                stats.errors["scrydex_search"] = str(exc)[:300]
        stats.requests = client.requests if client is not None else 0
        stats.tcgdex_requests = tcgdex.requests
        out.update({k: v for k, v in stats.__dict__.items() if v not in (None, {})})
        out["coverage"] = coverage(conn)
        log.info("images: %s", out)
    return out
