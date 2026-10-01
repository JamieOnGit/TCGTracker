"""Product matcher: retail listing title -> ``sealed_products``.

Every store words the same box differently ("Pokemon TCG: Scarlet & Violet
151 Ultra Premium Collection", "[Sealed] SV 151 UPC"). Product pages group
listings by sealed product, so each title is normalised into

    (game, language, set, product type)

using the catalogue's ``sets`` (names, series and codes for both games and
languages, from the DB, topped up by ``BUILTIN_SETS`` for sets the DB hasn't
been seeded with yet) and the product-type keywords in ``TYPES``.

Rules, all deterministic:

* language: "Japanese" / "JP" / "Japan" (or the store's own JP category) ->
  ``jp``; Korean / Chinese / Thai / Indonesian -> unmatched (we only list EN
  and JP); otherwise ``en``.
* set: the longest set name / alias found in the title, or a set code
  (One Piece ``OP-09``/``EB-02``/``PRB-01``; Japanese Pokémon ``SV2a``/``M5``).
  A base set whose name is another match's series ("Scarlet & Violet" in
  "Scarlet & Violet 151") or that sits inside a longer match is dropped; two
  different sets left over is ambiguous -> unmatched.
* type: matched AFTER the set name is removed, so "Anime 25th Collection"
  (a set) is not read as a "collection" (a type).
* Low confidence - no recognised set, or no recognised type - leaves the
  listing unmatched (``sealed_product_id`` null) rather than guessing.
  Unmatched listings still alert; they just have no product page.

The DB side finds or creates the ``sealed_products`` row (``auto_created``),
and sets ``retail_products.sealed_product_id``, ``lang`` and
``match_confidence``. A listing an admin matched by hand
(``sealed_product_id`` set, ``match_confidence`` null) is never overwritten.

``python -m tcgworkers.drops.products --rematch [--retailer SLUG]`` re-runs the
matcher over stored listings (after a catalogue or matcher change).
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import psycopg

from tcgworkers.drops import rrp as rrp_mod
from tcgworkers.drops.filters import game_in_text

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]

MIN_CONFIDENCE = Decimal("0.700")


# ----------------------------------------------------------------- text
def plain(text: str) -> str:
    """Lowercase ASCII words: accents stripped, '&' -> 'and', punctuation -> space."""
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = t.replace("&", " and ").replace("'", "").replace("’", "")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", t).split())


def slugify(text: str) -> str:
    """Same result as the SQL ``public.slugify``."""
    t = unicodedata.normalize("NFKD", text.replace(".", " ").replace("'", ""))
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9]+", "-", t)).strip("-")


def _find(alias: str, text: str) -> tuple[int, int] | None:
    m = re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", text)
    return (m.start(), m.end()) if m else None


# ------------------------------------------------------------ catalogue
@dataclass(frozen=True)
class CatalogueSet:
    game: str
    lang: str
    code: str
    name: str
    series: str | None = None
    id: str | None = None  # sets.id; None for a BUILTIN_SETS entry the DB doesn't have yet
    aliases: tuple[str, ...] = ()

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.game, self.lang, self.code.lower())


# Sets retail titles commonly name, so matching works before the DB catalogue
# is fully seeded. DB rows win (same game, lang and code); their extra
# aliases are merged in. Pokémon EN codes follow the catalogue (pokemontcg.io
# ids); JP Pokémon and One Piece codes are the printed codes.
_SV = "Scarlet & Violet"
_SWSH = "Sword & Shield"
_ME = "Mega Evolution"
_POKEMON_EN: tuple[tuple[str, str, str | None, tuple[str, ...]], ...] = (
    ("swsh2", "Rebel Clash", _SWSH, ()),
    ("swsh3", "Darkness Ablaze", _SWSH, ()),
    ("swsh35", "Champion's Path", _SWSH, ("champions path",)),
    ("swsh4", "Vivid Voltage", _SWSH, ()),
    ("swsh45", "Shining Fates", _SWSH, ()),
    ("swsh5", "Battle Styles", _SWSH, ()),
    ("swsh6", "Chilling Reign", _SWSH, ()),
    ("swsh7", "Evolving Skies", _SWSH, ()),
    ("cel25", "Celebrations", _SWSH, ()),
    ("swsh8", "Fusion Strike", _SWSH, ()),
    ("swsh9", "Brilliant Stars", _SWSH, ()),
    ("swsh10", "Astral Radiance", _SWSH, ()),
    ("pgo", "Pokémon GO", _SWSH, ()),
    ("swsh11", "Lost Origin", _SWSH, ()),
    ("swsh12", "Silver Tempest", _SWSH, ()),
    ("swsh12pt5", "Crown Zenith", _SWSH, ()),
    ("sv1", "Scarlet & Violet", _SV, ()),
    ("sv2", "Paldea Evolved", _SV, ()),
    ("sv3", "Obsidian Flames", _SV, ()),
    ("sv3pt5", "151", _SV, ("sv 151", "sv151", "pokemon 151", "sv3 5")),
    ("sv4", "Paradox Rift", _SV, ()),
    ("sv4pt5", "Paldean Fates", _SV, ()),
    ("sv5", "Temporal Forces", _SV, ()),
    ("sv6", "Twilight Masquerade", _SV, ()),
    ("sv6pt5", "Shrouded Fable", _SV, ()),
    ("sv7", "Stellar Crown", _SV, ()),
    ("sv8", "Surging Sparks", _SV, ()),
    ("sv8pt5", "Prismatic Evolutions", _SV, ("prismatic evolution",)),
    ("sv9", "Journey Together", _SV, ()),
    ("sv10", "Destined Rivals", _SV, ()),
    ("zsv10pt5", "Black Bolt", _SV, ()),
    ("rsv10pt5", "White Flare", _SV, ()),
    ("me1", "Mega Evolution", _ME, ("mega evolutions",)),
    ("me2", "Phantasmal Flames", _ME, ()),
    ("me2pt5", "Ascended Heroes", _ME, ()),
)
_POKEMON_JP: tuple[tuple[str, str, str | None, tuple[str, ...]], ...] = (
    ("SV1S", "Scarlet ex", _SV, ()),
    ("SV1V", "Violet ex", _SV, ()),
    ("SV1a", "Triplet Beat", _SV, ()),
    ("SV2P", "Snow Hazard", _SV, ()),
    ("SV2D", "Clay Burst", _SV, ()),
    ("SV2a", "Pokémon Card 151", _SV, ("151",)),
    ("SV3", "Ruler of the Black Flame", _SV, ()),
    ("SV3a", "Raging Surf", _SV, ()),
    ("SV4K", "Ancient Roar", _SV, ()),
    ("SV4M", "Future Flash", _SV, ()),
    ("SV4a", "Shiny Treasure ex", _SV, ()),
    ("SV5K", "Wild Force", _SV, ()),
    ("SV5M", "Cyber Judge", _SV, ()),
    ("SV5a", "Crimson Haze", _SV, ()),
    ("SV6", "Mask of Change", _SV, ("transformation mask",)),
    ("SV6a", "Night Wanderer", _SV, ()),
    ("SV7", "Stellar Miracle", _SV, ()),
    ("SV7a", "Paradise Dragona", _SV, ()),
    ("SV8", "Super Electric Breaker", _SV, ()),
    ("SV8a", "Terastal Festival ex", _SV, ()),
    ("SV9", "Battle Partners", _SV, ()),
    ("SV9a", "Heat Wave Arena", _SV, ()),
    ("SV10", "The Glory of Team Rocket", _SV, ("glory of team rocket",)),
    ("SV11B", "Black Bolt", _SV, ()),
    ("SV11W", "White Flare", _SV, ()),
    ("M1L", "Mega Brave", "Mega", ()),
    ("M1S", "Mega Symphonia", "Mega", ()),
    ("M2", "Inferno X", "Mega", ()),
    ("M2a", "MEGA Dream ex", "Mega", ()),
    ("M5", "Abyss Eye", "Mega", ()),
)
_ONE_PIECE: tuple[tuple[str, str, str | None, tuple[str, ...]], ...] = (
    ("OP01", "Romance Dawn", None, ()),
    ("OP02", "Paramount War", None, ()),
    ("OP03", "Pillars of Strength", None, ()),
    ("OP04", "Kingdoms of Intrigue", None, ()),
    ("OP05", "Awakening of the New Era", None, ()),
    ("OP06", "Wings of the Captain", None, ()),
    ("OP07", "500 Years in the Future", None, ()),
    ("OP08", "Two Legends", None, ()),
    ("OP09", "Emperors in the New World", None, ()),
    ("OP10", "Royal Blood", None, ()),
    ("OP11", "A Fist of Divine Speed", None, ("fist of divine speed",)),
    ("OP12", "Legacy of the Master", None, ()),
    ("EB01", "Memorial Collection", None, ()),
    ("EB02", "Anime 25th Collection", None, ()),
    ("PRB01", "One Piece Card The Best", None, ("card the best",)),
    ("PRB02", "One Piece Card The Best Vol. 2", None, ("card the best vol 2", "the best vol 2")),
)


def _builtin() -> list[CatalogueSet]:
    out = [CatalogueSet("pokemon", "en", c, n, s, None, a) for c, n, s, a in _POKEMON_EN]
    out += [CatalogueSet("pokemon", "jp", c, n, s, None, a) for c, n, s, a in _POKEMON_JP]
    for lang in ("en", "jp"):
        out += [CatalogueSet("one-piece", lang, c, n, s, None, a) for c, n, s, a in _ONE_PIECE]
    return out


BUILTIN_SETS: tuple[CatalogueSet, ...] = tuple(_builtin())

# One Piece JP and EN share set codes; Pokémon's don't.
_SHARED_CODES = {"one-piece"}
_OP_CODE = re.compile(r"\b(op|eb|prb|st)\s?(\d{1,2})\b")


@dataclass
class _Alias:
    text: str
    set: CatalogueSet


@dataclass
class Catalogue:
    sets: list[CatalogueSet]
    _aliases: list[_Alias] = field(default_factory=list, init=False, repr=False)
    _by_key: dict[tuple[str, str, str], CatalogueSet] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        for s in self.sets:
            self._by_key[s.key] = s
            for a in _aliases_of(s):
                self._aliases.append(_Alias(a, s))
        self._aliases.sort(key=lambda a: -len(a.text))

    @classmethod
    def build(cls, db_sets: Iterable[CatalogueSet] = (), *, builtin: bool = True) -> Catalogue:
        merged: dict[tuple[str, str, str], CatalogueSet] = {
            s.key: s for s in (BUILTIN_SETS if builtin else ())
        }
        for s in db_sets:
            base = merged.get(s.key)
            extra = base.aliases if base else ()
            series = s.series or (base.series if base else None)
            merged[s.key] = replace(s, series=series, aliases=tuple(dict.fromkeys(s.aliases + extra)))
        return cls(list(merged.values()))

    def get(self, game: str, lang: str, code: str) -> CatalogueSet | None:
        return self._by_key.get((game, lang, code.lower()))

    def aliases(self) -> list[_Alias]:
        return self._aliases


def _aliases_of(s: CatalogueSet) -> list[str]:
    names = [s.name, *s.aliases]
    out: list[str] = []
    for n in names:
        p = plain(n)
        if not p:
            continue  # e.g. a JP set name in Japanese script: matched by code only
        out.append(p)
        if p.startswith("pokemon card "):
            out.append(p.removeprefix("pokemon card "))
        if p.endswith(" ex") and len(p.split()) > 2:
            out.append(p.removesuffix(" ex"))
        if s.series:
            out.append(f"{plain(s.series)} {p}")
    return [a for a in dict.fromkeys(out) if len(a) >= 3]


def _display_name(s: CatalogueSet, catalogue: Catalogue) -> str:
    """The set's name in Latin script (JP One Piece set names are stored in
    Japanese: use the EN set with the same code, else the code)."""
    if s.name.isascii() or plain(s.name):
        return s.name
    en = catalogue.get(s.game, "en", s.code)
    return en.name if en and plain(en.name) else s.code


# ---------------------------------------------------------------- types
@dataclass(frozen=True)
class SealedType:
    code: str
    label: str
    pattern: re.Pattern[str]
    specific: bool = True


def _t(code: str, label: str, pattern: str, specific: bool = True) -> SealedType:
    return SealedType(code, label, re.compile(pattern), specific)


# Checked in order: the first match wins, so specific phrases come first.
TYPES: tuple[SealedType, ...] = (
    _t(
        "pokemon-center-etb",
        "Pokémon Center Elite Trainer Box",
        r"\bpokemon cent(?:er|re) (?:exclusive )?(?:elite trainer box|etb)\b|\bpc etb\b",
    ),
    _t("etb", "Elite Trainer Box", r"\belite trainer box(?:es)?\b|\betbs?\b|\btrainer box\b"),
    _t("ultra-premium-collection", "Ultra-Premium Collection", r"\bultra premium collection\b|\bupc\b"),
    _t("super-premium-collection", "Super-Premium Collection", r"\bsuper premium collection\b|\bspc\b"),
    _t("booster-bundle", "Booster Bundle", r"\bbooster bundles?\b"),
    _t(
        "booster-box",
        "Booster Box",
        r"\bbooster (?:box|display)(?:es)?\b|\bdisplay box\b|\b(?:36|30|24|20|18|10) (?:booster )?packs? (?:box|display)\b"
        r"|\b(?:36|30|24|20|18|10) ?pks?\b",
    ),
    _t("build-and-battle-stadium", "Build & Battle Stadium", r"\bbuild (?:and )?battle stadium\b"),
    _t(
        "build-and-battle",
        "Build & Battle Box",
        r"\bbuild (?:and )?battle(?: box| kit)?\b|\bprerelease kit\b",
    ),
    _t("premium-collection", "Premium Collection", r"\bpremium (?:figure )?collection\b"),
    _t("mini-tin", "Mini Tin", r"\bmini tins?\b"),
    _t("tin", "Tin", r"\btins?\b"),
    _t("double-pack", "Double Pack", r"\bdouble packs?\b"),
    # A 3-pack blister and a single checklane blister are different products.
    _t(
        "three-pack-blister",
        "3-Pack Blister",
        r"\b(?:3|three)[ -]?(?:booster )?(?:packs? )?blisters?\b|\b(?:3|three)[ -]?(?:booster )?packs?\b",
    ),
    _t("blister", "Blister", r"\bblisters?\b|\bcheck ?lane\b"),
    _t("battle-deck", "Battle Deck", r"\bbattle decks?\b"),
    _t("starter-deck", "Starter Deck", r"\bstart(?:er)? decks?\b|\bstarter set\b|\btheme decks?\b"),
    _t(
        "collection",
        "Collection",
        r"\bcollection(?: box)?\b|\bex box\b|\bsurprise box\b|\bgift box\b|\bpremium box\b",
        specific=False,
    ),
    _t(
        "booster-pack",
        "Booster Pack",
        r"\bbooster packs?\b|\bsleeved boosters?\b|\bsingle pack\b|\bbooster\b|\bpacks?\b",
        specific=False,
    ),
    _t("booster-box", "Booster Box", r"\bdisplay\b", specific=False),
    # "Pikachu VMAX Box", "Battle Box": a boxed collection, not a booster box.
    _t("collection", "Collection", r"\bbox(?: set)?\b", specific=False),
)
TYPE_LABELS = {t.code: t.label for t in TYPES}
# sealed_products.type -> rrp_reference.product_type (the filters vocabulary)
RRP_TYPES = {"etb": "elite-trainer-box", "collection": "collection-box"}

# Removed before type matching: the game's own name, set-family phrases that
# aren't a packaging ("Premium Booster" is One Piece's PRB line) and fluff.
_NOISE = re.compile(
    r"\bpokemon (?:tcg|trading card game|card game)\b|\bone piece (?:card game|tcg)\b|\btrading card game\b"
    r"|\b(?:premium|extra|enhanced) booster\b|\bsealed\b|\bnew\b|\benglish\b|\bjapanese\b"
)
_CASE = re.compile(r"\bcases?\b|\bset of \d+\b|\bx\s?(?:[2-9]|\d{2,})\b|\b(?:[2-9]|\d{2,}) x\b")
_NOT_CASE = re.compile(r"\b(?:carry|deck|display|storage|acrylic) case\b")
_JP = re.compile(r"\b(?:japanese|japan|jp|jpn)\b")
_OTHER_LANG = re.compile(
    r"\b(?:korean|kr|chinese|simplified chinese|traditional chinese|s chinese|t chinese|thai|indonesian)\b"
)


# --------------------------------------------------------------- result
@dataclass(frozen=True)
class Match:
    game: str
    lang: str
    set: CatalogueSet
    product_type: str
    name: str
    slug: str
    confidence: Decimal

    @property
    def rrp_type(self) -> str:
        return RRP_TYPES.get(self.product_type, self.product_type)


@dataclass(frozen=True)
class Analysis:
    """What the matcher read from a title, matched or not."""

    lang: str | None
    game: str | None
    set: CatalogueSet | None
    product_type: str | None
    match: Match | None
    reason: str


def detect_lang(title: str, lang_hint: str | None = None) -> str | None:
    """'en', 'jp', or None for a language we don't list."""
    t = plain(title)
    if _OTHER_LANG.search(t):
        return None
    if _JP.search(t):
        return "jp"
    if lang_hint in ("en", "jp"):
        return lang_hint
    return "en"


def _op_codes(text: str) -> list[str]:
    return [f"{m.group(1).upper()}{int(m.group(2)):02d}" for m in _OP_CODE.finditer(text)]


@dataclass
class _Hit:
    set: CatalogueSet
    start: int
    end: int
    via_code: bool


def _find_sets(text: str, catalogue: Catalogue, *, game: str | None, lang: str) -> list[_Hit]:
    hits: list[_Hit] = []
    for a in catalogue.aliases():
        s = a.set
        if s.lang != lang or (game and s.game != game):
            continue
        span = _find(a.text, text)
        if span:
            hits.append(_Hit(s, span[0], span[1], False))
    # Printed set codes: One Piece (OP-09) and Japanese Pokémon (SV2a, M5).
    if game in (None, "one-piece"):
        for m in _OP_CODE.finditer(text):
            found = catalogue.get("one-piece", lang, f"{m.group(1).upper()}{int(m.group(2)):02d}")
            if found:
                hits.append(_Hit(found, m.start(), m.end(), True))
    if lang == "jp" and game in (None, "pokemon"):
        for s in catalogue.sets:
            if s.game == "pokemon" and s.lang == "jp":
                span = _find(s.code.lower(), text)
                if span:
                    hits.append(_Hit(s, span[0], span[1], True))
    return hits


def _resolve(hits: list[_Hit]) -> tuple[CatalogueSet | None, bool, str]:
    """Pick one set from the hits: (set, matched by code, reason)."""
    if not hits:
        return None, False, "no set recognised"
    names = [h for h in hits if not h.via_code]
    # Drop a name hit inside a longer one, and a base set named after another hit's series.
    series = {plain(h.set.series) for h in names if h.set.series}
    kept = [
        h
        for h in names
        if not any(
            o is not h
            and o.set.key != h.set.key
            and o.start <= h.start
            and h.end <= o.end
            and (o.end - o.start) > (h.end - h.start)
            for o in names
        )
        and not (plain(h.set.name) in series and any(o.set.key != h.set.key for o in names))
    ]
    by_name = {h.set.key: h.set for h in kept}
    by_code = {h.set.key: h.set for h in hits if h.via_code}
    if by_code:
        if len(by_code) > 1:
            return None, False, "several set codes"
        [(key, s)] = by_code.items()
        if by_name and key not in by_name:
            return (
                None,
                False,
                f"set code {s.code} disagrees with set name {next(iter(by_name.values())).name!r}",
            )
        return s, True, f"set code {s.code}"
    if len(by_name) > 1:
        longest = max(kept, key=lambda h: h.end - h.start)
        rivals = {h.set.key for h in kept if h.end - h.start == longest.end - longest.start}
        if len(rivals) > 1:
            return None, False, "ambiguous set name"
        return longest.set, False, f"set name {longest.set.name!r}"
    [s] = by_name.values()
    return s, False, f"set name {s.name!r}"


def _strip(text: str, s: CatalogueSet) -> str:
    """The title with the set's name/aliases/code removed (for type matching)."""
    for a in sorted(_aliases_of(s), key=len, reverse=True):
        text = re.sub(rf"(?<![a-z0-9]){re.escape(a)}(?![a-z0-9])", " ", text)
    text = re.sub(rf"(?<![a-z0-9]){re.escape(s.code.lower())}(?![a-z0-9])", " ", text)
    text = _OP_CODE.sub(" ", text) if s.game == "one-piece" else text
    return " ".join(text.split())


# Words that can sit between a series name and the product type without naming a set.
_FILLER = {
    "tcg",
    "pokemon",
    "the",
    "set",
    "expansion",
    "series",
    "and",
    "sv",
    "me",
    "swsh",
    "en",
    "eng",
    "au",
    # quantities ("Three Booster Blister", "Single Pack")
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "single",
    "double",
    "triple",
    "pack",
    "packs",
}


def _words_before_type(text: str) -> list[str]:
    """Meaningful words before the earliest product-type phrase in ``text``."""
    starts = [m.start() for t in TYPES if (m := t.pattern.search(text))]
    head = text[: min(starts)] if starts else text
    return [w for w in head.split() if not w.isdigit() and w not in _FILLER and len(w) > 1]


def product_type_of(text: str) -> SealedType | None:
    return next((t for t in TYPES if t.pattern.search(text)), None)


# A bare "Booster" listed at this price or more is a booster box (stores often
# drop the word: "Mega Evolutions Perfect Order Booster" at A$314.99).
BOOSTER_BOX_MIN_AUD = Decimal("100")


def analyse(
    title: str,
    catalogue: Catalogue,
    *,
    game_hint: str | None = None,
    lang_hint: str | None = None,
    price_aud: Decimal | None = None,
) -> Analysis:
    text = plain(title)
    lang = detect_lang(title, lang_hint)
    if lang is None:
        return Analysis(None, None, None, None, None, "language we don't list")
    named = game_in_text(title)
    if named is None and re.search(r"\bpokemon\b", text) and re.search(r"\bone piece\b", text):
        return Analysis(lang, None, None, None, None, "names both games")
    if named is None and _op_codes(text):
        named = "one-piece"
    game = named or game_hint

    lang_explicit = bool(_JP.search(text)) or lang_hint is not None
    hits = _find_sets(text, catalogue, game=game, lang=lang)
    if not hits and game in (None, "one-piece"):
        # One Piece JP and EN share codes and English set names.
        other = "en" if lang == "jp" else "jp"
        for h in _find_sets(text, catalogue, game="one-piece", lang=other):
            same = catalogue.get("one-piece", lang, h.set.code)
            hits.append(replace(h, set=same or replace(h.set, lang=lang, id=None)))
    if not hits and lang == "en" and not lang_explicit:
        # A JP-only code with no language word ("Pokémon TCG - M5 - Abyss Eye").
        jp = [h for h in _find_sets(text, catalogue, game=game, lang="jp") if h.via_code]
        if jp:
            hits, lang = jp, "jp"
    s, via_code, why = _resolve(hits)
    if s is None:
        return Analysis(lang, game, None, None, None, why)
    inferred = False
    if not via_code and s.series and plain(s.name) == plain(s.series):
        # "Mega Evolutions Chaos Rising Booster Box": the series name followed by
        # a set we don't know yet. Never file that under the series' base set
        # (it would merge different products onto one page): name the new set
        # from the words before the product type, or leave it unmatched.
        unknown = _words_before_type(_NOISE.sub(" ", _strip(text, s)))
        if unknown:
            if len(unknown) > 4:
                return Analysis(lang, game, None, None, None, "unrecognised set after the series name")
            label = " ".join(w.capitalize() for w in unknown)
            s = CatalogueSet(game=s.game, lang=s.lang, code=slugify(label), name=label, series=s.series)
            inferred, why = True, f"new set {label!r} after series {s.series!r}"
    if named and s.game != named:
        return Analysis(lang, named, s, None, None, f"set {s.name!r} is not {named}")
    game = s.game

    rest = _NOISE.sub(" ", _strip(text, s))
    if _CASE.search(rest) and not _NOT_CASE.search(rest):
        return Analysis(lang, game, s, None, None, "a case of several products")
    ptype = product_type_of(rest)
    if ptype is None:
        return Analysis(lang, game, s, None, None, "no product type recognised")
    if (
        ptype.code == "booster-pack"
        and not ptype.specific
        and price_aud is not None
        and price_aud >= BOOSTER_BOX_MIN_AUD
    ):
        ptype = next(t for t in TYPES if t.code == "booster-box")
    if s.game == "one-piece" and s.code.startswith("ST") and ptype.code != "starter-deck":
        return Analysis(lang, game, s, ptype.code, None, "starter deck code with another product type")

    confidence = Decimal("0.50")
    confidence += Decimal("0.30") if via_code else Decimal("0.25")
    confidence += Decimal("0.15") if ptype.specific else Decimal("0.08")
    if named or game_hint == s.game:
        confidence += Decimal("0.04")
    confidence = min(confidence, Decimal("0.99"))
    if inferred:
        confidence = min(confidence, Decimal("0.750"))
    if confidence < MIN_CONFIDENCE:
        return Analysis(lang, game, s, ptype.code, None, "low confidence")

    set_name = _display_name(s, catalogue)
    if s.game == "one-piece" and set_name != s.code:
        code = re.sub(r"^([A-Z]+)(\d+)$", r"\1-\2", s.code)
        set_name = f"{code} {set_name}"
    name = f"{set_name} {ptype.label}"
    match = Match(game, lang, s, ptype.code, name, slugify(name), confidence)
    return Analysis(lang, game, s, ptype.code, match, why)


def match_title(
    title: str, catalogue: Catalogue, *, game_hint: str | None = None, lang_hint: str | None = None
) -> Match | None:
    return analyse(title, catalogue, game_hint=game_hint, lang_hint=lang_hint).match


# ------------------------------------------------------------------- DB
def load_catalogue(conn: Conn) -> Catalogue:
    rows = conn.execute("select id::text as id, game, lang, code, name, series from public.sets").fetchall()
    return Catalogue.build(
        CatalogueSet(r["game"], r["lang"], r["code"], r["name"], r["series"], r["id"]) for r in rows
    )


def find_or_create_sealed(
    conn: Conn, match: Match, rrp_entries: Sequence[rrp_mod.RrpEntry] = (), *, now: datetime | None = None
) -> str:
    """The sealed_products id for this match, creating it (auto_created) if new."""
    now = now or datetime.now(UTC)
    if match.set.id:
        row = conn.execute(
            """select id::text as id from public.sealed_products
                where game = %s and lang = %s and set_id = %s and type = %s
                order by auto_created, created_at limit 1""",
            (match.game, match.lang, match.set.id, match.product_type),
        ).fetchone()
        if row:
            return str(row["id"])
    rrp = rrp_mod.lookup_rrp(
        rrp_entries, game=match.game, product_type=match.rrp_type, set_code=match.set.code, lang=match.lang
    )
    row = conn.execute(
        """insert into public.sealed_products
             (game, lang, set_id, type, name, slug, rrp_aud, auto_created, updated_by_matcher_at)
           values (%s, %s, %s, %s, %s, %s, %s, true, %s)
           on conflict (game, lang, slug) do nothing
           returning id::text as id""",
        (match.game, match.lang, match.set.id, match.product_type, match.name, match.slug, rrp, now),
    ).fetchone()
    if row is None:
        row = conn.execute(
            "select id::text as id from public.sealed_products where game = %s and lang = %s and slug = %s",
            (match.game, match.lang, match.slug),
        ).fetchone()
    assert row is not None
    return str(row["id"])


def apply_match(
    conn: Conn,
    retail_product_id: int,
    title: str,
    catalogue: Catalogue,
    rrp_entries: Sequence[rrp_mod.RrpEntry] = (),
    *,
    game_hint: str | None = None,
    lang_hint: str | None = None,
    price_aud: Decimal | None = None,
    now: datetime | None = None,
) -> Analysis | None:
    """Match one retail_products row and store the result. Returns None when
    the row was matched by hand (left alone)."""
    current = conn.execute(
        "select sealed_product_id, match_confidence from public.retail_products where id = %s",
        (retail_product_id,),
    ).fetchone()
    if current is None or (current["sealed_product_id"] is not None and current["match_confidence"] is None):
        return None
    a = analyse(title, catalogue, game_hint=game_hint, lang_hint=lang_hint, price_aud=price_aud)
    sealed = find_or_create_sealed(conn, a.match, rrp_entries, now=now) if a.match else None
    conn.execute(
        """update public.retail_products set
             sealed_product_id = %s, match_confidence = %s,
             lang = coalesce(%s, lang), game = coalesce(game, %s)
           where id = %s""",
        (
            sealed,
            a.match.confidence if a.match else None,
            a.lang if a.game else None,
            a.game,
            retail_product_id,
        ),
    )
    return a


def rematch(conn: Conn, *, retailer_slug: str | None = None) -> dict[str, int]:
    """Re-run the matcher over stored listings (skipping hand-matched ones)."""
    catalogue = load_catalogue(conn)
    rrp_entries = [
        rrp_mod.RrpEntry(r["game"], r["product_type"], r["rrp_aud"], r["lang"], r["set_code"])
        for r in conn.execute(
            "select game, lang, product_type, set_code, rrp_aud from public.rrp_reference"
        ).fetchall()
    ]
    rows = conn.execute(
        """select p.id, p.title, p.game, p.current_price_aud from public.retail_products p
             join public.retailers r on r.id = p.retailer_id
            where %(slug)s::text is null or r.slug = %(slug)s
            order by p.id""",
        {"slug": retailer_slug},
    ).fetchall()
    stats = {"listings": 0, "matched": 0, "unmatched": 0, "manual": 0}
    for r in rows:
        stats["listings"] += 1
        a = apply_match(
            conn,
            r["id"],
            r["title"],
            catalogue,
            rrp_entries,
            game_hint=r["game"],
            price_aud=r["current_price_aud"],
        )
        if a is None:
            stats["manual"] += 1
        elif a.match:
            stats["matched"] += 1
        else:
            stats["unmatched"] += 1
    stats["removed"] = prune_orphans(conn)
    return stats


def prune_orphans(conn: Conn) -> int:
    """Delete auto-created products nothing points at any more (after a rematch
    corrected a title), so no empty product pages are left behind."""
    row = conn.execute(
        """with gone as (
             delete from public.sealed_products s
              where s.auto_created
                and not exists (select 1 from public.retail_products p where p.sealed_product_id = s.id)
                and not exists (select 1 from public.drop_events e where e.sealed_product_id = s.id)
                and not exists (select 1 from public.product_watches w where w.sealed_product_id = s.id)
                and not exists (select 1 from public.sightings x where x.sealed_product_id = s.id)
             returning 1)
           select count(*) as n from gone"""
    ).fetchone()
    return int(row["n"]) if row else 0


def main(argv: list[str] | None = None) -> int:
    from tcgworkers.config import Env
    from tcgworkers.db import connect

    parser = argparse.ArgumentParser(prog="python -m tcgworkers.drops.products")
    parser.add_argument("--rematch", action="store_true", help="re-match stored retail listings")
    parser.add_argument("--retailer", metavar="SLUG", help="only this retailer's listings")
    parser.add_argument("title", nargs="*", help="titles to analyse (no database needed)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.title:
        catalogue = Catalogue.build()
        for t in args.title:
            a = analyse(t, catalogue)
            print(f"{t}\n  -> {a.match.slug if a.match else 'unmatched'} ({a.reason})")
        return 0
    if not args.rematch:
        parser.print_help()
        return 2
    env = Env.from_environ()
    if not env.database_url:
        log.error("DATABASE_URL is not set")
        return 2
    with connect(env.database_url) as conn:
        stats = rematch(conn, retailer_slug=args.retailer)
        conn.commit()
    log.info("rematch: %s", stats)
    return 0


if __name__ == "__main__":
    sys.exit(main())
