from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal as D

import pytest

from tcgworkers.config import Rules
from tcgworkers.market.floor import Basis, PricePoint, compute_floor
from tcgworkers.market.market_cap import RankRow, market_cap, pct_change, rank, total_market_cap

NOW = datetime(2026, 9, 27, 12, tzinfo=UTC)
RULES = Rules()


def pp(type_: str, price: str, source: str = "marketplace", days_ago: float = 0, excluded: bool = False):
    return PricePoint("card-1", "psa-10", type_, D(price), source, NOW - timedelta(days=days_ago), excluded)


# ----------------------------------------------------------------- market cap
def test_market_cap_is_population_times_floor():
    assert market_cap(3412, D("4850.00")) == D("16548200.00")


def test_market_cap_missing_inputs_is_none_not_zero():
    assert market_cap(None, D("10")) is None
    assert market_cap(10, None) is None


def test_market_cap_zero_population_is_zero():
    assert market_cap(0, D("10")) == D("0.00")


def test_market_cap_rejects_nonsense():
    with pytest.raises(ValueError):
        market_cap(-1, D("10"))
    with pytest.raises(ValueError):
        market_cap(1, D("0"))


def test_total_market_cap_sums_only_grades_with_both_inputs():
    by_grade = {"psa-10": (100, D("1000")), "psa-9": (400, D("200")), "psa-8": (900, None)}
    assert total_market_cap(by_grade) == D("180000.00")
    assert total_market_cap({"psa-10": (None, None)}) is None


def test_pct_change():
    assert pct_change(D("110"), D("100")) == D("10.0")
    assert pct_change(D("90"), D("100")) == D("-10.0")
    assert pct_change(D("90"), None) is None
    assert pct_change(D("90"), D("0")) is None


def test_rank_excludes_cards_without_data_and_shares_ties():
    rows = [
        RankRow("b", "psa-10", D("500")),
        RankRow("a", "psa-10", D("900")),
        RankRow("c", "psa-10", None),
        RankRow("d", "psa-10", D("500")),
        RankRow("e", "psa-10", D("100")),
    ]
    assert [(r, row.card_id) for r, row in rank(rows)] == [(1, "a"), (2, "b"), (2, "d"), (4, "e")]


# ----------------------------------------------------------------- floor price
def test_marketplace_ask_beats_external_even_if_external_is_lower():
    f = compute_floor([pp("ask", "5000"), pp("ask", "4800", "pricesrc")], now=NOW, rules=RULES)
    assert f and f.floor_aud == D("5000.00") and f.basis is Basis.MARKETPLACE_ASK and f.sample_size == 1


def test_external_ask_used_when_no_marketplace_listings():
    f = compute_floor([pp("ask", "4800", "pricesrc"), pp("ask", "4900", "pricesrc")], now=NOW, rules=RULES)
    assert f and f.floor_aud == D("4800.00") and f.basis is Basis.EXTERNAL_ASK and f.source == "pricesrc"
    assert f.sample_size == 2


def test_lowest_ask_wins():
    f = compute_floor([pp("ask", "5200"), pp("ask", "4999.99"), pp("ask", "6000")], now=NOW, rules=RULES)
    assert f and f.floor_aud == D("4999.99")


def test_outliers_far_below_sold_median_are_ignored():
    sales = [pp("sold", p, "pricesrc", days_ago=d) for p, d in (("5000", 1), ("5100", 5), ("4900", 10))]
    scam = pp("ask", "900")
    real = pp("ask", "5300")
    f = compute_floor([*sales, scam, real], now=NOW, rules=RULES)
    assert f and f.floor_aud == D("5300.00") and f.outliers_ignored == 1
    assert f.median_sold_30d_aud == D("5000.00")


def test_outlier_rule_needs_enough_sales_to_trust_the_median():
    sales = [pp("sold", "5000", "pricesrc", days_ago=1), pp("sold", "5100", "pricesrc", days_ago=2)]
    f = compute_floor([*sales, pp("ask", "900")], now=NOW, rules=RULES)
    assert f and f.floor_aud == D("900.00") and f.outliers_ignored == 0


def test_outlier_threshold_is_configurable():
    sales = [pp("sold", "1000", "pricesrc", days_ago=d) for d in (1, 2, 3)]
    ask = pp("ask", "700")
    assert compute_floor([*sales, ask], now=NOW, rules=RULES).floor_aud == D("700.00")  # 0.7 >= 0.5
    strict = Rules(market_outlier_min_ratio=D("0.8"))
    f = compute_floor([*sales, ask], now=NOW, rules=strict)
    assert f.basis is Basis.LAST_SALE and f.floor_aud == D("1000.00")


def test_falls_back_to_last_sale_when_no_valid_ask():
    f = compute_floor(
        [pp("sold", "4000", "pricesrc", days_ago=40), pp("sold", "4200", "pricesrc", days_ago=3)],
        now=NOW,
        rules=RULES,
    )
    assert f and f.basis is Basis.LAST_SALE and f.floor_aud == D("4200.00")
    assert f.last_sold_aud == D("4200.00") and f.median_sold_30d_aud == D("4200.00")


def test_no_data_means_no_floor():
    assert compute_floor([], now=NOW, rules=RULES) is None
    assert compute_floor([pp("ask", "10", excluded=True)], now=NOW, rules=RULES) is None


def test_admin_excluded_points_are_ignored():
    f = compute_floor([pp("ask", "100", excluded=True), pp("ask", "5000")], now=NOW, rules=RULES)
    assert f and f.floor_aud == D("5000.00")


def test_stale_external_asks_are_ignored():
    f = compute_floor(
        [pp("ask", "4000", "pricesrc", days_ago=30), pp("sold", "4500", "pricesrc", days_ago=2)],
        now=NOW,
        rules=RULES,
    )
    assert f and f.basis is Basis.LAST_SALE


def test_floor_refuses_mixed_cards():
    other = PricePoint("card-2", "psa-10", "ask", D("1"), "marketplace", NOW)
    with pytest.raises(ValueError):
        compute_floor([pp("ask", "5"), other], now=NOW, rules=RULES)


def test_rules_from_site_settings():
    r = Rules.from_settings({"market.outlier_min_ratio": 0.4, "drops.public_delay_minutes": 45, "x.y": 1})
    assert r.market_outlier_min_ratio == D("0.4") and r.drops_public_delay_minutes == 45
    assert r.extra == {"x.y": 1}
