"""Shared base for retailers read from their own server-rendered category
pages (Target AU, and BIG W / Kmart once verified).

Only robots-allowed category URLs are fetched, with no sort/view/filter
parameters and no search pages; the product data is the page's own
``__NEXT_DATA__``. Nothing here calls a retailer's search vendor
(Constructor.io etc.) or any endpoint the retailer hasn't exposed on the page.

An adapter whose ``verified`` flag is False raises ``AdapterBlocked`` before
making any request: the retailer denies cloud IPs at the edge (07 §C) and
must first pass the Fly.io ``syd`` probe in 07 §C.4.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from tcgworkers.drops.base import AdapterBlocked, RetailerAdapter, next_data
from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.models import Observation


class CategoryPageAdapter(RetailerAdapter):
    category_urls: tuple[str, ...] = ()
    verified: bool = True
    blocked_reason: str = ""

    def discover(self, client: PoliteClient) -> Iterable[Observation]:
        if not self.verified:
            raise AdapterBlocked(self.blocked_reason or f"{self.name} is not verified for automated reading")
        out: list[Observation] = []
        for url in self.category_urls:
            html = client.get(url).text
            try:
                data = next_data(html)
            except ValueError as exc:
                raise AdapterBlocked(f"{self.name}: {url}: {exc}") from exc
            out.extend(self.parse(data, category_url=url, observed_at=datetime.now(UTC)))
        return out

    def parse(self, data: dict[str, Any], *, category_url: str, observed_at: datetime) -> list[Observation]:
        raise AdapterBlocked(f"{self.name}: category page parser not written yet")
