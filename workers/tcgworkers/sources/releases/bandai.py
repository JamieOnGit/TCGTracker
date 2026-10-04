"""One Piece Card Game release dates from Bandai's official English site.

``https://en.onepiece-cardgame.com/products/`` is the English edition for
"NA / EU / OC / LATAM / ME": OC is Oceania, so these are the official dates
for Australia. Products are listed newest first, 12 to a page
(``?page=N``); each item has a category (BOOSTERS / DECKS / OTHERS), a
title such as ``BOOSTER PACK -THE DOMINANCE OF GOD- [OP-18]`` and a
``<time datetime="2026-11-20">`` release date. Premium Bandai items (the
US web store, "Delivery Month") are not Australian retail releases and are
skipped. The site has no robots.txt; we fetch at most a few pages a run,
5 s apart, with our honest user agent.
"""

from __future__ import annotations

import html
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

import httpx

SOURCE_NAME = "Bandai (official, Oceania)"
BASE_URL = "https://en.onepiece-cardgame.com"
PAGE_URL = BASE_URL + "/products/?page={page}"

_ITEM = re.compile(r'<li class="linkListColBox"[^>]*>(.*?)</li>', re.S)
_HREF = re.compile(r'<a href="(https://en\.onepiece-cardgame\.com/products/[^"]+)"')
_CAT = re.compile(r'<span class="linkListColCat">([^<]+)</span>')
_TITLE = re.compile(r'<h4 class="linkListColTitle">(.*?)</h4>', re.S)
_DATE = re.compile(
    r'<p class="linkListColDate"><span class="head">([^<]+)</span><time[^>]*datetime="(\d{4}-\d{2}-\d{2})"'
)
_CODE = re.compile(r"\[([A-Z]{1,4}-?\d{1,4})\]")
# Accessories, not cards: kept off the release calendar.
_ACCESSORY = re.compile(r"sleeve|playmat|storage box|card case|deck case|binder|dice|marker", re.I)
_SMALL = {"of", "the", "and", "a", "an", "in", "on", "to", "for", "vs", "with"}
# Bandai's product-kind prefixes -> (our product type, plain name)
_KINDS: tuple[tuple[str, str, str], ...] = (
    ("PREMIUM BOOSTER", "premium-booster", "Premium Booster"),
    ("EXTRA BOOSTER", "extra-booster", "Extra Booster"),
    ("BOOSTER PACK", "booster-pack", "Booster Pack"),
    ("STARTER DECK", "starter-deck", "Starter Deck"),
    ("ULTRA DECK", "starter-deck", "Ultra Deck"),
)


class BandaiError(RuntimeError):
    pass


@dataclass(frozen=True)
class BandaiRelease:
    title: str  # tidied, e.g. "Booster Pack: The Dominance of God (OP-18)"
    code: str | None  # "OP-18"
    category: str  # boosters / decks / others
    product_type: str | None
    release_date: date
    url: str

    @property
    def key(self) -> str:
        """Stable identity across runs: the product page."""
        page = self.url.rstrip("/").rsplit("/", 1)[-1].removesuffix(".html").lower()
        return "bandai:" + page

    @property
    def is_set(self) -> bool:
        return self.category == "boosters" and self.code is not None


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def _title_case(words: str) -> str:
    """Bandai shouts (``ONE PIECE HEROINES EDITION vol.2``): words in capitals
    become title case; words it wrote in mixed or lower case stay as written."""
    out = []
    for i, w in enumerate(words.split()):
        if w.isupper() and len(w) > 1:
            low = w.lower()
            w = low if i and low in _SMALL else low[:1].upper() + low[1:]
        out.append(w)
    return " ".join(out)


def tidy_title(raw: str) -> tuple[str, str | None, str | None]:
    """``BOOSTER PACK -THE DOMINANCE OF GOD- [OP-18]`` ->
    (``Booster Pack: The Dominance of God (OP-18)``, ``OP-18``, ``booster-pack``)."""
    raw = re.sub(r"\s+", " ", raw).strip()
    code = m.group(1) if (m := _CODE.search(raw)) else None
    body = _CODE.sub("", raw).strip()
    kind_name: str | None = None
    product_type: str | None = None
    for prefix, ptype, plain in _KINDS:
        if body.upper().startswith(prefix):
            kind_name, product_type = plain, ptype
            body = body[len(prefix) :].strip()
            break
    if (m := re.fullmatch(r"(.*?)\s*-(.+)-\s*", body)) and m.group(2).strip():
        lead, name = m.group(1).strip(), m.group(2).strip()
        kind_name = kind_name or _title_case(lead) or None
    else:
        name = body.strip(" -")
    name = _title_case(name)
    title = f"{kind_name}: {name}" if kind_name and name else (kind_name or name)
    return (f"{title} ({code})" if code else title), code, product_type


def parse_page(page_html: str) -> list[BandaiRelease]:
    out: list[BandaiRelease] = []
    for item in _ITEM.findall(page_html):
        if "PREMIUM BANDAI" in item.upper():
            continue  # US web-store exclusive, not an Australian retail release
        href, title, dated = _HREF.search(item), _TITLE.search(item), _DATE.search(item)
        if not (href and title and dated) or "release" not in dated.group(1).lower():
            continue  # no announced release day yet
        cat = m.group(1).strip().lower() if (m := _CAT.search(item)) else "others"
        tidy, code, ptype = tidy_title(_text(title.group(1)))
        if not tidy or _ACCESSORY.search(tidy):
            continue
        out.append(
            BandaiRelease(
                title=tidy[:120],
                code=code,
                category=cat,
                product_type=ptype,
                release_date=date.fromisoformat(dated.group(2)),
                url=href.group(1),
            )
        )
    return out


class BandaiClient:
    def __init__(
        self,
        *,
        user_agent: str,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        delay: float = 5.0,
    ) -> None:
        self.sleep = sleep
        self.delay = delay
        self.requests = 0
        self._http = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={"User-Agent": user_agent, "Accept": "text/html"},
            transport=transport,
            follow_redirects=True,
        )

    def page(self, n: int) -> str:
        if self.requests:
            self.sleep(self.delay)
        self.requests += 1
        try:
            r = self._http.get(PAGE_URL.format(page=n))
        except httpx.HTTPError as exc:
            raise BandaiError(f"{type(exc).__name__} on products page {n}") from exc
        if r.status_code >= 400:
            raise BandaiError(f"HTTP {r.status_code} from products page {n}")
        return r.text


def fetch_releases(client: BandaiClient, *, since: date, max_pages: int = 4) -> list[BandaiRelease]:
    """Releases dated on or after ``since``. Pages run newest first, so we stop
    at the first page whose newest release is already older than ``since``."""
    out: list[BandaiRelease] = []
    for n in range(1, max_pages + 1):
        found = parse_page(client.page(n))
        if not found:
            break
        out.extend(r for r in found if r.release_date >= since)
        if max(r.release_date for r in found) < since:
            break
    return out
