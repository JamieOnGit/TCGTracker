"""Release dates that Australian stores publish on their own product pages.

Stores word them many ways; seen live (Oct 2026):

* title: ``Delta Reign Booster Box (Releases 6 Nov 2026)``, ``… (Releases Dec 2026)``
* description: ``Delta Reign releases November 6, 2026.``,
  ``Pre-Order Releases 6 November 2026``, ``a pre-order item releasing 6 November 2026``,
  ``Pre-order Product Release Date: 06-November-2026``

A date only counts when it follows a release word (release, street date,
launch, out on, available from, expected, ETA), so "ships 2-5 days from
release date" or a publish date never becomes a release date. Numeric dates
are read the Australian way (day/month/year). A month without a day
("Releases Dec 2026") is kept with ``month`` precision.
"""

from __future__ import annotations

import html
import re
from datetime import date

_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9,
    "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}  # fmt: skip
_MON = r"(?P<{n}>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"
_KEYWORD = (
    r"(?:releas(?:e|es|ed|ing)(?:\s+date)?|street\s+date|launch(?:es|ing|ed)?(?:\s+date)?|out\s+on"
    r"|available\s+(?:from|on)|expected(?:\s+release)?(?:\s+date)?|eta)"
)
# Glue between the keyword and the date: "on", ":", "date:", "is", "from", "in" …
_GLUE = r"[\s:\-–—,]*(?:(?:on|is|from|in|date|by|of)[\s:\-–—,]+)*"
_DATES = [
    # 6 November 2026 / 6th Nov 2026 / 06-November-2026
    rf"(?P<d1>\d{{1,2}})(?:st|nd|rd|th)?[\s\-/]+{_MON.format(n='m1')}[\s\-/,]+(?P<y1>20\d\d)",
    # November 6, 2026 / Nov 6th 2026
    rf"{_MON.format(n='m2')}\s+(?P<d2>\d{{1,2}})(?:st|nd|rd|th)?,?\s+(?P<y2>20\d\d)",
    # 06/11/2026 (Australian day/month/year)
    r"(?P<d3>\d{1,2})[/.](?P<n3>\d{1,2})[/.](?P<y3>20\d\d)",
    # 2026-11-06
    r"(?P<y4>20\d\d)-(?P<n4>\d{2})-(?P<d4>\d{2})",
    # Dec 2026 / December, 2026 (month precision)
    rf"{_MON.format(n='m5')},?\s+(?P<y5>20\d\d)",
]
_PATTERN = re.compile(rf"\b{_KEYWORD}{_GLUE}(?:{'|'.join(_DATES)})", re.IGNORECASE)
_STRIP = re.compile(r"<(script|style)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL)


def plain_text(body_html: str | None, limit: int = 20000) -> str:
    """Visible text of a product description (no styles or scripts)."""
    text = _STRIP.sub(" ", (body_html or "")[: limit * 3])
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _date(m: re.Match[str]) -> tuple[date, str] | None:
    g = m.groupdict()
    try:
        if g["d1"]:
            return date(int(g["y1"]), _MONTHS[g["m1"].lower().rstrip(".")], int(g["d1"])), "day"
        if g["d2"]:
            return date(int(g["y2"]), _MONTHS[g["m2"].lower().rstrip(".")], int(g["d2"])), "day"
        if g["d3"]:
            return date(int(g["y3"]), int(g["n3"]), int(g["d3"])), "day"
        if g["d4"]:
            return date(int(g["y4"]), int(g["n4"]), int(g["d4"])), "day"
        if g["m5"]:
            return date(int(g["y5"]), _MONTHS[g["m5"].lower().rstrip(".")], 1), "month"
    except (ValueError, KeyError):
        return None
    return None


def find_release_date(*texts: str | None, today: date | None = None) -> tuple[date, str] | None:
    """The first release date in ``texts`` (title first, then description,
    then tags), as (date, 'day' | 'month'). Dates more than a year back or two
    years ahead are ignored as typos or unrelated."""
    today = today or date.today()
    for text in texts:
        if not text:
            continue
        for m in _PATTERN.finditer(text):
            found = _date(m)
            if found and (today.year - 1) <= found[0].year <= (today.year + 2):
                return found
    return None
