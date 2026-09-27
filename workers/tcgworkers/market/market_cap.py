"""Market cap maths (brief 4.1).

    market_cap(card, grade) = graded_population(card, grade) x floor_price(card, grade)

PSA 10 is the primary view. A card's optional *total* is the sum over the
grades we have both a population and a floor for, shown as a secondary metric.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

CENTS = Decimal("0.01")


def market_cap(population: int | None, floor_aud: Decimal | None) -> Decimal | None:
    """Population x floor, or None when either input is missing.

    A population of 0 gives a market cap of 0 - a real, rankable-last value
    distinct from "no data".
    """
    if population is None or floor_aud is None:
        return None
    if population < 0 or floor_aud <= 0:
        raise ValueError("population must be >= 0 and floor > 0")
    return (Decimal(population) * floor_aud).quantize(CENTS, rounding=ROUND_HALF_UP)


def total_market_cap(by_grade: Mapping[str, tuple[int | None, Decimal | None]]) -> Decimal | None:
    """Sum of per-grade market caps where both inputs exist; None if none do."""
    caps = [c for pop, floor in by_grade.values() if (c := market_cap(pop, floor)) is not None]
    return sum(caps, Decimal("0")) if caps else None


def pct_change(current: Decimal | None, previous: Decimal | None) -> Decimal | None:
    """Percentage change, rounded to 0.1. None when there is no baseline."""
    if current is None or previous is None or previous == 0:
        return None
    return ((current - previous) / previous * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class RankRow:
    card_id: str
    grade_key: str
    market_cap_aud: Decimal | None


def rank(rows: Iterable[RankRow]) -> list[tuple[int, RankRow]]:
    """Rank by market cap, descending. Rows without a market cap are excluded
    (brief 4.2: no data -> "-" and not ranked). Ties share a rank ("1224").
    card_id breaks ties for a stable order."""
    ranked = sorted(
        (r for r in rows if r.market_cap_aud is not None and r.market_cap_aud > 0),
        key=lambda r: (-(r.market_cap_aud or 0), r.card_id),
    )
    out: list[tuple[int, RankRow]] = []
    previous: Decimal | None = None
    current_rank = 0
    for i, row in enumerate(ranked, start=1):
        if row.market_cap_aud != previous:
            current_rank = i
            previous = row.market_cap_aud
        out.append((current_rank, row))
    return out
