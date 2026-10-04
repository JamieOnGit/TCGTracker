"""pokemontcg.io: a free, open database of English Pokémon cards with
high-resolution scans. It has the subsets TCGdex has no images for (Shiny
Vault, Trainer Gallery, Galarian Gallery, Black Star promos).

``GET /v2/cards?q=...&select=...`` searches cards (Lucene-like syntax). Without
an API key it allows 1,000 requests a day and 30 a minute; the service
sometimes answers 5xx, so requests are retried with backoff.
"""

from __future__ import annotations

from typing import Any

from tcgworkers.sources.images.http import PoliteClient

SOURCE = "pokemontcg"
BASE_URL = "https://api.pokemontcg.io"
SELECT = "id,name,number,images,set"


def card_image(card: dict[str, Any]) -> str | None:
    images = card.get("images") or {}
    for size in ("large", "small"):
        url = images.get(size) if isinstance(images, dict) else None
        if isinstance(url, str) and url.startswith("https://"):
            return url
    return None


def _quote(value: str) -> str:
    return '"' + value.replace("\\", "").replace('"', "") + '"'


def query_for(cards: list[tuple[str, list[str]]]) -> str:
    """``[(name, [number forms])]`` -> one query matching any of the cards:
    ``(name:"Charizard VMAX" (number:"SV107")) OR (...)``."""
    parts = []
    for name, numbers in cards:
        nums = " OR ".join(f"number:{_quote(n)}" for n in dict.fromkeys(numbers))
        parts.append(f"(name:{_quote(name)} ({nums}))")
    return " OR ".join(parts)


class PokemonTcgClient(PoliteClient):
    def __init__(self, *, user_agent: str, max_requests: int, **kw: Any) -> None:
        kw.setdefault("min_interval", 2.1)  # 30 a minute
        kw.setdefault("retries", 4)
        super().__init__(BASE_URL, user_agent=user_agent, max_requests=max_requests, **kw)

    def sets(self) -> list[dict[str, Any]]:
        """Every set (one request): id, name, ptcgoCode, printedTotal."""
        body = self.get_json("/v2/sets", {"select": "id,name,ptcgoCode,printedTotal", "pageSize": 250}) or {}
        return [s for s in body.get("data") or [] if isinstance(s, dict)]

    def search(self, q: str) -> list[dict[str, Any]]:
        """Every card matching ``q`` (pages of 250)."""
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            body = self.get_json("/v2/cards", {"q": q, "select": SELECT, "pageSize": 250, "page": page}) or {}
            rows = [c for c in body.get("data") or [] if isinstance(c, dict)]
            out.extend(rows)
            total = body.get("totalCount")
            if not rows or not isinstance(total, int) or page * 250 >= total:
                return out
            page += 1
