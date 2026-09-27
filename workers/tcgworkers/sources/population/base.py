"""Population ingestion is behind this interface so the provider (PSA API,
a PSA data licence, GemRate, a licensed CSV drop...) can be swapped without
touching the rest of the system (brief 4.3)."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class Licence:
    """What the upstream terms allow. Checked before anything is published:
    the public API and /data/ datasets only include redistributable sources."""

    display: bool
    redistribute: bool
    attribution: str
    terms_url: str
    reviewed_by: str | None = None  # who signed the terms review off


@dataclass(frozen=True)
class PopulationRecord:
    source: str
    spec_id: str  # the provider's identifier for the card (PSA SpecID etc.)
    grader: str
    grade: Decimal
    population: int
    captured_at: datetime


class PopulationSource(Protocol):
    name: str
    licence: Licence

    def fetch(self, spec_ids: Iterable[str]) -> Iterator[PopulationRecord]:
        """Yield per-grade populations for the given provider spec ids."""
        ...


class SourceNotApproved(RuntimeError):
    """Raised when a job tries to use a source Jamie hasn't approved yet."""
