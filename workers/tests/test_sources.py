from __future__ import annotations

from decimal import Decimal as D

import httpx
import pytest

from tcgworkers.sources.fx.rba import parse_f11, to_aud
from tcgworkers.sources.population.base import SourceNotApproved
from tcgworkers.sources.population.psa import (
    BASE_URL,
    PsaClient,
    PsaPopulationSource,
    PsaQuotaExceeded,
    check_listing_against_cert,
    parse_grade,
    parse_spec_population,
)

# Shapes follow docs/research/psa-swagger.json. Values are synthetic.
CERT = {
    "PSACert": {
        "CertNumber": "12345678",
        "SpecID": 11223344,
        "Year": "2023",
        "Brand": "POKEMON SV 151",
        "CardNumber": "199",
        "Subject": "CHARIZARD ex",
        "Variety": "SPECIAL ILLUSTRATION RARE",
        "CardGrade": "GEM MT 10",
        "GradeDescription": "GEM MINT",
        "TotalPopulation": 3412,
    }
}
POP = {
    "SpecID": 11223344,
    "Description": "2023 POKEMON SV 151 199 CHARIZARD ex",
    "PSAPop": {"Total": 5000, "Grade10": 3412, "Grade9": 1300, "Grade8_5": 0, "Grade9Q": 4, "Auth": 1},
}


def psa(handler):
    return PsaClient("token", http=httpx.Client(base_url=BASE_URL, transport=httpx.MockTransport(handler)))


def test_rba_f11_parses_latest_rate_as_aud_per_unit(fixtures):
    rates = {r.currency: r for r in parse_f11((fixtures / "fx/rba-f11-sample.csv").read_text())}
    assert {"USD", "JPY", "EUR"} <= set(rates)
    usd = rates["USD"]
    assert str(usd.date) == "2026-09-25"
    assert D("1.2") < usd.rate_to_aud < D("1.6")  # 1 USD is ~1.4 AUD
    amount, used = to_aud(D("100"), "USD", rates)
    assert used is usd and amount == (D("100") * usd.rate_to_aud).quantize(D("0.01"))
    assert to_aud(D("5"), "AUD", rates) == (D("5.00"), None)
    with pytest.raises(KeyError):
        to_aud(D("1"), "XYZ", rates)


def test_psa_grade_parsing():
    assert parse_grade("GEM MT 10") == D("10")
    assert parse_grade("NM-MT 8.5") == D("8.5")
    assert parse_grade("AUTHENTIC") is None


def test_psa_spec_population_is_per_grade_and_skips_qualifiers():
    assert parse_spec_population(POP) == {D("8.5"): 0, D("9"): 1300, D("10"): 3412}


def test_psa_cert_lookup_and_bearer_auth():
    def handler(req):
        assert req.headers["Authorization"] == "bearer token"
        assert req.url.path.endswith("/cert/GetByCertNumber/12345678")
        return httpx.Response(200, json=CERT)

    cert = psa(handler).get_cert("12345678")
    assert cert and cert.grade == D("10") and cert.spec_id == "11223344" and cert.card_number == "199"


def test_psa_quota_is_surfaced():
    def handler(req):
        return httpx.Response(429, headers={"retry-after": "76216"}, text="API calls quota exceeded!")

    with pytest.raises(PsaQuotaExceeded) as e:
        psa(handler).get_cert("12345678")
    assert e.value.retry_after == 76216


def test_psa_population_source_is_off_until_licensed():
    src = PsaPopulationSource(psa(lambda r: httpx.Response(200, json=POP)), enabled=False)
    assert src.licence.display is False and src.licence.redistribute is False
    with pytest.raises(SourceNotApproved):
        list(src.fetch(["11223344"]))
    enabled = PsaPopulationSource(psa(lambda r: httpx.Response(200, json=POP)), enabled=True)
    assert {(r.grade, r.population) for r in enabled.fetch(["11223344"])} == {
        (D("8.5"), 0),
        (D("9"), 1300),
        (D("10"), 3412),
    }


def test_cert_check_flags_mismatches_for_admin_review():
    def handler(req):
        return httpx.Response(200, json=CERT)

    cert = psa(handler).get_cert("12345678")
    ok = check_listing_against_cert(
        cert, listing_grade=D("10"), card_psa_spec_id="11223344", card_number="199"
    )
    assert ok.verified and not ok.mismatch
    wrong_grade = check_listing_against_cert(
        cert, listing_grade=D("9"), card_psa_spec_id=None, card_number="199"
    )
    assert wrong_grade.mismatch and "grade" in wrong_grade.reasons[0]
    wrong_card = check_listing_against_cert(
        cert, listing_grade=D("10"), card_psa_spec_id=None, card_number="201"
    )
    assert wrong_card.mismatch
    missing = check_listing_against_cert(None, listing_grade=D("10"), card_psa_spec_id=None, card_number="1")
    assert missing.mismatch and not missing.verified
