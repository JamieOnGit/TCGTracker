"""TCG-only filtering (brief 9.2).

Include One Piece Card Game / Pokémon TCG sealed product; exclude plush,
video games, figures, apparel and accessories. The keyword lists come from
the editable ``watchlist`` table; DEFAULT_WATCHLIST mirrors its seed rows.
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


def classify(title: str, rules: Iterable[WatchRule] = DEFAULT_WATCHLIST) -> Classification:
    t = _norm(title)
    rules = list(rules)
    for r in rules:
        if r.kind == "exclude_keyword" and _norm(r.value).strip() in t:
            return Classification(False, None, None, None, f"excluded by {r.value!r}")

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
    if not reason:
        return Classification(False, None, None, None, "no TCG keyword")
    product_type = next((pt for pt, keys in _PRODUCT_TYPES if any(k in t for k in keys)), None)
    return Classification(True, game, set_code, product_type, reason)
