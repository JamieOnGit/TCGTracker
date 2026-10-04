"""One Piece card images from Bandai's official card lists, found through
optcgapi.com (a free One Piece TCG card database).

optcgapi lists every print of every card (2 requests: booster sets and
starter decks), each with a print id such as ``OP05-119`` (the base art),
``OP05-119_p1`` (a parallel / alternate art) or ``OP05-119_r1`` (a reprint).
Bandai's card list publishes each print's image under that same id:
``https://en.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png``
(Japanese: ``www.onepiece-cardgame.com``). optcgapi's own copy of the image
is the fallback.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from tcgworkers.matching.matcher import normalise_number
from tcgworkers.sources.images.http import PoliteClient
from tcgworkers.sources.pricing.pricecharting import normalise_pc_variant

BASE_URL = "https://optcgapi.com"
BANDAI = {
    "en": "https://en.onepiece-cardgame.com/images/cardlist/card/{id}.png",
    "jp": "https://www.onepiece-cardgame.com/images/cardlist/card/{id}.png",
}
_PARENS = re.compile(r"\(([^)]*)\)")
# Parenthesised parts that say nothing about the artwork: a card number
# ("(119)", "(OP05-119)") or that the print is a reprint.
_NUMBER_SUFFIX = re.compile(r"\s+-\s+[A-Z]{0,4}\d{1,3}-\d{1,3}$", re.IGNORECASE)  # "Shanks - OP09-004"
_NOT_VARIANT = re.compile(r"^([A-Z]{0,4}\d{0,3}-?\d{1,3}|reprint)$", re.IGNORECASE)


@dataclass(frozen=True)
class OpPrint:
    number: str  # normalised card number, e.g. OP05-119
    name: str
    variant: str  # our variant vocabulary: standard, alt-art, manga-alt-art, sp...
    set_name: str
    set_code: str  # OP05, ST01, EB01...
    image_id: str  # OP05-119_p1
    image: str | None  # optcgapi's copy


def parse_print(row: dict[str, Any]) -> OpPrint | None:
    number = normalise_number(str(row.get("card_set_id") or ""))
    image_id = str(row.get("card_image_id") or "").strip()
    if not number or not re.fullmatch(r"[A-Za-z0-9_\-]+", image_id):
        return None
    raw = " ".join(str(row.get("card_name") or "").split())
    parts = [p.strip() for p in _PARENS.findall(raw) if p.strip() and not _NOT_VARIANT.match(p.strip())]
    image = row.get("card_image")
    return OpPrint(
        number=number,
        name=_NUMBER_SUFFIX.sub("", " ".join(_PARENS.sub(" ", raw).split())),
        # Read together like JustTCG's names: "(Alternate Art) (Manga)" is one variant.
        variant=normalise_pc_variant([" ".join(parts)] if parts else []),
        set_name=str(row.get("set_name") or ""),
        set_code=re.sub(r"[^A-Z0-9]", "", str(row.get("set_id") or "").upper()),
        image_id=image_id,
        image=image if isinstance(image, str) and image.startswith("https://") else None,
    )


def bandai_image(image_id: str, lang: str) -> str | None:
    template = BANDAI.get(lang)
    return template.format(id=image_id) if template else None


class OptcgClient(PoliteClient):
    def __init__(self, *, user_agent: str, max_requests: int = 10, **kw: Any) -> None:
        kw.setdefault("min_interval", 1.0)
        kw.setdefault("timeout", 90.0)  # the full lists are a few MB
        super().__init__(BASE_URL, user_agent=user_agent, max_requests=max_requests, **kw)

    def prints(self) -> list[OpPrint]:
        out: list[OpPrint] = []
        for path in ("/api/allSetCards/", "/api/allSTCards/"):
            body = self.get_json(path) or []
            for row in body if isinstance(body, list) else []:
                p = parse_print(row) if isinstance(row, dict) else None
                if p:
                    out.append(p)
        return out
