"""Daily FX from the Reserve Bank of Australia, table F11.1.

RBA publishes indicative rates as "A$1 = x units of foreign currency" each
business day, licensed CC BY 4.0 (attribute "Reserve Bank of Australia").
We store the inverse, ``rate_to_aud``: 1 unit of foreign currency in AUD.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

F11_URL = "https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv"
SOURCE = "rba-f11"
WANTED = ("USD", "JPY", "EUR", "GBP", "NZD", "CNY", "HKD", "SGD", "CAD")


@dataclass(frozen=True)
class FxRate:
    currency: str
    date: date
    rate_to_aud: Decimal
    source: str = SOURCE


def parse_f11(text: str, currencies: tuple[str, ...] = WANTED) -> list[FxRate]:
    """Parse the F11.1 CSV into the latest rate per wanted currency."""
    latest: dict[str, FxRate] = {}
    for rate in parse_f11_history(text, currencies):
        if rate.currency not in latest or rate.date > latest[rate.currency].date:
            latest[rate.currency] = rate
    return sorted(latest.values(), key=lambda r: r.currency)


def parse_f11_history(text: str, currencies: tuple[str, ...] = WANTED) -> list[FxRate]:
    """Every dated rate in the F11.1 CSV (the current file covers the last few
    years), so historical prices convert at the rate of their own day."""
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    units = next((r for r in rows if r and r[0] == "Units"), None)
    if units is None:
        raise ValueError("F11 CSV has no Units row - format changed?")
    columns = {cur: i for i, cur in enumerate(units) if cur in currencies}

    out: list[FxRate] = []
    for row in rows:
        if not row:
            continue
        try:
            day = datetime.strptime(row[0], "%d-%b-%Y").date()
        except ValueError:
            continue
        for cur, i in columns.items():
            if i >= len(row) or not row[i].strip():
                continue
            try:
                per_aud = Decimal(row[i])
            except InvalidOperation:
                continue
            if per_aud <= 0:
                continue
            out.append(FxRate(cur, day, (Decimal(1) / per_aud).quantize(Decimal("0.00000001"))))
    return out


def to_aud(amount: Decimal, currency: str, rates: dict[str, FxRate]) -> tuple[Decimal, FxRate | None]:
    """Convert an amount to AUD. Returns the rate used so it can be stored
    with the price (brief 4.1: store original currency and the FX rate)."""
    if currency == "AUD":
        return amount.quantize(Decimal("0.01")), None
    rate = rates.get(currency)
    if rate is None:
        raise KeyError(f"no FX rate for {currency}")
    return (amount * rate.rate_to_aud).quantize(Decimal("0.01")), rate
