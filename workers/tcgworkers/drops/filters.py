"""TCG-only filtering (brief 9.2).

Include One Piece Card Game / Pokémon TCG sealed product; exclude plush,
video games, figures, apparel and accessories. The keyword lists come from
the editable ``watchlist`` table; DEFAULT_WATCHLIST mirrors its seed rows.

Specialist stores' collections also mix in singles, graded slabs, live
breaks, LEGO and other games, and some are store-wide (``all``), so the
generic catalogue adapters also run ``non_sealed_reason`` over the title,
product type and tags before anything reaches the engine.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class WatchRule:
    kind: str  # include_keyword | exclude_keyword | set_code | sku | url
    value: str
    game: str | None = None
    priority: bool = False


DEFAULT_WATCHLIST: tuple[WatchRule, ...] = (
    WatchRule("include_keyword", "one piece card game", "one-piece"),
    WatchRule("include_keyword", "pokemon tcg", "pokemon"),
    WatchRule("include_keyword", "pokemon trading card game", "pokemon"),
    WatchRule("include_keyword", "elite trainer box", "pokemon"),
    WatchRule("include_keyword", "booster box"),
    WatchRule("include_keyword", "booster bundle", "pokemon"),
    WatchRule("include_keyword", "booster pack"),
    WatchRule("set_code", "OP-", "one-piece"),
    WatchRule("set_code", "EB-", "one-piece"),
    WatchRule("set_code", "PRB-", "one-piece"),
    WatchRule("set_code", "ST-", "one-piece"),
    WatchRule("exclude_keyword", "plush"),
    WatchRule("exclude_keyword", "figure"),
    WatchRule("exclude_keyword", "nintendo switch"),
    WatchRule("exclude_keyword", "video game"),
    WatchRule("exclude_keyword", "t-shirt"),
    WatchRule("exclude_keyword", "hoodie"),
    WatchRule("exclude_keyword", "costume"),
    WatchRule("exclude_keyword", "lego"),
    WatchRule("exclude_keyword", "sleeves"),
    WatchRule("exclude_keyword", "binder"),
)

_PRODUCT_TYPES = (
    ("elite-trainer-box", ("elite trainer box", " etb")),
    ("booster-box", ("booster box", "booster display", "display box")),
    ("booster-bundle", ("booster bundle",)),
    ("premium-collection", ("premium collection", "ultra premium collection", "upc")),
    ("starter-deck", ("starter deck", "start deck")),
    ("tin", (" tin",)),
    ("blister", ("blister", "checklane")),
    ("booster-pack", ("booster pack", "sleeved booster")),
    ("collection-box", ("collection box", " box")),
)


# Other card games: a store's "all" collection or a mixed TCG collection
# must never leak these into Pokémon / One Piece alerts.
OTHER_GAMES = (
    "yu-gi-oh",
    "yugioh",
    "magic the gathering",
    "magic: the gathering",
    "mtg",
    "lorcana",
    "digimon",
    "dragon ball",
    "flesh and blood",
    "weiss schwarz",
    "union arena",
    "star wars unlimited",
    "gundam card game",
    "battle spirits",
    "cardfight",
    "vanguard",
    "riftbound",
    "metazoo",
    "sorcery contested realm",
    "final fantasy tcg",
    "final fantasy trading card game",
    "grand archive",
    "altered tcg",
)

_NON_SEALED_TEXT: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(p), why)
    for p, why in (
        (r"\b\d{1,3}\s*/\s*\d{2,3}\b", "card number (a single)"),
        (r"\b(?:op|eb|st|prb)\d{2}-\d{3}\b", "card code (a single)"),
        (r"\bsingles?\b(?!\s*(?:booster\s*)?(?:pack|booster|blister|sleeved))", "single card"),
        (r"\b(?:psa|bgs|cgc|beckett|tag)\s*\d|\bgraded\b|\bslab\b", "graded card"),
        (r"\blive\s*break|\bgroup\s*break|\bbreaks?\b|\brip\s*(?:and|&|n)\s*ship", "break"),
        (r"\blego\b", "lego"),
        (r"\bplush", "plush"),
        (r"\bfigures?\b|\bfigurine", "figure"),
        (r"\bsleeves\b|\bplaymat|\bdeck\s*box|\bbinder\b|\bportfolio\b|\btoploader", "accessory"),
        (r"\bcard\s*protector|\bacrylic\b|\bmagnetic\b|\bstorage\s*box|\bdice\b", "accessory"),
        (r"\bempty\b|\bcode\s*cards?\b|\bonline\s*codes?\b|\bgift\s*card\b|\bproxy\b", "not sealed"),
        (r"\bunsealed\b|\bopened\b|\bresealed\b", "not sealed"),
        (r"\bmystery\b|\brepack|\bpack\s*fresh\s*bundle\b", "store repack"),
        (r"\bt-?shirt|\bhoodie|\bkeychain|\bkeyring|\bbackpack\b|\bvideo\s*game|\bnintendo\b", "merch"),
    )
)
_NON_SEALED_TAGS = frozenset(
    {
        "single",
        "singles",
        "single card",
        "single cards",
        "singles cards",
        "graded",
        "graded card",
        "graded cards",
        "slab",
        "live break",
        "live breaks",
        "break",
        "breaks",
        "lego",
        "plush",
        "accessories",
        "accessory",
    }
)


def _norm(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    return " " + "".join(c for c in t if not unicodedata.combining(c)).lower() + " "


@dataclass(frozen=True)
class Classification:
    is_tcg: bool
    game: str | None
    set_code: str | None
    product_type: str | None
    reason: str


def _plain(text: str) -> str:
    """Lowercase ASCII with punctuation (except - and /) folded to spaces."""
    t = _norm(text).replace("&", " and ")
    return " " + " ".join(re.sub(r"[^a-z0-9/\-]+", " ", t).split()) + " "


def other_game(text: str) -> str | None:
    t = _norm(text)
    return next((g for g in OTHER_GAMES if re.search(rf"(?<![a-z]){re.escape(g)}(?![a-z])", t)), None)


def non_sealed_reason(title: str, *, product_type: str = "", tags: Iterable[str] = ()) -> str | None:
    """Why a catalogue item is not Pokémon / One Piece sealed product, or None.

    Checks the title and the store's product type with the patterns above and
    the tags against an exact list (tags are free-form, so only unambiguous
    ones count)."""
    for text in (title, product_type):
        if not text:
            continue
        g = other_game(text)
        if g:
            return f"other game ({g})"
        t = _plain(text)
        for pattern, why in _NON_SEALED_TEXT:
            if pattern.search(t):
                return why
    for tag in tags:
        if _plain(tag).strip() in _NON_SEALED_TAGS:
            return f"tagged {tag!r}"
    return None


def game_in_text(text: str) -> str | None:
    """'pokemon' / 'one-piece' when the text names exactly one of our games."""
    t = _plain(text)
    pokemon = bool(re.search(r"\b(?:pokemon|ptcg)\b", t))
    one_piece = bool(re.search(r"\bone[\s-]?piece\b|\boptcg\b", t))
    if pokemon == one_piece:
        return None
    return "pokemon" if pokemon else "one-piece"


def classify(
    title: str, rules: Iterable[WatchRule] = DEFAULT_WATCHLIST, *, game_hint: str | None = None
) -> Classification:
    """``game_hint`` is the store's own categorisation of the product (see
    ``Observation.game_hint``): with it, a sealed product type in the title is
    enough ("Stellar Crown Mini Tin" in a Pokémon collection)."""
    t = _norm(title)
    rules = list(rules)
    for r in rules:
        if r.kind == "exclude_keyword" and _norm(r.value).strip() in t:
            return Classification(False, None, None, None, f"excluded by {r.value!r}")
    other = other_game(title)
    if other:
        return Classification(False, None, None, None, f"other game {other!r}")

    game: str | None = None
    reason = ""
    set_code: str | None = None
    m = re.search(r"\b(OP|EB|PRB|ST)[-\s]?(\d{1,2})\b", title, re.IGNORECASE)
    if m:
        set_code = f"{m.group(1).upper()}{int(m.group(2)):02d}"
    for r in rules:
        if r.kind == "include_keyword" and _norm(r.value).strip() in t:
            game = game or r.game
            reason = reason or f"included by {r.value!r}"
        elif r.kind == "set_code" and set_code and set_code.startswith(r.value.rstrip("-").upper()):
            game = game or r.game
            reason = reason or f"set code {set_code}"
    if game is None:
        if "pokemon" in t and ("card" in t or "tcg" in t):
            game, reason = "pokemon", reason or "pokemon + card"
        elif "one piece" in t and ("card" in t or set_code):
            game, reason = "one-piece", reason or "one piece + card"
    product_type = next((pt for pt, keys in _PRODUCT_TYPES if any(k in t for k in keys)), None)
    named = game_in_text(title)
    if not reason and product_type and (named or game_hint):
        reason = "game named + product type" if named else "store category + product type"
    if not reason:
        return Classification(False, None, None, None, "no TCG keyword")
    game = game or named or game_hint
    return Classification(True, game, set_code, product_type, reason)
