"""Floor price (brief 4.2).

Floor = the lowest current asking price for that exact card, language and
grade. Source priority:

1. active, approved listings on our marketplace, where any exist;
2. the approved external pricing source(s).

Guardrails:

* asks far below the recent sold median are ignored as likely scams/errors
  (``outlier_min_ratio`` x 30-day median, once there are at least
  ``outlier_min_sales`` sales to trust the median);
* excluded (admin-overridden) points are ignored;
* stale external asks are ignored;
* with no valid ask, fall back to the most recent sale, marked ``last_sale``;
* with no data at all, return ``None`` - the card shows "-" and is excluded
  from the ranking.

The methodology page documents exactly this function; keep them in step.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum
from statistics import median

from tcgworkers.config import Rules

MARKETPLACE = "marketplace"
CENTS = Decimal("0.01")


class Basis(StrEnum):
    MARKETPLACE_ASK = "marketplace_ask"
    EXTERNAL_ASK = "external_ask"
    LAST_SALE = "last_sale"


@dataclass(frozen=True)
class PricePoint:
    card_id: str
    grade_key: str
    type: str  # "ask" | "sold"
    price_aud: Decimal
    source: str
    observed_at: datetime
    is_excluded: bool = False
    source_ref: str | None = None


@dataclass(frozen=True)
class FloorResult:
    card_id: str
    grade_key: str
    floor_aud: Decimal
    basis: Basis
    source: str
    sample_size: int
    outliers_ignored: int
    observed_at: datetime
    last_sold_aud: Decimal | None
    last_sold_at: datetime | None
    median_sold_30d_aud: Decimal | None


def _q(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def compute_floor(points: Iterable[PricePoint], *, now: datetime, rules: Rules) -> FloorResult | None:
    """Compute the floor for ONE card+grade from all its price points."""
    pts = [p for p in points if not p.is_excluded]
    if not pts:
        return None
    keys = {(p.card_id, p.grade_key) for p in pts}
    if len(keys) != 1:
        raise ValueError(f"compute_floor expects one card+grade, got {sorted(keys)}")
    card_id, grade_key = next(iter(keys))

    sold = sorted((p for p in pts if p.type == "sold"), key=lambda p: p.observed_at, reverse=True)
    sold_30d = [p.price_aud for p in sold if p.observed_at >= now - timedelta(days=30)]
    median_30d = _q(Decimal(median(sold_30d))) if sold_30d else None
    last_sold = sold[0] if sold else None

    threshold: Decimal | None = None
    if median_30d is not None and len(sold_30d) >= rules.market_outlier_min_sales:
        threshold = median_30d * rules.market_outlier_min_ratio

    def valid_asks(candidates: list[PricePoint]) -> tuple[list[PricePoint], int]:
        if threshold is None:
            return candidates, 0
        kept = [p for p in candidates if p.price_aud >= threshold]
        return kept, len(candidates) - len(kept)

    market_asks = [p for p in pts if p.type == "ask" and p.source == MARKETPLACE]
    max_age = timedelta(days=rules.market_external_ask_max_age_days)
    external_asks = [
        p for p in pts if p.type == "ask" and p.source != MARKETPLACE and p.observed_at >= now - max_age
    ]

    def result(basis: Basis, best: PricePoint, sample_size: int, ignored: int) -> FloorResult:
        return FloorResult(
            card_id=card_id,
            grade_key=grade_key,
            floor_aud=_q(best.price_aud),
            basis=basis,
            source=best.source,
            sample_size=sample_size,
            outliers_ignored=ignored,
            observed_at=best.observed_at,
            last_sold_aud=_q(last_sold.price_aud) if last_sold else None,
            last_sold_at=last_sold.observed_at if last_sold else None,
            median_sold_30d_aud=median_30d,
        )

    ignored_total = 0
    for asks, basis in ((market_asks, Basis.MARKETPLACE_ASK), (external_asks, Basis.EXTERNAL_ASK)):
        kept, ignored = valid_asks(asks)
        ignored_total += ignored
        if kept:
            best = min(kept, key=lambda p: (p.price_aud, -p.observed_at.timestamp()))
            return result(basis, best, len(kept), ignored_total)

    if last_sold is not None:
        return result(Basis.LAST_SALE, last_sold, 1, ignored_total)
    return None
