"""JustTCG (justtcg.com): graded and raw card prices, with price history.

Licence: every paid plan includes a commercial licence written into the
Terms (§7.1): display current prices, historical trends and percentage
changes to end users, and calculate and display derived metrics and
aggregate valuations (our market cap). No permission email needed. The one
boundary (§7.2/7.3): never re-expose the raw data as a feed, export or API.
Our public data API only serves derived values for this reason.

API (v2 beta, https://justtcg.com/docs/api/cards-v2):

* ``GET /v1/sets?game=`` lists a game's sets (v2 covers /cards only);
* ``GET /v2/cards?game=&set=&graded=only&limit=`` pages through a set's
  cards (cursor in ``meta.cursor.next``). Each card carries ``variants``;
  a graded variant has ``grading {company, grade, grade_label, qualifier}``
  and ``markets[0] {price, currency, updated_at, price_history[{t, p}]}``;
* header ``x-api-key``; 429 carries ``Retry-After``; plan limits are per
  minute, day and month (Professional: 100/min, 5,000/day).

One JustTCG card can hold English and Japanese printings (One Piece) and
several printings (Normal / Reverse Holofoil). Our catalogue keeps languages
and these printings as separate cards, so one *record* here is a card +
language + variant, keyed ``{card uuid}:{lang}:{variant}``.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from tcgworkers.sources.population.base import Licence
from tcgworkers.sources.pricing.pricecharting import normalise_pc_variant

log = logging.getLogger(__name__)

SOURCE = "justtcg"
BASE_URL = "https://api.justtcg.com"
SITE_URL = "https://justtcg.com"
# Companies we show. PSA is the market-cap grade; the others appear on card pages.
DEFAULT_COMPANIES = ("PSA", "BGS", "CGC", "SGC")
MAX_RETRIES = 4
LANGS = {None: "en", "": "en", "english": "en", "japanese": "jp"}


@dataclass(frozen=True)
class JtGame:
    """A JustTCG game and how it maps onto ours.

    ``lang`` fixes the language for a game that is one language only
    (e.g. a Japanese-only game); ``None`` reads it from each variant's
    ``language`` (null = English)."""

    api_id: str
    game: str
    lang: str | None = None


DEFAULT_GAMES: tuple[JtGame, ...] = (
    JtGame("pokemon", "pokemon"),
    JtGame("pokemon-japan", "pokemon", "jp"),
    JtGame("one-piece-card-game", "one-piece"),
)


def games_from_setting(value: Any) -> tuple[JtGame, ...]:
    """``justtcg.games`` site setting: [{"id": "pokemon", "game": "pokemon", "lang": null}, ...]."""
    if not isinstance(value, list):
        return DEFAULT_GAMES
    out = []
    for g in value:
        if isinstance(g, dict) and isinstance(g.get("id"), str) and g.get("game") in ("pokemon", "one-piece"):
            lang = g.get("lang")
            out.append(JtGame(g["id"], g["game"], lang if lang in ("en", "jp") else None))
    return tuple(out) or DEFAULT_GAMES


def licence() -> Licence:
    # Paid plans: Terms §7.1 allows display, history and derived metrics;
    # §7.2/7.3 forbid redistributing the raw data as a feed, export or API.
    return Licence(
        display=True,
        redistribute=False,
        attribution="Price data: JustTCG (justtcg.com)",
        terms_url="https://justtcg.com/terms",
        reviewed_by="Terms of Service, last updated 7/27/2026 (§7.1-7.3), checked 2 Oct 2026",
    )


# ------------------------------------------------------------------ parsing
@dataclass(frozen=True)
class JtPrice:
    grader: str | None  # None = raw (Near Mint)
    grade: Decimal | None
    price_usd: Decimal
    updated_at: datetime | None
    history: tuple[tuple[datetime, Decimal], ...] = ()

    @property
    def grade_key(self) -> str:
        if self.grader is None or self.grade is None:
            return "raw"
        g = format(self.grade.normalize(), "f")
        return f"{self.grader.lower()}-{g}"


@dataclass
class JtRecord:
    """One card + language + variant, with its prices per grade."""

    external_id: str
    card_uuid: str
    game: str
    lang: str
    set_id: str
    set_name: str
    number: str | None
    name: str
    variant: str
    rarity: str | None
    tcgplayer_id: str | None
    prices: dict[str, JtPrice] = field(default_factory=dict)  # grade_key -> price

    def payload(self) -> dict[str, Any]:
        return {
            "id": self.card_uuid,
            "set": self.set_id,
            "set_name": self.set_name,
            "number": self.number,
            "name": self.name,
            "variant": self.variant,
            "rarity": self.rarity,
            "tcgplayer_id": self.tcgplayer_id,
            "lang": self.lang,
        }


_PARENS = re.compile(r"\(([^)]*)\)|\[([^\]]*)\]")
_NUMBER_SUFFIX = re.compile(r"\s+-\s+[#A-Za-z]*\d[\w/-]*\s*$")
_IGNORED_NAME_PARTS = {"", "promo"}


def parse_name(raw: str, number: str | None) -> tuple[str, list[str]]:
    """'Monkey.D.Luffy (Alternate Art) (Manga)' -> ('Monkey.D.Luffy', ['Alternate Art', 'Manga']);
    'Charizard ex - 199/165' -> ('Charizard ex', [])."""
    text = " ".join((raw or "").split())
    if number and text.endswith(number):
        text = text[: -len(number)].rstrip(" -#")
    text = _NUMBER_SUFFIX.sub("", text)
    parts = [(a or b).strip() for a, b in _PARENS.findall(text)]
    name = " ".join(_PARENS.sub(" ", text).split()) or text
    return name, [
        p for p in parts if p.lower() not in _IGNORED_NAME_PARTS and not re.fullmatch(r"[\w/-]*\d[\w/-]*", p)
    ]


def variant_for(name_parts: list[str], printing: str | None) -> str:
    """Our catalogue variant from the name's bracketed parts and the printing.
    Normal/Holofoil printings are the card itself; Reverse Holofoil and
    1st Edition are separate cards in our catalogue."""
    # The name's words are read together ("(Alternate Art) (Manga)" is one
    # manga alternate art, not two variants), the printing separately.
    parts = [" ".join(name_parts)] if name_parts else []
    p = (printing or "").lower()
    if "reverse" in p:
        parts.append("Reverse Holo")
    if "1st edition" in p or "first edition" in p:
        parts.append("1st Edition")
    return normalise_pc_variant(parts)


def _decimal(v: Any) -> Decimal | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        d = Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() else None


def _ts(v: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(v), UTC) if v is not None else None
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _market(variant: dict[str, Any]) -> dict[str, Any] | None:
    """The US-dollar market with a price: North America first (markets[0] when
    we only request NA), else any other USD market."""
    usd = [
        m
        for m in variant.get("markets") or []
        if isinstance(m, dict)
        and str(m.get("currency") or "USD").upper() == "USD"
        and m.get("price") is not None
    ]
    for m in usd:
        if str(m.get("region") or "NA").upper() in ("NA", "US"):
            return m
    return usd[0] if usd else None


def _price_of(variant: dict[str, Any], companies: tuple[str, ...]) -> JtPrice | None:
    kind = str(variant.get("type") or ("graded" if variant.get("grading") else "raw")).lower()
    if kind == "graded":
        g = variant.get("grading") or {}
        company = (g.get("company") or "").upper()
        grade = _decimal(g.get("grade"))
        # Special labels (Black Label, Pristine) and qualifiers (OC) are priced
        # separately and aren't comparable grades: leave them out.
        if company not in companies or grade is None or g.get("grade_label") or g.get("qualifier"):
            return None
        grader: str | None = company
    elif kind == "raw":
        if (variant.get("condition") or "").lower() not in ("near mint", "nm"):
            return None
        grader, grade = None, None
    else:
        return None
    m = _market(variant)
    price = _decimal(m.get("price")) if m else None
    if m is None or price is None or price <= 0:
        return None
    history = []
    for point in m.get("price_history") or []:
        if not isinstance(point, dict):
            continue
        t, p = _ts(point.get("t")), _decimal(point.get("p"))
        if t and p and p > 0:
            history.append((t, p.quantize(Decimal("0.01"))))
    return JtPrice(grader, grade, price.quantize(Decimal("0.01")), _ts(m.get("updated_at")), tuple(history))


def parse_card(
    card: dict[str, Any], game: JtGame, companies: tuple[str, ...] = DEFAULT_COMPANIES
) -> list[JtRecord]:
    """A JustTCG v2 card -> one record per language + variant that has prices."""
    uuid = str(card.get("id") or "").strip()
    if not uuid:
        return []
    number = (
        (str(card.get("number")).strip() or None) if card.get("number") not in (None, "", "N/A") else None
    )
    name, name_parts = parse_name(str(card.get("name") or ""), number)
    s = card.get("set") or {}
    ext = card.get("external_ids") or {}
    records: dict[str, JtRecord] = {}
    for v in card.get("variants") or []:
        if not isinstance(v, dict):
            continue
        lang = game.lang or LANGS.get((v.get("language") or "").strip().lower())
        if lang is None:  # French, Korean, Chinese...: not in our catalogue
            continue
        price = _price_of(v, companies)
        if price is None:
            continue
        variant = variant_for(name_parts, v.get("printing"))
        ext_id = f"{uuid}:{lang}:{variant}"
        rec = records.get(ext_id)
        if rec is None:
            rec = records[ext_id] = JtRecord(
                external_id=ext_id,
                card_uuid=uuid,
                game=game.game,
                lang=lang,
                set_id=str(s.get("id") or ""),
                set_name=str(s.get("name") or s.get("id") or ""),
                number=number,
                name=name,
                variant=variant,
                rarity=card.get("rarity"),
                tcgplayer_id=ext.get("tcgplayer"),
            )
        # Two printings can land on one variant (Normal and Holofoil): keep the
        # most recently observed price for each grade.
        prev = rec.prices.get(price.grade_key)
        if prev is None or (price.updated_at or datetime.min.replace(tzinfo=UTC)) > (
            prev.updated_at or datetime.min.replace(tzinfo=UTC)
        ):
            rec.prices[price.grade_key] = price
    return list(records.values())


# ------------------------------------------------------------------- client
class JustTcgError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class BudgetExhausted(JustTcgError):
    pass


class JustTcgClient:
    """Small, polite client: one request at a time, a request budget per run,
    backoff on 429 (honouring Retry-After), the key never logged."""

    def __init__(
        self,
        api_key: str,
        *,
        user_agent: str,
        max_requests: int,
        page_size: int = 100,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        min_interval: float = 0.7,  # ~85/min, under Professional's 100/min
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.api_key = api_key
        self.max_requests = max_requests
        self.page_size = page_size
        self.sleep = sleep
        self.clock = clock
        self.min_interval = min_interval
        self.requests = 0
        self._last = -1e9
        self._http = httpx.Client(
            base_url=BASE_URL,
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={"User-Agent": user_agent, "Accept": "application/json"},
            transport=transport,
        )

    def _redact(self, text: str) -> str:
        return text.replace(self.api_key, "***") if self.api_key else text

    def get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(MAX_RETRIES + 1):
            if self.requests >= self.max_requests:
                raise BudgetExhausted(f"request budget of {self.max_requests} used")
            wait = self._last + self.min_interval - self.clock()
            if wait > 0:
                self.sleep(wait)
            self._last = self.clock()
            self.requests += 1
            try:
                r = self._http.get(path, params=params, headers={"x-api-key": self.api_key})
            except httpx.HTTPError as exc:
                if attempt < MAX_RETRIES:
                    self.sleep(min(2**attempt, 30))
                    continue
                raise JustTcgError(self._redact(f"{type(exc).__name__}: {exc}")) from exc
            if r.status_code == 429 or r.status_code >= 500:
                code = _error_code(r)
                if code in ("DAILY_LIMIT_EXCEEDED", "REQUEST_LIMIT_EXCEEDED") or attempt == MAX_RETRIES:
                    raise JustTcgError(
                        f"HTTP {r.status_code} {code or ''} from {path}".strip(),
                        status=r.status_code,
                        code=code,
                    )
                retry_after = _float(r.headers.get("Retry-After"))
                self.sleep(min(retry_after if retry_after is not None else 2 ** (attempt + 1), 60))
                continue
            if r.status_code >= 400:
                raise JustTcgError(
                    self._redact(f"HTTP {r.status_code} from {path}: {r.text[:200]}"),
                    status=r.status_code,
                    code=_error_code(r),
                )
            body = r.json()
            if not isinstance(body, dict):
                raise JustTcgError(f"unexpected response from {path}")
            return body
        raise JustTcgError(f"gave up on {path}")  # pragma: no cover - loop always returns or raises

    def sets(self, game: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        offset = 0
        while True:
            body = self.get("/v1/sets", {"game": game, "limit": 100, "offset": offset})
            page = [s for s in body.get("data") or [] if isinstance(s, dict) and s.get("id")]
            out.extend(page)
            meta = body.get("meta") or {}
            if not page or not (meta.get("hasMore") or meta.get("has_more")):
                return out
            offset += len(page)

    def cards(
        self, game: str, set_id: str, *, history: str | None = None, raw: bool = False
    ) -> Iterator[dict[str, Any]]:
        """Every card in a set, graded variants (plus Near Mint raw when ``raw``)."""
        params: dict[str, Any] = {
            "game": game,
            "set": set_id,
            "graded": "include" if raw else "only",
            "limit": self.page_size,
        }
        if history:
            params["include"] = f"price_history.{history}"
        while True:
            body = self.get("/v2/cards", params)
            for card in body.get("data") or []:
                if isinstance(card, dict):
                    yield card
            meta = body.get("meta") or {}
            nxt = (meta.get("cursor") or {}).get("next")
            if not meta.get("has_more") or not nxt:
                return
            params = {**params, "cursor": nxt}


def _float(v: str | None) -> float | None:
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def _error_code(r: httpx.Response) -> str | None:
    try:
        body = r.json()
    except ValueError:
        return None
    return body.get("code") if isinstance(body, dict) else None
