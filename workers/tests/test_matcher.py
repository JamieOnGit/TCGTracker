from __future__ import annotations

import json
from decimal import Decimal as D

import pytest

from tcgworkers.matching.matcher import (
    CatalogueCard,
    ExternalRecord,
    Matcher,
    Status,
    normalise_number,
    normalise_set_code,
    normalise_variant,
)

from .conftest import RESEARCH

CATALOGUE = [
    CatalogueCard("pk-en-199", "pokemon", "en", "sv3pt5", "199", "sir", "Charizard ex", ("MEW",)),
    CatalogueCard("pk-en-006", "pokemon", "en", "sv3pt5", "6", "standard", "Charizard ex", ("MEW",)),
    CatalogueCard("pk-jp-201", "pokemon", "jp", "SV2a", "201", "sar", "Charizard ex"),
    CatalogueCard("op-en-119m", "one-piece", "en", "OP05", "OP05-119", "manga", "Monkey.D.Luffy"),
    CatalogueCard("op-en-119p", "one-piece", "en", "OP05", "OP05-119", "parallel", "Monkey.D.Luffy"),
    CatalogueCard("op-jp-119m", "one-piece", "jp", "OP05", "OP05-119", "manga", "Monkey.D.Luffy"),
]


def rec(game, lang, set_code, number, variant, name="Charizard ex", ext="x1"):
    return ExternalRecord("src", ext, game, lang, set_code, number, variant, name)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("199/165", "199"), ("#004", "4"), ("op05-119", "OP05-119"), ("SV-P 101", "SVP101"), ("TG05", "TG5")],
)
def test_normalise_number(raw, expected):
    assert normalise_number(raw) == expected


def test_normalise_set_and_variant():
    assert normalise_set_code("OP-05") == normalise_set_code("op05") == "OP05"
    assert normalise_variant("Special Illustration Rare") == "sir"
    assert normalise_variant("Manga Rare") == "manga"
    assert normalise_variant(None) == "standard"


def test_exact_match_is_auto_linked():
    d = Matcher(CATALOGUE).match(rec("pokemon", "en", "MEW", "199/165", "Special Illustration Rare"))
    assert d.status is Status.AUTO and d.card_id == "pk-en-199" and d.confidence >= D("0.95")


def test_jp_record_never_matches_an_en_card():
    # A JP Charizard priced under the EN set code must not land on the EN card.
    d = Matcher([c for c in CATALOGUE if c.lang == "en"]).match(rec("pokemon", "jp", "sv3pt5", "199", "sir"))
    assert d.status is Status.UNMATCHED and d.card_id is None


def test_jp_and_en_luffy_resolve_to_different_cards():
    m = Matcher(CATALOGUE)
    en = m.match(rec("one-piece", "en", "OP-05", "OP05-119", "Manga", "Monkey D. Luffy"))
    jp = m.match(rec("one-piece", "jp", "OP-05", "OP05-119", "Manga", "Monkey D. Luffy"))
    assert en.card_id == "op-en-119m" and jp.card_id == "op-jp-119m"


def test_variant_mismatch_goes_to_review_not_auto():
    d = Matcher(CATALOGUE).match(rec("one-piece", "en", "OP05", "OP05-119", "gold", "Monkey.D.Luffy"))
    assert d.status is Status.REVIEW
    assert any("variant" in r for r in d.reasons)


def test_ambiguous_match_goes_to_review():
    # No variant info: manga and parallel score the same -> a human decides.
    d = Matcher(CATALOGUE, auto_accept=D("0.7")).match(
        rec("one-piece", "en", "OP05", "OP05-119", "alt art", "Monkey.D.Luffy")
    )
    assert d.status is Status.REVIEW


def test_unknown_card_is_queued_unmatched():
    d = Matcher(CATALOGUE).match(rec("pokemon", "en", "sv1", "1", None, "Sprigatito"))
    assert d.status is Status.UNMATCHED


def test_research_sample_maps_one_to_one_when_available():
    """The 20-card sample from docs/research (5 per game/language) maps each
    record to its own catalogue card, and never across languages."""
    path = RESEARCH / "sample-20-cards.json"
    if not path.exists():
        pytest.skip("sample-20-cards.json not produced yet")
    sample = json.loads(path.read_text())
    catalogue = [
        CatalogueCard(
            f"{s['game']}-{s['lang']}-{i}",
            s["game"],
            s["lang"],
            s["set_code"],
            s["number"],
            s.get("variant") or "standard",
            s["name"],
        )
        for i, s in enumerate(sample)
    ]
    m = Matcher(catalogue)
    seen: set[str] = set()
    for i, s in enumerate(sample):
        d = m.match(
            ExternalRecord(
                s.get("source") or "sample",
                s.get("source_id") or str(i),
                s["game"],
                s["lang"],
                s["set_code"],
                s["number"],
                s.get("variant"),
                s["name"],
            )
        )
        assert d.card_id == f"{s['game']}-{s['lang']}-{i}", (s, d)
        assert d.status is Status.AUTO
        seen.add(d.card_id)
    assert len(seen) == len(sample)
    assert {(s["game"], s["lang"]) for s in sample} == {
        ("pokemon", "en"),
        ("pokemon", "jp"),
        ("one-piece", "en"),
        ("one-piece", "jp"),
    }
