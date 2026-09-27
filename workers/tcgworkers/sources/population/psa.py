"""PSA Public API client (https://api.psacard.com/publicapi).

Used for two things:

* **Cert lookup** for graded listings (brief 5.1): card, grade and SpecID
  from a cert number, to auto-fill the listing and flag mismatches.
* **Population by SpecID** (``/pop/GetPSASpecPopulation/{specID}``) behind
  the PopulationSource interface.

Both are DISABLED by default. See docs/research/01-psa-api.md: the free
quota is 100 calls/day (reportedly less now) and PSA's published terms only
allow personal, non-commercial use. ``PSA_POPULATION_ENABLED`` must stay
false until Jamie has a written licence covering commercial display.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from tcgworkers.sources.population.base import Licence, PopulationRecord, SourceNotApproved

BASE_URL = "https://api.psacard.com/publicapi"

# GetPSASpecPopulation returns one field per grade, e.g. Grade9, Grade8_5,
# Grade9Q (qualified). Qualified grades are kept apart from the plain grade.
_GRADE_FIELD = re.compile(r"^Grade(\d{1,2})(?:_(5))?$")


class PsaError(RuntimeError):
    pass


class PsaQuotaExceeded(PsaError):
    def __init__(self, retry_after: int | None, message: str) -> None:
        super().__init__(message)
        self.retry_after = retry_after


@dataclass(frozen=True)
class CertInfo:
    cert_number: str
    spec_id: str | None
    year: str | None
    brand: str | None
    subject: str | None
    card_number: str | None
    variety: str | None
    grade: Decimal | None
    grade_description: str | None
    raw: dict[str, Any]


def parse_grade(card_grade: str | None) -> Decimal | None:
    """'GEM MT 10' -> 10, 'NM-MT 8.5' -> 8.5, 'AUTHENTIC' -> None."""
    if not card_grade:
        return None
    m = re.search(r"(\d{1,2}(?:\.5)?)\s*$", card_grade.strip())
    return Decimal(m.group(1)) if m else None


def parse_spec_population(payload: dict[str, Any]) -> dict[Decimal, int]:
    """Per-grade PSA population (non-qualified grades only) from a
    PSASpecPopulationModel payload."""
    pop = payload.get("PSAPop") or {}
    out: dict[Decimal, int] = {}
    for key, value in pop.items():
        m = _GRADE_FIELD.match(key)
        if not m or value is None:
            continue
        whole, half = m.groups()
        grade = Decimal(whole) + (Decimal("0.5") if half else 0)
        out[grade] = int(value)
    return dict(sorted(out.items()))


class PsaClient:
    def __init__(self, token: str, *, http: httpx.Client | None = None) -> None:
        self._http = http or httpx.Client(base_url=BASE_URL, timeout=20)
        self._headers = {"Authorization": f"bearer {token}", "Accept": "application/json"}

    def _get(self, path: str) -> dict[str, Any]:
        r = self._http.get(path, headers=self._headers)
        if r.status_code == 429:
            retry = r.headers.get("retry-after")
            raise PsaQuotaExceeded(int(retry) if retry and retry.isdigit() else None, r.text[:200])
        if r.status_code >= 400:
            raise PsaError(f"PSA API {r.status_code} for {path}")
        data: dict[str, Any] = r.json()
        if data.get("IsValidRequest") is False:
            raise PsaError(data.get("ServerMessage") or "invalid request")
        return data

    def get_cert(self, cert_number: str) -> CertInfo | None:
        if not re.fullmatch(r"\d{6,12}", cert_number):
            raise ValueError("cert numbers are 6-12 digits")
        data = self._get(f"/cert/GetByCertNumber/{cert_number}")
        cert = data.get("PSACert")
        if not cert:
            return None
        return CertInfo(
            cert_number=str(cert.get("CertNumber") or cert_number),
            spec_id=str(cert["SpecID"]) if cert.get("SpecID") is not None else None,
            year=cert.get("Year"),
            brand=cert.get("Brand"),
            subject=cert.get("Subject"),
            card_number=cert.get("CardNumber"),
            variety=cert.get("Variety"),
            grade=parse_grade(cert.get("CardGrade")),
            grade_description=cert.get("GradeDescription"),
            raw=cert,
        )

    def get_spec_population(self, spec_id: str) -> dict[Decimal, int]:
        return parse_spec_population(self._get(f"/pop/GetPSASpecPopulation/{int(spec_id)}"))


class PsaPopulationSource:
    name = "psa-api"
    licence = Licence(
        display=False,  # flip only after a written licence (docs/research/01-psa-api.md)
        redistribute=False,
        attribution="Population data: PSA (Collectors Universe)",
        terms_url="https://www.collectors.com/terms",
    )

    def __init__(self, client: PsaClient, *, enabled: bool) -> None:
        self._client = client
        self._enabled = enabled

    def fetch(self, spec_ids: Iterable[str]) -> Iterator[PopulationRecord]:
        if not self._enabled:
            raise SourceNotApproved("PSA population ingestion is disabled pending a licence (brief 4.3)")
        now = datetime.now(UTC)
        for spec in spec_ids:
            for grade, population in self._client.get_spec_population(spec).items():
                yield PopulationRecord(self.name, spec, "PSA", grade, population, now)


@dataclass(frozen=True)
class CertCheck:
    """Result of comparing a seller's listing with the PSA cert."""

    verified: bool
    mismatch: bool
    reasons: tuple[str, ...]


def check_listing_against_cert(
    cert: CertInfo | None, *, listing_grade: Decimal, card_psa_spec_id: str | None, card_number: str
) -> CertCheck:
    """Flag a graded listing for admin review when the cert disagrees with it."""
    if cert is None:
        return CertCheck(False, True, ("cert not found",))
    reasons: list[str] = []
    if cert.grade is None or cert.grade != listing_grade:
        reasons.append(f"grade on cert is {cert.grade}, listing says {listing_grade}")
    if card_psa_spec_id and cert.spec_id and cert.spec_id != card_psa_spec_id:
        reasons.append(f"cert SpecID {cert.spec_id} is not this card's ({card_psa_spec_id})")
    elif not card_psa_spec_id and cert.card_number:
        from tcgworkers.matching.matcher import normalise_number

        if normalise_number(cert.card_number) != normalise_number(card_number):
            reasons.append(f"card number on cert is {cert.card_number}, listing is {card_number}")
    return CertCheck(verified=not reasons, mismatch=bool(reasons), reasons=tuple(reasons))
