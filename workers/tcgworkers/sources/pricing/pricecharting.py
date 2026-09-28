"""PriceCharting pricing source (docs/research/07-retailers-pricing-ebay.md §D,
02-pricing-sources.md §5).

Data paths, in order of preference:
1. The daily CSV price guide per category (``pokemon-cards``,
   ``one-piece-cards``). The exact URL is only shown on the logged-in
   Subscription page, so it's a template: PRICECHARTING_CSV_URL_TEMPLATE
   (``{token}`` and ``{category}`` placeholders). At most one CSV call every
   10 minutes; the files are regenerated once a day.
2. The JSON API as a fallback: ``/api/product?id=`` for cards we've already
   mapped, ``/api/products?q=`` to find candidates for unmapped catalogue
   cards. At most 1 call per second.

Prices are integer US cents in the API and USD decimals in the CSV; both
become ``PcProduct.prices`` in cents. Field -> grade mapping (07 §D.7):

    manual-only-price   PSA 10          (the only PSA-specific column)
    bgs-10-price        BGS 10
    condition-17-price  CGC 10
    condition-18-price  SGC 10
    box-only-price      ANY 9.5  -> grade_key any-9.5
    graded-price        ANY 9    -> grade_key any-9   (PSA *or* BGS 9: NOT psa-9)
    new-price           ANY 8    -> grade_key any-8
    cib-price           ANY 7    -> grade_key any-7
    loose-price         raw (ungraded)

Licence (07 §D.9): data is for internal use unless PriceCharting grants a
commercial licence. Ingestion is never blocked; ``LICENCE.display`` follows
PRICECHARTING_DISPLAY_OK (default false) for whatever decides what's shown.
The token is a secret: it is never logged (see ``_redact``).
"""

from __future__ import annotations

import csv
import io
import logging
import os
import re
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from tcgworkers.matching.matcher import normalise_variant
from tcgworkers.sources.population.base import Licence
from tcgworkers.sources.pricing.base import ExternalPrice

log = logging.getLogger(__name__)

SOURCE = "pricecharting"
BASE_URL = "https://www.pricecharting.com"
CATEGORIES = ("pokemon-cards", "one-piece-cards")
DEFAULT_CSV_URL_TEMPLATE = f"{BASE_URL}/price-guide/download-custom?t={{token}}&category={{category}}"
API_MIN_INTERVAL = 1.0  # "limited to 1 call every second"
CSV_MIN_INTERVAL = 600.0  # "CSV calls are limited to one every 10 minutes"


def product_url(pc_id: str) -> str:
    """Attribution link PriceCharting asks for (07 §D.9)."""
    return f"{BASE_URL}/game/{pc_id}"


def licence(environ: dict[str, str] | None = None) -> Licence:
    e = os.environ if environ is None else environ
    return Licence(
        display=e.get("PRICECHARTING_DISPLAY_OK", "false").strip().lower() == "true",
        redistribute=False,
        attribution="Price data: PriceCharting (https://www.pricecharting.com/game/{id})",
        terms_url=f"{BASE_URL}/api-documentation",
        reviewed_by=None,
    )


# field -> (grader, grade); grader None = raw/ungraded
PRICE_FIELDS: dict[str, tuple[str | None, Decimal | None]] = {
    "manual-only-price": ("PSA", Decimal("10")),
    "bgs-10-price": ("BGS", Decimal("10")),
    "condition-17-price": ("CGC", Decimal("10")),
    "condition-18-price": ("SGC", Decimal("10")),
    "box-only-price": ("ANY", Decimal("9.5")),
    "graded-price": ("ANY", Decimal("9")),
    "new-price": ("ANY", Decimal("8")),
    "cib-price": ("ANY", Decimal("7")),
    "loose-price": (None, None),
}


# ------------------------------------------------------------------ parsing
@dataclass(frozen=True)
class ConsoleInfo:
    game: str | None
    lang: str | None
    set_name: str | None
    excluded_reason: str | None = None

    @property
    def excluded(self) -> bool:
        return self.excluded_reason is not None


_CONSOLE_RULES: tuple[tuple[str, str | None, str | None, str | None], ...] = (
    # prefix, game, lang, excluded reason (checked in order; longest first)
    ("One Piece Japanese Carddass", None, None, "One Piece Carddass is not the One Piece Card Game"),
    ("One Piece Carddass", None, None, "One Piece Carddass is not the One Piece Card Game"),
    ("One Piece Japanese ", "one-piece", "jp", None),
    ("One Piece ", "one-piece", "en", None),
    ("Pokemon Japanese ", "pokemon", "jp", None),
    ("Pokemon Chinese ", None, None, "Chinese cards are not tracked"),
    ("Pokemon Korean ", None, None, "Korean cards are not tracked"),
    ("Pokemon ", "pokemon", "en", None),
)


def parse_console(console_name: str) -> ConsoleInfo:
    """'Pokemon Japanese Scarlet & Violet 151' -> pokemon / jp / 'Scarlet & Violet 151'."""
    name = " ".join((console_name or "").split())
    for prefix, game, lang, reason in _CONSOLE_RULES:
        if name.lower() == prefix.strip().lower() and not reason:
            return ConsoleInfo(None, None, None, "console has no set name")
        if name.lower().startswith(prefix.lower()):
            if reason:
                return ConsoleInfo(None, None, None, reason)
            set_name = name[len(prefix) :].strip()
            if not set_name:
                return ConsoleInfo(None, None, None, "console has no set name")
            return ConsoleInfo(game, lang, set_name)
    return ConsoleInfo(None, None, None, "not a Pokemon or One Piece console")


@dataclass(frozen=True)
class ProductName:
    name: str
    number: str | None
    variant_text: str | None  # the [bracket] text as PriceCharting wrote it
    variant: str  # our canonical variant


def normalise_pc_variant(parts: Iterable[str]) -> str:
    """'[Alternate Art Manga]' / '[Manga Alternate Art]' -> 'manga-alt-art';
    '[Alternate Art]' -> 'alt-art'; '[Manga]' -> 'manga'; others via the matcher."""
    out: list[str] = []
    for raw in parts:
        t = " ".join(raw.lower().split())
        alt = "alternate art" in t or "alt art" in t
        if "manga" in t and alt:
            out.append("manga-alt-art")
        elif "manga" in t:
            out.append("manga")
        elif alt:
            out.append("alt-art")
        else:
            out.append(normalise_variant(t))
    out = [v for v in out if v != "standard"]
    return "-".join(out) if out else "standard"


_BRACKETS = re.compile(r"\[([^\]]*)\]")
_NUMBER = re.compile(r"#\s*([A-Za-z0-9][A-Za-z0-9\-/]*)\s*$")


def parse_product_name(product_name: str) -> ProductName:
    """'Monkey.D.Luffy [Alternate Art Manga] #OP05-119' -> ('Monkey.D.Luffy', 'OP05-119', 'manga-alt-art')."""
    text = " ".join((product_name or "").split())
    number = None
    if m := _NUMBER.search(text):
        number = m.group(1).upper() if re.search(r"[A-Za-z]", m.group(1)) else m.group(1)
        text = text[: m.start()].strip()
    brackets = [b.strip() for b in _BRACKETS.findall(text) if b.strip()]
    name = " ".join(_BRACKETS.sub(" ", text).split())
    return ProductName(
        name=name,
        number=number,
        variant_text=" ".join(brackets) or None,
        variant=normalise_pc_variant(brackets),
    )


def _cents_from_decimal(value: Any) -> int | None:
    """CSV price '$1,234.56' / '1234.56' / '' -> 123456 cents (None when empty or zero)."""
    s = str(value or "").strip().replace("$", "").replace(",", "")
    if not s:
        return None
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    cents = int((d * 100).to_integral_value())
    return cents if cents > 0 else None


def _cents_from_int(value: Any) -> int | None:
    """API price 1732 -> 1732 (None when missing or zero; the API may omit or zero unpriced keys)."""
    try:
        cents = int(value)
    except (TypeError, ValueError):
        return _cents_from_decimal(value)  # tolerate '17.32'
    return cents if cents > 0 else None


@dataclass(frozen=True)
class PcProduct:
    id: str
    console_name: str
    product_name: str
    prices: dict[str, int] = field(default_factory=dict)  # PRICE_FIELDS key -> USD cents
    release_date: str | None = None
    tcg_id: str | None = None
    sales_volume: str | None = None

    def payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "console-name": self.console_name,
            "product-name": self.product_name,
            "release-date": self.release_date,
            "tcg-id": self.tcg_id,
            "sales-volume": self.sales_volume,
            "url": product_url(self.id),
        }


def _product(row: dict[str, Any], cents: Callable[[Any], int | None]) -> PcProduct | None:
    pc_id = str(row.get("id") or "").strip()
    if not pc_id:
        return None
    prices = {k: c for k in PRICE_FIELDS if (c := cents(row.get(k))) is not None}
    return PcProduct(
        id=pc_id,
        console_name=str(row.get("console-name") or "").strip(),
        product_name=str(row.get("product-name") or "").strip(),
        prices=prices,
        release_date=(str(row["release-date"]) if row.get("release-date") else None),
        tcg_id=(str(row["tcg-id"]) if row.get("tcg-id") else None),
        sales_volume=(str(row["sales-volume"]) if row.get("sales-volume") not in (None, "") else None),
    )


def parse_csv(text: str) -> Iterator[PcProduct]:
    """Columns are matched by NAME (the API key names), never by position."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if not reader.fieldnames or "id" not in reader.fieldnames or "product-name" not in reader.fieldnames:
        raise ValueError(f"not a PriceCharting CSV (columns: {reader.fieldnames!r})")
    for row in reader:
        p = _product(row, _cents_from_decimal)
        if p:
            yield p


def product_from_api(obj: dict[str, Any]) -> PcProduct | None:
    return _product(obj, _cents_from_int)


# ------------------------------------------------------------------- client
class PriceChartingError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class PriceChartingClient:
    token: str
    csv_url_template: str = DEFAULT_CSV_URL_TEMPLATE
    user_agent: str = "TCGTradeBot/1.0 (+https://tcgtrade.com.au/about/bot/)"
    transport: httpx.BaseTransport | None = None
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    api_calls: int = 0

    def __post_init__(self) -> None:
        self._http = httpx.Client(
            timeout=120,
            headers={"User-Agent": self.user_agent},
            transport=self.transport,
            follow_redirects=True,
        )
        self._last_api = -1e9
        self._last_csv = -1e9

    def _redact(self, text: str) -> str:
        return text.replace(self.token, "***") if self.token else text

    def _wait(self, last: float, interval: float) -> None:
        wait = last + interval - self.clock()
        if wait > 0:
            self.sleep(wait)

    def _get(self, url: str) -> httpx.Response:
        try:
            r = self._http.get(url)
        except httpx.HTTPError as exc:
            raise PriceChartingError(self._redact(f"{type(exc).__name__}: {exc}")) from exc
        if r.status_code >= 400:
            raise PriceChartingError(
                self._redact(f"HTTP {r.status_code} from {r.url.path}: {r.text[:200]}"), status=r.status_code
            )
        return r

    def download_csv(self, category: str) -> str:
        self._wait(self._last_csv, CSV_MIN_INTERVAL)
        url = self.csv_url_template.format(token=self.token, category=category)
        try:
            r = self._get(url)
        finally:
            self._last_csv = self.clock()
        text = r.text
        if "<html" in text[:500].lower():
            raise PriceChartingError(
                f"CSV download for {category} returned HTML (check PRICECHARTING_CSV_URL_TEMPLATE)"
            )
        return text

    def _api(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        self._wait(self._last_api, API_MIN_INTERVAL)
        query = httpx.QueryParams({"t": self.token, **params})
        try:
            r = self._get(f"{BASE_URL}{path}?{query}")
        finally:
            self._last_api = self.clock()
            self.api_calls += 1
        body = r.json()
        if not isinstance(body, dict) or body.get("status") != "success":
            raise PriceChartingError(self._redact(f"API error: {str(body)[:200]}"))
        return body

    def product(self, pc_id: str) -> PcProduct | None:
        return product_from_api(self._api("/api/product", {"id": pc_id}))

    def search(self, q: str) -> list[PcProduct]:
        body = self._api("/api/products", {"q": q})
        return [
            p for obj in body.get("products") or [] if isinstance(obj, dict) and (p := product_from_api(obj))
        ]


# ------------------------------------------------------------------- source
class PriceChartingSource:
    """``PricingSource`` over the daily CSVs (the job uses the product-level
    ``products()`` so each product is matched once, not once per grade)."""

    name = SOURCE

    def __init__(self, client: PriceChartingClient, categories: Iterable[str] = CATEGORIES) -> None:
        self.client = client
        self.categories = tuple(categories)
        self.licence = licence()

    def products(self) -> Iterator[PcProduct]:
        for category in self.categories:
            yield from parse_csv(self.client.download_csv(category))

    def fetch(self, since: datetime | None = None) -> Iterator[ExternalPrice]:
        now = datetime.now(UTC)
        for p in self.products():
            console = parse_console(p.console_name)
            if console.excluded or console.game is None or console.lang is None:
                continue
            pn = parse_product_name(p.product_name)
            for key, cents in p.prices.items():
                grader, grade = PRICE_FIELDS[key]
                yield ExternalPrice(
                    source=SOURCE,
                    external_id=p.id,
                    game=console.game,
                    lang=console.lang,
                    set_code=console.set_name or "",
                    number=pn.number or "",
                    variant=pn.variant,
                    name=pn.name,
                    grader=grader,
                    grade=grade,
                    type="sold",
                    price=Decimal(cents) / 100,
                    currency="USD",
                    observed_at=now,
                    url=product_url(p.id),
                )
