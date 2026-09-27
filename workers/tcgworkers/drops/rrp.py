"""Retail-price logic (brief 9.4).

Each alert is tagged AT RRP / BELOW RRP / ABOVE RRP (+x%) against an editable
RRP reference table (rrp_reference). Third-party marketplace sellers on
retailer sites listing well above RRP can be suppressed.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from tcgworkers.drops.models import RrpTag


@dataclass(frozen=True)
class RrpEntry:
    game: str
    product_type: str
    rrp_aud: Decimal
    lang: str | None = None
    set_code: str | None = None


def lookup_rrp(
    entries: Iterable[RrpEntry],
    *,
    game: str,
    product_type: str | None,
    set_code: str | None,
    lang: str | None = None,
) -> Decimal | None:
    """Most specific match wins: set+lang > set > lang > product-type default."""
    if not product_type:
        return None
    best: tuple[int, Decimal] | None = None
    for e in entries:
        if e.game != game or e.product_type != product_type:
            continue
        if e.set_code is not None and (set_code is None or e.set_code.upper() != set_code.upper()):
            continue
        if e.lang is not None and e.lang != lang:
            continue
        specificity = (2 if e.set_code else 0) + (1 if e.lang else 0)
        if best is None or specificity > best[0]:
            best = (specificity, e.rrp_aud)
    return best[1] if best else None


def tag(
    price: Decimal | None, rrp: Decimal | None, *, tolerance_pct: Decimal
) -> tuple[RrpTag, Decimal | None]:
    """Returns (tag, delta_pct). Within +/- tolerance_pct of RRP counts as AT RRP."""
    if price is None or rrp is None or rrp <= 0:
        return RrpTag.UNKNOWN, None
    delta = ((price - rrp) / rrp * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    if abs(delta) <= tolerance_pct:
        return RrpTag.AT_RRP, delta
    return (RrpTag.ABOVE_RRP if delta > 0 else RrpTag.BELOW_RRP), delta


def label(rrp_tag: RrpTag, delta_pct: Decimal | None) -> str:
    """Human label used in emails and the drops feed."""
    if rrp_tag is RrpTag.ABOVE_RRP and delta_pct is not None:
        return f"ABOVE RRP (+{delta_pct.normalize():f}%)"
    return {RrpTag.AT_RRP: "AT RRP", RrpTag.BELOW_RRP: "BELOW RRP", RrpTag.UNKNOWN: "RRP UNKNOWN"}.get(
        rrp_tag, rrp_tag.value
    )


def should_suppress(
    *, is_marketplace_seller: bool, delta_pct: Decimal | None, suppress_above_pct: Decimal
) -> str | None:
    """Reason to suppress, or None. Only third-party sellers are suppressed:
    a retailer's own price rise is still news."""
    if is_marketplace_seller and delta_pct is not None and delta_pct > suppress_above_pct:
        return f"marketplace seller {delta_pct}% above RRP"
    return None
