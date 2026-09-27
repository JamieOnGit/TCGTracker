"""Pricing sources sit behind this interface (brief 4.2).

No concrete source is wired up yet: the choice is waiting on Jamie's approval
of docs/research/02-pricing-sources.md. An adapter must:

* return JP and EN versions as separate records (``lang``),
* carry per-grade prices (at least PSA 10 and PSA 9),
* carry a stable ``external_id`` plus set code / number / variant for the
  matcher,
* timestamp every price, and declare its licence.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Protocol

from tcgworkers.sources.population.base import Licence


@dataclass(frozen=True)
class ExternalPrice:
    source: str
    external_id: str
    game: str
    lang: str
    set_code: str
    number: str
    variant: str | None
    name: str
    grader: str | None  # None = raw
    grade: Decimal | None
    type: str  # "ask" | "sold"
    price: Decimal
    currency: str
    observed_at: datetime
    url: str | None = None


class PricingSource(Protocol):
    name: str
    licence: Licence

    def fetch(self, since: datetime | None = None) -> Iterator[ExternalPrice]: ...
