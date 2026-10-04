"""Auto-matcher: external price/population records -> catalogue cards (brief 4.2).

Every external record must map to exactly one ``cards.id``. The matcher
compares game + language + set code + card number + variant (+ name as a weak
tie-breaker) and produces a confidence score:

* ``auto``      - confidence >= auto_accept and clearly ahead of the runner-up:
                  written to card_external_ids with match_method='auto'.
* ``review``    - a plausible candidate exists but we're not sure: goes to the
                  admin mapping queue with the suggestion.
* ``unmatched`` - nothing plausible: goes to the mapping queue with no
                  suggestion (an admin can pick a card or create one).

Nothing is ever silently dropped, and game and language are HARD gates: a
JP record can never be suggested for an EN card, however similar.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from decimal import Decimal
from difflib import SequenceMatcher
from enum import StrEnum

WEIGHTS = {
    "set": Decimal("0.35"),
    "number": Decimal("0.35"),
    "variant": Decimal("0.20"),
    "name": Decimal("0.10"),
}
CLEAR_MARGIN = Decimal("0.10")

# Variant synonyms seen across sources -> our canonical variant names.
_VARIANTS: dict[str, str] = {
    "": "standard",
    "normal": "standard",
    "standard": "standard",
    "base": "standard",
    "regular": "standard",
    "holo": "holo",
    "holofoil": "holo",
    "reverse": "reverse-holo",
    "reverse holo": "reverse-holo",
    "reverse-holo": "reverse-holo",
    "sir": "sir",
    "special illustration rare": "sir",
    "special illustration": "sir",
    "sar": "sar",
    "special art rare": "sar",
    "ar": "ar",
    "art rare": "ar",
    "illustration rare": "ir",
    "ir": "ir",
    "alt art": "alt-art",
    "alternate art": "alt-art",
    "alt-art": "alt-art",
    "aa": "alt-art",
    "parallel": "parallel",
    "p1": "parallel",
    "parallel rare": "parallel",
    "manga": "manga",
    "manga rare": "manga",
    "comic": "manga",
    "sp": "sp",
    "special": "sp",
    "promo": "promo",
    "full art": "full-art",
    "full-art": "full-art",
    "gold": "gold",
    "hyper rare": "gold",
    "ur": "ur",
    "sec": "sec",
    "secret rare": "sec",
}


def normalise_variant(value: str | None) -> str:
    key = re.sub(r"[\s_]+", " ", (value or "").strip().lower())
    return _VARIANTS.get(key, re.sub(r"[^a-z0-9]+", "-", key).strip("-") or "standard")


def normalise_number(value: str | None) -> str:
    """'199/165' -> '199', '#004' -> '4', 'op05-119' -> 'OP05-119', 'SV-P 101' -> 'SVP101'."""
    v = (value or "").strip().upper().lstrip("#")
    v = v.split("/")[0].strip()
    if re.fullmatch(r"[A-Z]{1,4}\d{1,3}-\d{1,3}", v):  # One Piece style: OP05-119, EB01-001, ST01-012
        return v
    v = re.sub(r"[\s-]+", "", v)
    m = re.fullmatch(r"([A-Z]*)(0*)(\d+)([A-Z]*)", v)
    if m:
        prefix, _zeros, digits, suffix = m.groups()
        return f"{prefix}{int(digits)}{suffix}"
    return v


def normalise_set_code(value: str | None) -> str:
    """'OP-05' -> 'OP05', 'sv3pt5' -> 'SV3PT5', 'SV2a' -> 'SV2A'."""
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def normalise_name(value: str | None) -> str:
    v = unicodedata.normalize("NFKD", value or "")
    v = "".join(ch for ch in v if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9ぁ-んァ-ン一-龥]+", " ", v).strip()


@dataclass(frozen=True, slots=True)  # slots: the import holds one per catalogue card
class CatalogueCard:
    id: str
    game: str
    lang: str
    set_code: str
    number: str
    variant: str
    name: str
    set_aliases: tuple[str, ...] = ()  # other codes sources use for this set, e.g. ("MEW", "SV3PT5")


@dataclass(frozen=True)
class ExternalRecord:
    source: str
    external_id: str
    game: str
    lang: str
    set_code: str
    number: str
    variant: str | None
    name: str


class Status(StrEnum):
    AUTO = "auto"
    REVIEW = "review"
    UNMATCHED = "unmatched"


@dataclass(frozen=True)
class MatchDecision:
    record: ExternalRecord
    status: Status
    card_id: str | None
    confidence: Decimal
    reasons: tuple[str, ...] = field(default_factory=tuple)


def score(record: ExternalRecord, card: CatalogueCard) -> tuple[Decimal, list[str]]:
    reasons: list[str] = []
    if record.game != card.game:
        return Decimal(0), ["game differs"]
    if record.lang != card.lang:
        return Decimal(0), ["language differs (JP and EN are separate cards)"]
    total = Decimal(0)
    card_sets = {normalise_set_code(card.set_code), *(normalise_set_code(a) for a in card.set_aliases)}
    if normalise_set_code(record.set_code) in card_sets:
        total += WEIGHTS["set"]
    else:
        reasons.append(f"set {record.set_code!r} != {card.set_code!r}")
    if normalise_number(record.number) == normalise_number(card.number):
        total += WEIGHTS["number"]
    else:
        reasons.append(f"number {record.number!r} != {card.number!r}")
    if normalise_variant(record.variant) == normalise_variant(card.variant):
        total += WEIGHTS["variant"]
    else:
        reasons.append(f"variant {record.variant!r} != {card.variant!r}")
    similarity = Decimal(
        str(round(SequenceMatcher(None, normalise_name(record.name), normalise_name(card.name)).ratio(), 3))
    )
    total += WEIGHTS["name"] * similarity
    if similarity < Decimal("0.8"):
        reasons.append(f"name similarity {similarity}")
    return total.quantize(Decimal("0.001")), reasons


class Matcher:
    def __init__(
        self,
        cards: Iterable[CatalogueCard],
        *,
        auto_accept: Decimal = Decimal("0.95"),
        review_floor: Decimal = Decimal("0.5"),
    ) -> None:
        self.auto_accept = auto_accept
        self.review_floor = review_floor
        self._by_game_lang: dict[tuple[str, str], list[CatalogueCard]] = defaultdict(list)
        for c in cards:
            self._by_game_lang[(c.game, c.lang)].append(c)

    def match(self, record: ExternalRecord) -> MatchDecision:
        candidates = self._by_game_lang.get((record.game, record.lang), [])
        scored = sorted(((score(record, c), c) for c in candidates), key=lambda x: x[0][0], reverse=True)
        if not scored or scored[0][0][0] < self.review_floor:
            return MatchDecision(
                record,
                Status.UNMATCHED,
                None,
                scored[0][0][0] if scored else Decimal(0),
                ("no plausible catalogue card",),
            )
        (best_score, best_reasons), best = scored[0]
        runner_up = scored[1][0][0] if len(scored) > 1 else Decimal(0)
        if best_score >= self.auto_accept and best_score - runner_up >= CLEAR_MARGIN:
            return MatchDecision(record, Status.AUTO, best.id, best_score, tuple(best_reasons))
        reasons = list(best_reasons)
        if best_score - runner_up < CLEAR_MARGIN:
            reasons.append(f"ambiguous: runner-up scored {runner_up}")
        return MatchDecision(record, Status.REVIEW, best.id, best_score, tuple(reasons))
