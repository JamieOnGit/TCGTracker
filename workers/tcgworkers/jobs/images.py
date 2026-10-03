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
from tcgworkers.sources.population.base import SourceNotApproved

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
    managed: bool  # image unset or ours to update (from Scrydex)


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
    cards_ambiguous: int = 0
    sealed_seen: int = 0
    sealed_updated: int = 0
    requests: int = 0
    stopped: str | None = None
    errors: dict[str, str] = field(default_factory=dict)


def _load_cards(conn: Conn, game: str) -> dict[tuple[str, str], list[OurCard]]:
    by_key: dict[tuple[str, str], list[OurCard]] = defaultdict(list)
    for r in conn.execute(
        """select c.id::text as id, c.lang, c.number, c.name, c.variant, coalesce(s.name, '') as set_name,
                  (c.image_source is null or c.image_source like 'scrydex:%%') as managed
             from public.cards c left join public.sets s on s.id = c.set_id
            where c.game = %s""",
        (game,),
    ):
        card = OurCard(r["id"], r["lang"], r["number"], r["name"], r["variant"], r["set_name"], r["managed"])
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


def _update_card(conn: Conn, card_id: str, url: str, scx_id: str) -> int:
    return int(
        conn.execute(
            """update public.cards set image_url = %s, image_source = %s
            where id = %s and (image_source is null or image_source like 'scrydex:%%')
              and image_url is distinct from %s""",
            (url, f"{SOURCE}:{scx_id}", card_id, url),
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
            """select id::text as id, game, lang, name, type,
                      (image_source is null or image_source like 'scrydex:%%') as managed
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
                """update public.sealed_products set image_url = %s, image_source = %s
                    where id = %s and (image_source is null or image_source like 'scrydex:%%')
                      and image_url is distinct from %s""",
                (url, f"{SOURCE}:{scx.get('id')}", p.id, url),
            ).rowcount
        conn.commit()


def refresh_images(
    conn: Conn, env: Env, *, client: ScrydexClient | None = None, now: datetime | None = None
) -> dict[str, Any]:
    if client is None and not (env.scrydex_api_key and env.scrydex_team_id):
        raise SourceNotApproved("SCRYDEX_API_KEY and SCRYDEX_TEAM_ID are not set (Scrydex plan)")
    rules = load_rules(conn)
    extra = rules.extra
    now = now or datetime.now(UTC)
    client = client or ScrydexClient(
        env.scrydex_api_key or "",
        env.scrydex_team_id or "",
        user_agent=env.user_agent,
        max_requests=int(extra.get("images.scrydex_max_requests_per_run", 1500)),
    )
    stats = ImageStats()
    with pipeline_run(conn, "images") as out:
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
            stats.stopped = "request budget used"
            conn.commit()
        except ScrydexError as exc:
            if exc.status in (401, 403):
                raise
            stats.stopped = str(exc)[:300]
            conn.commit()
        stats.requests = client.requests
        out.update({k: v for k, v in stats.__dict__.items() if v not in (None, {})})
        out["source"] = SOURCE
        log.info("images: %s", out)
    return out
