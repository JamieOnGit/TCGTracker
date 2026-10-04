"""Product images for every card and sealed product we list.

Each run (daily), best source first; a better source replaces a weaker
one's image, and an image set by hand is never touched:

1. **Scrydex** (paid, only when its keys are set): lists each game's
   expansions and fetches the cards of every expansion that is new, released
   in the last ``images.recent_days`` (90) or last synced over
   ``images.resync_days`` (30) ago, plus sealed products.
2. **TCGdex** (free): every Pokémon card, English and Japanese, from its full
   card lists.
3. **pokemontcg.io** (free): English Pokémon cards TCGdex has no image for
   (Shiny Vault, Trainer Gallery, Galarian Gallery, promos).
4. **Bandai's official card images**: One Piece prints, found through
   optcgapi.com's card list (optcgapi's own copy as the fallback).
5. A one-credit **Scrydex search** for each card still missing (keys only).
6. **TCGplayer**: the card's own product image, by the exact TCGplayer id
   JustTCG gives it (``images.tcgplayer_fallback``).
7. Sealed products without one take their own store listing's photo.

A card only takes an image when its number, name (where comparable) and set
agree, its printed set size doesn't contradict it, and the choice is unique:
a card missing from its own set is never given another set's image, and One
Piece alternate prints only take their own print's image. Image addresses
from Bandai and TCGplayer are checked before they are saved. Each run
reports coverage and the cards still on the default image.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from tcgworkers.config import Env
from tcgworkers.db import load_rules, pipeline_run
from tcgworkers.matching.matcher import normalise_name, normalise_number
from tcgworkers.sources.images.http import ImageChecker, OutOfBudget, SourceError
from tcgworkers.sources.images.optcg import OpPrint, OptcgClient, bandai_image
from tcgworkers.sources.images.pokemontcg import PokemonTcgClient
from tcgworkers.sources.images.pokemontcg import card_image as ptcg_image
from tcgworkers.sources.images.pokemontcg import query_for as ptcg_query
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
from tcgworkers.sources.images.tcgdex import set_of as tcgdex_set_of

# Where an image came from decides what may replace it, best first: Scrydex
# (licensed), the open databases and Bandai's own images, then the card's
# TCGplayer image, then (sealed products) a store's listing photo. Anything
# else (an image set by hand) is never touched.
AUTO_SOURCES = ("scrydex", "tcgdex", "pokemontcg", "bandai", "optcgapi", "tcgplayer", "retailer")


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
    game: str = "pokemon"
    image_source: str | None = None
    printed_total: str = ""
    tcgplayer_id: int | None = None


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
    cards_from_pokemontcg: int = 0
    cards_from_bandai: int = 0
    cards_from_tcgplayer: int = 0
    requests: int = 0
    tcgdex_requests: int = 0
    pokemontcg_requests: int = 0
    optcg_requests: int = 0
    image_checks: int = 0
    stopped: str | None = None
    errors: dict[str, str] = field(default_factory=dict)


def _load_cards(conn: Conn, game: str) -> dict[tuple[str, str], list[OurCard]]:
    by_key: dict[tuple[str, str], list[OurCard]] = defaultdict(list)
    for r in conn.execute(
        f"""select c.id::text as id, c.lang, c.number, c.name, c.variant, coalesce(s.name, '') as set_name,
                  coalesce(s.code, '') as set_code, {replaceable("scrydex")} as managed, c.image_url is not null as has_image,
                  c.image_source, coalesce(c.printed_total, '') as printed_total, c.tcgplayer_id
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
            game,
            r["image_source"],
            r["printed_total"],
            r["tcgplayer_id"],
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
# Free and official sources, for every card Scrydex hasn't given an image.
# Each one only fills cards whose image came from a weaker source (or none),
# and only when the match is certain: a card it can't place is left for the
# next source, ending with the card's own TCGplayer image.


def _rank(image_source: str | None) -> int:
    """Lower is better; no image is the weakest; a hand-set image ranks above all (-1)."""
    if image_source is None:
        return len(AUTO_SOURCES)
    prefix = image_source.split(":", 1)[0]
    return AUTO_SOURCES.index(prefix) if prefix in AUTO_SOURCES else -1


def wants(card: OurCard, source: str) -> bool:
    """Would an image from ``source`` improve this card's image?"""
    return _rank(card.image_source) > AUTO_SOURCES.index(source)


def _set_image(conn: Conn, card: OurCard, url: str, ref: str, source: str) -> int:
    n = _update_card(conn, card.id, url, ref, source)
    if n:
        card.image_source = f"{source}:{ref}"
        card.has_image = True
    return n


def _code(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


# Black Star promo sets by series, as TCGdex and pokemontcg.io code them.
_PROMO_SERIES = [
    (r"\b(sv|scarlet violet)\b", "svp"),
    (r"\b(swsh|sword shield)\b", "swshp"),
    (r"\b(sm|sun moon)\b", "smp"),
    (r"\bxy\b", "xyp"),
    (r"\b(bw|black white)\b", "bwp"),
    (r"\b(hgss|heartgold soulsilver)\b", "hgssp"),
    (r"\b(dp|diamond pearl)\b", "dpp"),
    (r"\b(me|mega evolution)\b", "mep"),
    (r"\bnintendo\b", "np"),
    (r"\b(wizards|wotc)\b", "basep"),
]


def _promo_code(set_name: str) -> str | None:
    """'SWSH: Sword & Shield Promo Cards' -> 'swshp'."""
    name = normalise_name(set_name)
    if "promo" not in name:
        return None
    return next((code for pattern, code in _PROMO_SERIES if re.search(pattern, name)), None)


def _code_of(set_name: str, set_code: str) -> set[str]:
    """Set codes a set may go by: its own code, a 'SV2a:' style name prefix,
    and the series code of a promo set. A bare series prefix ('SV: Prismatic
    Evolutions') is not a set code: 'SV' is also Supreme Victors' code."""
    out = {_code(set_code), _promo_code(set_name) or ""}
    m = re.match(r"^\s*([A-Za-z0-9.\-]{2,8})\s*:", set_name)
    if m and re.search(r"\d", m.group(1)):
        out.add(_code(m.group(1)))
    return {c for c in out if c and not c.startswith("jt")}


def set_score(card: OurCard, set_name: str, set_codes: tuple[str, ...]) -> int:
    """3: the source's set is the card's set (same code or name); 1: the names
    overlap ('Base Set (Shadowless)' and 'Base Set'); 0: a different set."""
    ours = _norm_set(card.set_name)
    if (ours and ours == _norm_set(set_name)) or _code_of(card.set_name, card.set_code) & {
        _code(x) for x in set_codes if x
    }:
        return 3
    return 1 if _sets_match(card.set_name, set_name) else 0


def recognises(card: OurCard, sets: Sequence[tuple[str, tuple[str, ...]]]) -> bool:
    """Does the source have the card's set? Then a match must come from it."""
    return any(set_score(card, name, codes) for name, codes in sets)


def _total_digits(value: Any) -> int | None:
    """'165' -> 165, 'SV122' -> 122, 'TG30' -> 30, '' -> None."""
    m = re.search(r"(\d+)\s*$", str(value or "").strip())
    return int(m.group(1)) if m else None


def printed_total(card: OurCard) -> int | None:
    """The card's set size as printed after the slash: printed_total, else '199/165' -> 165."""
    if card.printed_total.strip():
        return _total_digits(card.printed_total)
    return _total_digits(card.number.split("/", 1)[1]) if "/" in card.number else None


@dataclass(frozen=True)
class Candidate:
    """One source's image for a card, with what the source says about its set."""

    url: str
    ref: str
    set_name: str
    set_codes: tuple[str, ...]
    total: int | None


def pick(
    card: OurCard, candidates: list[Candidate], *, names_checked: bool, recognised: bool = False
) -> Candidate | None:
    """The one candidate the evidence points to, else None.

    Candidates already share the card's number (and name, when
    ``names_checked``). A different printed set size rules a candidate out,
    and so does a different set when the source has the card's set
    (``recognised``): a card missing from its own set is never taken from
    another. A matching set and set size count for a candidate; the
    best-scoring image must be unique. Without a name check (Japanese names
    differ), the set or the set size must also agree."""
    total = printed_total(card)
    scored: list[tuple[int, Candidate]] = []
    for c in candidates:
        in_set = set_score(card, c.set_name, c.set_codes)
        if recognised and not in_set:
            continue
        sizes_known = total is not None and c.total is not None
        # A different set size rules a candidate out, unless it is the card's
        # own set: a classic-collection reprint keeps its original '4/102'.
        if sizes_known and total != c.total and in_set < 3:
            continue
        scored.append((in_set + (2 if sizes_known and total == c.total else 0), c))
    if not scored:
        return None
    best = max(s for s, _ in scored)
    top = {c.url: c for s, c in scored if s == best}
    if len(top) != 1 or best < (0 if names_checked else 2):
        return None
    return next(iter(top.values()))


def number_key(number: str) -> str:
    """Card numbers as the sources compare them: normalise_number, and a
    Scarlet & Violet / Mega Evolution promo's 'SVP 085' is just 85."""
    n = normalise_number(number)
    m = re.fullmatch(r"(?:SVP|MEP)(\d+)", n)
    return str(int(m.group(1))) if m else n


def _all_cards(conn: Conn, game: str) -> list[OurCard]:
    return [c for cards in _load_cards(conn, game).values() for c in cards]


def fill_from_tcgdex(conn: Conn, client: TcgdexClient, cards: list[OurCard], stats: ImageStats) -> None:
    """Pokémon cards (English and Japanese) from TCGdex's full card lists (two
    requests a language). English cards match by number + name; Japanese names
    are in Japanese, so a Japanese card needs its set code or printed set size
    to agree as well."""
    for lang, tlang in TCGDEX_LANGS.items():
        targets = [c for c in cards if c.game == "pokemon" and c.lang == lang and wants(c, "tcgdex")]
        if not targets:
            continue
        sets = {str(s["id"]): s for s in client.sets(tlang)}
        set_names = [(str(s.get("name") or ""), (set_id,)) for set_id, s in sets.items()]
        by_number: dict[str, list[Candidate]] = defaultdict(list)
        names: dict[str, str] = {}
        for t in client.all_cards(tlang):
            url = card_image(t)
            local_id = str(t.get("localId") or "")
            set_id = tcgdex_set_of(str(t["id"]), local_id, set(sets))
            if not url or set_id is None:
                continue  # no image yet, or a TCG Pocket card
            s = sets[set_id]
            count = s.get("cardCount") or {}
            by_number[number_key(local_id)].append(
                Candidate(
                    url,
                    str(t["id"]),
                    str(s.get("name") or ""),
                    (set_id,),
                    _total_digits(count.get("official")) if isinstance(count, dict) else None,
                )
            )
            names[str(t["id"])] = str(t.get("name") or "")
        for c in targets:
            options = by_number.get(number_key(c.number), [])
            if lang == "en":
                options = [o for o in options if _names_match(c.name, names[o.ref])]
            chosen = pick(c, options, names_checked=lang == "en", recognised=recognises(c, set_names))
            if chosen:
                stats.cards_from_tcgdex += _set_image(conn, c, chosen.url, chosen.ref, "tcgdex")
        conn.commit()


def _number_forms(number: str) -> list[str]:
    """How a source may write our number: '004/102' -> ['004', '4'], 'TG01/TG30' -> ['TG01', 'TG1']."""
    raw = number.strip().lstrip("#").split("/")[0].strip()
    return [n for n in dict.fromkeys([raw, normalise_number(raw), number_key(raw)]) if n]


def fill_from_pokemontcg(
    conn: Conn, client: PokemonTcgClient, cards: list[OurCard], stats: ImageStats, batch: int = 10
) -> None:
    """English Pokémon cards TCGdex had no image for, from pokemontcg.io: one
    search per ``batch`` cards (by name and number), then the set decides."""
    targets = [c for c in cards if c.game == "pokemon" and c.lang == "en" and wants(c, "pokemontcg")]
    # Cards without any image first; then cards on the TCGplayer fallback.
    targets.sort(key=lambda c: c.has_image)
    if not targets:
        return
    try:
        set_names: list[tuple[str, tuple[str, ...]]] | None = [
            (str(s.get("name") or ""), (str(s.get("id") or ""), str(s.get("ptcgoCode") or "")))
            for s in client.sets()
        ]
    except OutOfBudget:
        raise
    except SourceError as exc:
        # The service is flaky: without its set list, only take a card from its own set.
        log.warning(
            "images: pokemontcg.io set list unavailable (%s); matching within each card's set only", exc
        )
        set_names = None
    failed = 0
    for i in range(0, len(targets), batch):
        chunk = targets[i : i + batch]
        try:
            found = client.search(ptcg_query([(c.name, _number_forms(c.number)) for c in chunk]))
        except OutOfBudget:
            raise
        except SourceError as exc:
            failed += 1
            stats.errors["pokemontcg"] = f"{failed} searches failed, last: {exc}"[:300]
            if failed >= 3:
                raise  # it's down: try again next run
            continue  # this batch failed after retries: the cards wait for the next run
        for c in chunk:
            options = [
                Candidate(
                    url,
                    str(f.get("id")),
                    str((f.get("set") or {}).get("name") or ""),
                    (
                        str((f.get("set") or {}).get("id") or ""),
                        str((f.get("set") or {}).get("ptcgoCode") or ""),
                    ),
                    _total_digits((f.get("set") or {}).get("printedTotal")),
                )
                for f in found
                if (url := ptcg_image(f))
                and number_key(str(f.get("number") or "")) == number_key(c.number)
                and _names_match(c.name, str(f.get("name") or ""))
            ]
            recognised = set_names is None or recognises(c, set_names)
            chosen = pick(c, options, names_checked=True, recognised=recognised)
            if chosen:
                stats.cards_from_pokemontcg += _set_image(conn, c, chosen.url, chosen.ref, "pokemontcg")
        conn.commit()


def art_key(variant: str) -> str:
    """One Piece variants that name the same kind of artwork compare equal:
    'parallel' is Bandai's word for an alternate art, and a manga print is
    always an alternate art ('manga-alt-art' == 'manga')."""
    words = {w for w in variant.lower().replace("alt-art", "alt").replace("parallel", "alt").split("-") if w}
    words.discard("art")
    if "manga" in words:
        words.discard("alt")
    return "-".join(sorted(words)) or "standard"


def op_print_for(card: OurCard, prints: list[OpPrint]) -> OpPrint | None:
    """The One Piece print (artwork) a card of ours is.

    Same number, name and kind of artwork. When the card's set is among the
    prints' sets, the print must come from it (the alternate art in one set
    is not the one reprinted in another). Otherwise the base art for a
    standard card, or the only print of that kind anywhere."""
    same = [
        p for p in prints if p.number == normalise_number(card.number) and _names_match(card.name, p.name)
    ]
    scores = {p.image_id: set_score(card, p.set_name, (p.set_code,)) for p in same}
    best = max(scores.values(), default=0)
    if best:
        in_set = [p for p in same if scores[p.image_id] == best]
        hits = {p.image_id: p for p in in_set if art_key(p.variant) == art_key(card.variant)}
        return next(iter(hits.values())) if len(hits) == 1 else None
    if art_key(card.variant) == "standard":
        return next((p for p in same if p.image_id.upper() == p.number.upper()), None)
    hits = {p.image_id: p for p in same if art_key(p.variant) == art_key(card.variant)}
    return next(iter(hits.values())) if len(hits) == 1 else None


def fill_one_piece(
    conn: Conn, client: OptcgClient, checker: ImageChecker, cards: list[OurCard], stats: ImageStats
) -> None:
    """One Piece cards from Bandai's official card images (the print found via
    optcgapi), else optcgapi's copy (English). Each address is checked first."""
    targets = [c for c in cards if c.game == "one-piece" and wants(c, "bandai")]
    if not targets:
        return
    by_number: dict[str, list[OpPrint]] = defaultdict(list)
    for op in client.prints():
        by_number[op.number].append(op)
    for c in sorted(targets, key=lambda c: c.has_image):
        p = op_print_for(c, by_number.get(normalise_number(c.number), []))
        if p is None:
            continue
        official = bandai_image(p.image_id, c.lang)
        if official and checker.ok(official):
            stats.cards_from_bandai += _set_image(conn, c, official, p.image_id, "bandai")
        elif c.lang == "en" and p.image and wants(c, "optcgapi") and checker.ok(p.image):
            stats.cards_from_bandai += _set_image(conn, c, p.image, p.image_id, "optcgapi")
    conn.commit()


def tcgplayer_image(product_id: int) -> str:
    return f"https://tcgplayer-cdn.tcgplayer.com/product/{product_id}_in_1000x1000.jpg"


def fill_from_tcgplayer(conn: Conn, checker: ImageChecker, cards: list[OurCard], stats: ImageStats) -> None:
    """The last resort: the card's own TCGplayer product image, by the exact
    product id JustTCG gives for it (no matching involved)."""
    for c in cards:
        if c.tcgplayer_id and wants(c, "tcgplayer"):
            url = tcgplayer_image(c.tcgplayer_id)
            if checker.ok(url):
                stats.cards_from_tcgplayer += _set_image(conn, c, url, str(c.tcgplayer_id), "tcgplayer")
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


def missing_cards(conn: Conn, limit: int = 40) -> dict[str, Any]:
    """Cards still on the default image (most valuable first), for the run log."""
    rows = conn.execute(
        """select c.game, c.lang, coalesce(s.name, '') as set_name, c.number, c.name, c.variant,
                  c.tcgplayer_id is not null as has_tcgplayer_id, count(*) over () as total
             from public.cards c left join public.sets s on s.id = c.set_id
             left join lateral (select max(f.floor_aud) as v from public.floor_prices f where f.card_id = c.id) f on true
            where c.image_url is null and not c.is_excluded
            order by f.v desc nulls last, c.game, c.lang, s.name, c.number
            limit %s""",
        (limit,),
    ).fetchall()
    return {
        "count": int(rows[0]["total"]) if rows else 0,
        "first": [
            f"{r['game']}/{r['lang']} {r['set_name']} #{r['number']} {r['name']}"
            + ("" if r["variant"] == "standard" else f" [{r['variant']}]")
            + ("" if r["has_tcgplayer_id"] else " (no TCGplayer id)")
            for r in rows
        ],
    }


def _setting(extra: dict[str, Any], key: str, default: int) -> int:
    try:
        return int(extra.get(key, default))
    except (TypeError, ValueError):
        return default


def refresh_images(
    conn: Conn,
    env: Env,
    *,
    client: ScrydexClient | None = None,
    tcgdex: TcgdexClient | None = None,
    pokemontcg: PokemonTcgClient | None = None,
    optcg: OptcgClient | None = None,
    checker: ImageChecker | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Scrydex first (when its keys are set), then the free and official
    sources, then each remaining card's TCGplayer image, then a coverage
    report. Without Scrydex keys everything else still runs; a source that
    fails is recorded and the run carries on with the next."""
    rules = load_rules(conn)
    extra = rules.extra
    now = now or datetime.now(UTC)
    if client is None and env.scrydex_api_key and env.scrydex_team_id:
        client = ScrydexClient(
            env.scrydex_api_key,
            env.scrydex_team_id,
            user_agent=env.user_agent,
            max_requests=_setting(extra, "images.scrydex_max_requests_per_run", 1500),
        )
    tcgdex = tcgdex or TcgdexClient(
        user_agent=env.user_agent, max_requests=_setting(extra, "images.tcgdex_max_requests_per_run", 1000)
    )
    pokemontcg = pokemontcg or PokemonTcgClient(
        user_agent=env.user_agent, max_requests=_setting(extra, "images.pokemontcg_max_requests_per_run", 120)
    )
    optcg = optcg or OptcgClient(user_agent=env.user_agent)
    checker = checker or ImageChecker(
        user_agent=env.user_agent, max_requests=_setting(extra, "images.max_image_checks_per_run", 3000)
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
                    recent_days=_setting(extra, "images.recent_days", 90),
                    resync_days=_setting(extra, "images.resync_days", 30),
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

        cards = _all_cards(conn, "pokemon") + _all_cards(conn, "one-piece")
        conn.commit()
        steps: list[tuple[str, Any]] = [
            ("tcgdex", lambda: fill_from_tcgdex(conn, tcgdex, cards, stats)),
            ("pokemontcg", lambda: fill_from_pokemontcg(conn, pokemontcg, cards, stats)),
            ("one_piece", lambda: fill_one_piece(conn, optcg, checker, cards, stats)),
        ]
        if client is not None and stats.stopped is None:
            cap = _setting(extra, "images.scrydex_search_max_per_run", 300)
            steps.append(("scrydex_search", lambda: search_missing(conn, client, stats, cap)))
        if extra.get("images.tcgplayer_fallback", True) is not False:
            # search_missing may have filled some: re-read which cards still need one.
            steps.append(
                (
                    "tcgplayer",
                    lambda: fill_from_tcgplayer(
                        conn, checker, _all_cards(conn, "pokemon") + _all_cards(conn, "one-piece"), stats
                    ),
                )
            )
        for name, step in steps:
            try:
                step()
            except (TcgdexError, SourceError, ScrydexError) as exc:
                # Keep what this source already saved; record why it stopped.
                conn.commit()
                stats.errors[name] = str(exc)[:300]
                log.warning("images: %s stopped: %s", name, exc)
        fill_sealed_from_retailers(conn, stats)

        stats.requests = client.requests if client is not None else 0
        stats.tcgdex_requests = tcgdex.requests
        stats.pokemontcg_requests = pokemontcg.requests
        stats.optcg_requests = optcg.requests
        stats.image_checks = checker.requests
        out.update({k: v for k, v in stats.__dict__.items() if v not in (None, {})})
        out["coverage"] = coverage(conn)
        out["missing_cards"] = missing_cards(conn)
        log.info("images: %s", out)
    return out
