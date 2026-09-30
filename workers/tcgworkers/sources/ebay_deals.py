"""eBay deal finder: graded cards listed on eBay Australia well under our
market value, through eBay's official Browse API (no scraping).

Every run (job ``deals``, every 30 minutes):

1. ``public.deal_watch_cards(n)`` picks the cards worth checking (wishlisted
   first, then the most valuable ranked cards) with our market value.
2. One ``item_summary/search`` call per card: name + number + "Japanese" for
   JP cards + the grade ("PSA 10"), category 183454 (CCG individual cards),
   located in Australia, priced in AUD, at or under the deal price.
3. Each result is matched strictly (``match_title``: false positives are
   worse than misses) and judged (``evaluate``):
   * Buy It Now: price + postage <= market x (1 - deals.min_discount_pct);
   * auction: ends within deals.auction_ending_minutes and current bid +
     postage <= the same bound.
   Listings with unknown postage (calculated / pickup only), sellers with
   thin or poor feedback, and non-AUD prices are never deals.
4. New deals are inserted into ``ebay_deals`` (keyed on the eBay item id, so
   a known listing is never inserted twice); the insert trigger notifies
   wishlist watchers (email template ``deal``). A known deal that isn't seen
   again for its card in 2 consecutive runs, or whose auction has ended, is
   marked ``gone_at``. (The miss counter lives in the worker process; a
   restart only delays marking by up to two runs.)

Call budget. The Browse API allows 5,000 calls a day by default. At one run
every 30 minutes (48 runs a day) and one search per card, the per-run cap is
``MAX_CARDS_PER_RUN`` = floor(5,000 x 0.8 / 48) = 83 searches, i.e. at most
3,984 calls a day, leaving 20% headroom for retries and manual ``--once``
runs. deals.max_cards_per_run (default 150) is clamped to that. OAuth token
calls go to a different endpoint and happen about once every two hours.

429 responses are retried with back-off (honouring Retry-After) and then end
the run early; other errors skip the card. Nothing here raises into the
scheduler except a database failure.

Affiliate links: when EPN is set up (ebay.affiliate_enabled and a 10-digit
ebay.campaign_id) searches send ``X-EBAY-C-ENDUSERCTX`` so results carry
``itemAffiliateWebUrl``, which the site's /deals/ page uses. Emails never
carry eBay links (EPN terms): the ``deal`` template links /deals/.

Off (logged once) until deals.enabled is true and EBAY_CLIENT_ID /
EBAY_CLIENT_SECRET are set.
"""

from __future__ import annotations

import logging
import math
import re
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

import httpx
import psycopg

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]

TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
SCOPE = "https://api.ebay.com/oauth/api_scope"
MARKETPLACE = "EBAY_AU"
CATEGORY_ID = "183454"  # Collectible Card Games > CCG Individual Cards
RESULTS_PER_SEARCH = 50

DAILY_CALL_LIMIT = 5000
BUDGET_SHARE = 0.8
RUN_EVERY_MINUTES = 30
RUNS_PER_DAY = 24 * 60 // RUN_EVERY_MINUTES
MAX_CARDS_PER_RUN = math.floor(DAILY_CALL_LIMIT * BUDGET_SHARE / RUNS_PER_DAY)  # 83

MAX_RETRIES_429 = 2
MAX_BACKOFF_SECONDS = 60.0
TOKEN_EXPIRY_MARGIN = 120  # seconds: refresh a little before eBay says
MISSES_BEFORE_GONE = 2
MIN_SELLER_FEEDBACK_PCT = Decimal("97")
MIN_SELLER_FEEDBACK_SCORE = 10

CAMPAIGN_ID = re.compile(r"^\d{10}$")


class RateLimited(Exception):
    """eBay kept answering 429: stop this run, try again next time."""


# ------------------------------------------------------------------ settings
@dataclass(frozen=True)
class DealSettings:
    enabled: bool = False
    min_discount_pct: Decimal = Decimal("20")
    auction_ending_minutes: int = 120
    max_cards_per_run: int = 150
    campaign_id: str | None = None  # set only when EPN tracking is on and valid

    @property
    def cards_per_run(self) -> int:
        return max(0, min(self.max_cards_per_run, MAX_CARDS_PER_RUN))


def _as_bool(v: Any) -> bool:
    return v is True or str(v).strip().lower() in ("true", "1", "yes", "on")


def settings_from_rows(rows: dict[str, Any]) -> DealSettings:
    """From site_settings ``{key: jsonb value}``."""
    d = DealSettings()
    campaign = rows.get("ebay.campaign_id")
    campaign_s = str(campaign).strip() if campaign is not None else ""
    try:
        return DealSettings(
            enabled=_as_bool(rows.get("deals.enabled", False)),
            min_discount_pct=Decimal(str(rows.get("deals.min_discount_pct", d.min_discount_pct))),
            auction_ending_minutes=int(rows.get("deals.auction_ending_minutes", d.auction_ending_minutes)),
            max_cards_per_run=int(rows.get("deals.max_cards_per_run", d.max_cards_per_run)),
            campaign_id=campaign_s
            if _as_bool(rows.get("ebay.affiliate_enabled", False)) and CAMPAIGN_ID.match(campaign_s)
            else None,
        )
    except (InvalidOperation, TypeError, ValueError):
        log.warning("deals: invalid deals.* settings, using defaults (disabled)")
        return d


def load_settings(conn: Conn) -> DealSettings:
    rows = conn.execute(
        "select key, value from public.site_settings where key like 'deals.%' or key like 'ebay.%'"
    ).fetchall()
    return settings_from_rows({r["key"]: r["value"] for r in rows})


# -------------------------------------------------------------------- cards
@dataclass(frozen=True)
class WatchCard:
    card_id: str
    grade_key: str
    market_aud: Decimal
    name: str
    number: str
    set_name: str
    lang: str
    game: str


def grade_phrase(grade_key: str) -> tuple[str, str] | None:
    """'psa-10' -> ('PSA', '10'); 'bgs-9.5' -> ('BGS', '9.5'). Raw and
    'any-*' grades are never searched: too loose to match safely."""
    m = re.fullmatch(r"(psa|bgs|cgc|sgc)-(\d+(?:\.5)?)", grade_key.lower())
    if not m:
        return None
    return m.group(1).upper(), m.group(2)


def query_number(number: str) -> str:
    """'025/165' -> '25'; 'TG05/TG30' -> 'TG05'; 'OP05-119' stays."""
    first = number.split("/")[0].strip()
    if first.isdigit():
        return first.lstrip("0") or "0"
    return first


def build_query(card: WatchCard) -> str | None:
    grade = grade_phrase(card.grade_key)
    if grade is None:
        return None
    parts = [card.name, query_number(card.number)]
    if card.lang == "jp":
        parts.append("Japanese")
    parts.append(f"{grade[0]} {grade[1]}")
    return " ".join(p for p in parts if p)


# ------------------------------------------------------------------ matching
_BLOCKED = re.compile(
    r"\b(proxy|proxies|reprint|re-print|custom|orica|fake|replica|not\s+psa|lot|lots|bundle|digital|"
    r"candidate|potential|worthy|ready|quality|choose|pick|you\s+pick|empty|slab\s+only|case\s+only|"
    r"no\s+card|code\s+card|online\s+code|metal|fan\s*art|unofficial|sticker|display\s+case)\b",
    re.IGNORECASE,
)
_JP = re.compile(r"\b(japanese|japan|jpn|jp)\b", re.IGNORECASE)
_OTHER_LANG = re.compile(r"\b(korean|kor|chinese|s-chinese|t-chinese|thai|indonesian)\b", re.IGNORECASE)


def _name_word(name: str) -> str | None:
    """The longest word of the card name ('Charizard ex' -> 'Charizard')."""
    words = [w for w in re.split(r"[^\w']+", name) if len(w) >= 3]
    return max(words, key=len) if words else None


def _has_number(title: str, number: str) -> bool:
    first = number.split("/")[0].strip()
    if first.isdigit():
        n = first.lstrip("0") or "0"
        # 025, 25, #025, 025/165 - but not 125, 250, or /25 (a set size).
        return re.search(rf"(?<![\w/.]){'0*' + re.escape(n)}(?![\d.])", title) is not None
    norm = re.sub(r"[^a-z0-9]", "", first.lower())
    return bool(norm) and norm in re.sub(r"[^a-z0-9]", "", title.lower())


def _has_grade(title: str, grader: str, grade: str) -> bool:
    """Exactly this grade from this grader, and no other grade from it."""
    found = re.findall(rf"\b{grader}\s*[-:]?\s*(\d+(?:\.\d)?)(?![\d.])", title, re.IGNORECASE)
    return bool(found) and all(Decimal(g) == Decimal(grade) for g in found)


def match_title(title: str, card: WatchCard) -> bool:
    """Strict: the listing must be this card, this grade, this language."""
    grade = grade_phrase(card.grade_key)
    if grade is None or _BLOCKED.search(title) or _OTHER_LANG.search(title):
        return False
    # The grade's own digits ("PSA 10") must not count as card number 10.
    without_grade = re.sub(r"\b(psa|bgs|cgc|sgc)\s*[-:]?\s*\d+(?:\.\d)?", " ", title, flags=re.IGNORECASE)
    if not _has_grade(title, *grade) or not _has_number(without_grade, card.number):
        return False
    word = _name_word(card.name)
    if word and word.lower() not in title.lower():
        return False
    is_jp = _JP.search(title) is not None
    return is_jp if card.lang == "jp" else not is_jp


# --------------------------------------------------------------- listings
def _money(obj: Any) -> tuple[Decimal, str] | None:
    if not isinstance(obj, dict) or obj.get("value") in (None, ""):
        return None
    try:
        return Decimal(str(obj["value"])), str(obj.get("currency") or "")
    except InvalidOperation:
        return None


def _when(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


@dataclass(frozen=True)
class Listing:
    item_id: str
    title: str
    buying_options: tuple[str, ...]
    price: Decimal | None  # Buy It Now price (AUD)
    current_bid: Decimal | None  # auctions (AUD)
    shipping: Decimal | None  # None = unknown (calculated, pickup only)
    bid_count: int | None
    end_time: datetime | None
    url: str
    image_url: str | None
    seller_feedback_pct: Decimal | None
    seller_feedback_score: int | None

    @classmethod
    def from_summary(cls, s: dict[str, Any]) -> Listing | None:
        """None when the summary is unusable (not AUD, no https link...)."""
        url = s.get("itemAffiliateWebUrl") or s.get("itemWebUrl") or ""
        if not s.get("itemId") or not str(url).startswith("https://"):
            return None
        price = _money(s.get("price"))
        bid = _money(s.get("currentBidPrice"))
        if (price and price[1] != "AUD") or (bid and bid[1] != "AUD"):
            return None
        shipping: Decimal | None = None
        for opt in s.get("shippingOptions") or []:
            cost = _money(opt.get("shippingCost"))
            if cost and cost[1] == "AUD" and opt.get("shippingCostType", "FIXED") != "CALCULATED":
                shipping = cost[0] if shipping is None else min(shipping, cost[0])
        seller = s.get("seller") or {}
        try:
            fb_pct = Decimal(str(seller["feedbackPercentage"])) if seller.get("feedbackPercentage") else None
        except InvalidOperation:
            fb_pct = None
        image = (s.get("image") or {}).get("imageUrl")
        return cls(
            item_id=str(s["itemId"]),
            title=str(s.get("title") or ""),
            buying_options=tuple(s.get("buyingOptions") or ()),
            price=price[0] if price else None,
            current_bid=bid[0] if bid else None,
            shipping=shipping,
            bid_count=int(s["bidCount"]) if s.get("bidCount") is not None else None,
            end_time=_when(s.get("itemEndDate")),
            url=str(url),
            image_url=str(image) if image and str(image).startswith("https://") else None,
            seller_feedback_pct=fb_pct,
            seller_feedback_score=int(seller["feedbackScore"])
            if seller.get("feedbackScore") is not None
            else None,
        )


@dataclass(frozen=True)
class Deal:
    item_id: str
    card_id: str
    grade_key: str
    title: str
    buying_option: str  # FIXED_PRICE | AUCTION
    price_aud: Decimal
    shipping_aud: Decimal
    market_aud: Decimal
    discount_pct: Decimal
    bid_count: int | None
    end_time: datetime | None
    url: str
    image_url: str | None
    seller_feedback_pct: Decimal | None


def deal_ceiling(market: Decimal, min_discount_pct: Decimal) -> Decimal:
    """The most a listing (with postage) may cost to count as a deal."""
    return (market * (1 - min_discount_pct / 100)).quantize(Decimal("0.01"), ROUND_HALF_UP)


def evaluate(card: WatchCard, item: Listing, settings: DealSettings, now: datetime) -> Deal | None:
    if not match_title(item.title, card) or item.shipping is None:
        return None
    if item.seller_feedback_pct is None or item.seller_feedback_pct < MIN_SELLER_FEEDBACK_PCT:
        return None
    if (item.seller_feedback_score or 0) < MIN_SELLER_FEEDBACK_SCORE:
        return None
    if item.end_time is not None and item.end_time <= now:
        return None
    ceiling = deal_ceiling(card.market_aud, settings.min_discount_pct)
    option: str | None = None
    price: Decimal | None = None
    if (
        "FIXED_PRICE" in item.buying_options
        and item.price is not None
        and item.price + item.shipping <= ceiling
    ):
        option, price = "FIXED_PRICE", item.price
    elif (
        "AUCTION" in item.buying_options
        and item.current_bid is not None
        and item.end_time is not None
        and item.end_time <= now + timedelta(minutes=settings.auction_ending_minutes)
        and item.current_bid + item.shipping <= ceiling
    ):
        option, price = "AUCTION", item.current_bid
    if option is None or price is None or price <= 0:
        return None
    total = price + item.shipping
    discount = ((1 - total / card.market_aud) * 100).quantize(Decimal("0.1"), ROUND_HALF_UP)
    return Deal(
        item_id=item.item_id,
        card_id=card.card_id,
        grade_key=card.grade_key,
        title=item.title[:300],
        buying_option=option,
        price_aud=price,
        shipping_aud=item.shipping,
        market_aud=card.market_aud,
        discount_pct=discount,
        bid_count=item.bid_count,
        end_time=item.end_time,
        url=item.url,
        image_url=item.image_url,
        seller_feedback_pct=item.seller_feedback_pct,
    )


# -------------------------------------------------------------------- client
Sleep = Callable[[float], None]
Clock = Callable[[], float]


@dataclass
class BrowseClient:
    """Browse API client with a cached client-credentials token."""

    client_id: str
    client_secret: str
    http: httpx.Client = field(default_factory=lambda: httpx.Client(timeout=20))
    sleep: Sleep = time.sleep
    clock: Clock = time.monotonic
    calls: int = 0  # searches made by this client (budget accounting)
    _token: str | None = None
    _token_expires: float = 0.0

    def token(self) -> str:
        if self._token and self.clock() < self._token_expires:
            return self._token
        r = self.http.post(
            TOKEN_URL,
            auth=(self.client_id, self.client_secret),
            data={"grant_type": "client_credentials", "scope": SCOPE},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if r.status_code >= 400:
            raise RuntimeError(f"eBay OAuth HTTP {r.status_code}")  # never echo the credentials
        body = r.json()
        self._token = str(body["access_token"])
        self._token_expires = self.clock() + max(int(body.get("expires_in", 7200)) - TOKEN_EXPIRY_MARGIN, 60)
        return self._token

    def search(
        self, query: str, *, max_price: Decimal, campaign_id: str | None, reference: str
    ) -> list[dict[str, Any]]:
        params = {
            "q": query,
            "category_ids": CATEGORY_ID,
            "filter": ",".join(
                [
                    "buyingOptions:{FIXED_PRICE|AUCTION}",
                    "itemLocationCountry:AU",
                    "priceCurrency:AUD",
                    f"price:[..{max_price}]",
                ]
            ),
            "limit": str(RESULTS_PER_SEARCH),
        }
        headers = {"X-EBAY-C-MARKETPLACE-ID": MARKETPLACE}
        if campaign_id:
            headers["X-EBAY-C-ENDUSERCTX"] = (
                f"affiliateCampaignId={campaign_id},affiliateReferenceId={reference}"
            )
        refreshed = False
        attempt = 0
        while True:
            headers["Authorization"] = f"Bearer {self.token()}"
            self.calls += 1
            r = self.http.get(SEARCH_URL, params=params, headers=headers)
            if r.status_code == 401 and not refreshed:
                self._token, refreshed = None, True  # revoked or expired early
                continue
            if r.status_code == 429:
                if attempt >= MAX_RETRIES_429:
                    raise RateLimited("eBay Browse API rate limit")
                self.sleep(_retry_after(r, attempt))
                attempt += 1
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"eBay search HTTP {r.status_code}: {r.text[:200]}")
            return list(r.json().get("itemSummaries") or [])


def _retry_after(r: httpx.Response, attempt: int) -> float:
    try:
        wait = float(r.headers.get("Retry-After", ""))
    except ValueError:
        wait = 5.0 * 2**attempt
    return min(max(wait, 1.0), MAX_BACKOFF_SECONDS)


# --------------------------------------------------------------------- store
class DealStore:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def watch_cards(self, limit: int) -> list[WatchCard]:
        rows = self.conn.execute(
            """select card_id::text as card_id, grade_key, market_aud, name, number, set_name, lang, game
                 from public.deal_watch_cards(%s)""",
            (limit,),
        ).fetchall()
        return [
            WatchCard(
                r["card_id"],
                r["grade_key"],
                Decimal(str(r["market_aud"])),
                r["name"],
                str(r["number"] or ""),
                r["set_name"],
                r["lang"],
                r["game"],
            )
            for r in rows
        ]

    def known_items(self, item_ids: Iterable[str]) -> set[str]:
        rows = self.conn.execute(
            "select item_id from public.ebay_deals where item_id = any(%s)", (list(item_ids),)
        ).fetchall()
        return {r["item_id"] for r in rows}

    def active_items(self, card_id: str, grade_key: str) -> set[str]:
        rows = self.conn.execute(
            """select item_id from public.ebay_deals
                where card_id = %s and grade_key = %s and gone_at is null""",
            (card_id, grade_key),
        ).fetchall()
        return {r["item_id"] for r in rows}

    def insert(self, deals: list[Deal]) -> int:
        n = 0
        for d in deals:
            cur = self.conn.execute(
                """insert into public.ebay_deals (item_id, card_id, grade_key, title, buying_option, price_aud,
                     shipping_aud, market_aud, discount_pct, bid_count, end_time, url, image_url,
                     seller_feedback_pct)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (item_id) do nothing""",
                (
                    d.item_id,
                    d.card_id,
                    d.grade_key,
                    d.title,
                    d.buying_option,
                    d.price_aud,
                    d.shipping_aud,
                    d.market_aud,
                    d.discount_pct,
                    d.bid_count,
                    d.end_time,
                    d.url,
                    d.image_url,
                    d.seller_feedback_pct,
                ),
            )
            n += cur.rowcount
        return n

    def mark_gone(self, item_ids: Iterable[str]) -> int:
        ids = list(item_ids)
        if not ids:
            return 0
        cur = self.conn.execute(
            "update public.ebay_deals set gone_at = now() where item_id = any(%s) and gone_at is null", (ids,)
        )
        return cur.rowcount

    def mark_ended(self) -> int:
        cur = self.conn.execute(
            "update public.ebay_deals set gone_at = now() where gone_at is null and end_time < now()"
        )
        return cur.rowcount

    def commit(self) -> None:
        self.conn.commit()


# -------------------------------------------------------------------- finder
@dataclass
class DealFinder:
    """Lives as long as the worker process: keeps the OAuth token and the
    per-deal miss counts between runs."""

    client: BrowseClient
    misses: dict[str, int] = field(default_factory=dict)

    def run(self, store: DealStore, settings: DealSettings, *, now: datetime | None = None) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        stats: dict[str, Any] = {"cards": 0, "searches": 0, "found": 0, "new": 0, "gone": 0, "errors": 0}
        cards = store.watch_cards(settings.cards_per_run)
        calls_before = self.client.calls
        for card in cards:
            query = build_query(card)
            if query is None:
                continue
            stats["cards"] += 1
            try:
                summaries = self.client.search(
                    query,
                    max_price=deal_ceiling(card.market_aud, settings.min_discount_pct),
                    campaign_id=settings.campaign_id,
                    reference=f"tcgtrade-{card.card_id}",
                )
            except RateLimited:
                log.warning("deals: eBay rate limit, stopping this run after %d cards", stats["cards"])
                stats["rate_limited"] = True
                break
            except Exception as exc:  # one card's failure must not end the run
                log.warning("deals: search failed for %s %s: %s", card.card_id, card.grade_key, exc)
                stats["errors"] += 1
                continue
            deals = [
                d
                for s in summaries
                if (item := Listing.from_summary(s)) is not None
                and (d := evaluate(card, item, settings, now)) is not None
            ]
            stats["found"] += len(deals)
            seen = {d.item_id for d in deals}
            known = store.known_items(seen) if seen else set()
            stats["new"] += store.insert([d for d in deals if d.item_id not in known])
            gone: list[str] = []
            for item_id in store.active_items(card.card_id, card.grade_key):
                if item_id in seen:
                    self.misses.pop(item_id, None)
                    continue
                self.misses[item_id] = self.misses.get(item_id, 0) + 1
                if self.misses[item_id] >= MISSES_BEFORE_GONE:
                    gone.append(item_id)
                    self.misses.pop(item_id, None)
            stats["gone"] += store.mark_gone(gone)
            store.commit()
        stats["gone"] += store.mark_ended()
        store.commit()
        stats["searches"] = self.client.calls - calls_before
        return stats


_warned: set[str] = set()


def _warn_once(reason: str) -> None:
    if reason not in _warned:
        _warned.add(reason)
        log.info("deals: skipped: %s", reason)


def ready_settings(conn: Conn, finder: DealFinder | None) -> DealSettings | None:
    """The settings for a run, or None (logged once) when deals are switched
    off or the eBay keys are missing."""
    settings = load_settings(conn)
    conn.commit()
    if not settings.enabled:
        _warn_once("deals.enabled is off")
        return None
    if finder is None:
        _warn_once("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set")
        return None
    return settings
