"""Retailer adapters are plug-ins (brief 9.1): one module per retailer in
``tcgworkers/drops/adapters/``, registered in ``REGISTRY``. Adding Target AU
or Amazon AU later means one new module and one row in ``retailers``.

Source preference, in order (brief 9.2):
1. public JSON endpoints the site's own frontend uses
2. sitemaps and feeds
3. category and search HTML
4. Playwright, only if required

Each adapter is switched on (retailers.enabled) only after its ToS/robots
review is signed off: docs/research/04-retailers.md and 07-retailers-pricing-ebay.md.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from collections.abc import Iterable
from typing import Any

from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.models import Observation


class AdapterBlocked(RuntimeError):
    """The retailer can't be read legitimately from where we run (bot
    protection at the edge, robots, or terms). Raised on every cycle so the
    health columns count it and an admin alert fires; never worked around."""


_NEXT_DATA = re.compile(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.DOTALL)


def next_data(html: str) -> dict[str, Any]:
    """The server-rendered Next.js payload (the page's own data)."""
    m = _NEXT_DATA.search(html)
    if not m:
        raise ValueError("no __NEXT_DATA__ script in page (layout changed or a challenge page)")
    data = json.loads(m.group(1))
    if not isinstance(data, dict):
        raise ValueError("__NEXT_DATA__ is not an object")
    return data


class RetailerAdapter(ABC):
    slug: str
    name: str

    @abstractmethod
    def discover(self, client: PoliteClient) -> Iterable[Observation]:
        """Broad discovery: category/search listings. Runs on the slow interval."""

    def watch(self, client: PoliteClient, urls: Iterable[str]) -> Iterable[Observation]:
        """Priority watchlist items (``watchlist`` rows of kind ``url`` or
        ``sku``). Runs on the fast (60-120s) interval. Defaults to discovery;
        override when the retailer has a cheap per-product endpoint."""
        return self.discover(client)


REGISTRY: dict[str, type[RetailerAdapter]] = {}


def register(cls: type[RetailerAdapter]) -> type[RetailerAdapter]:
    REGISTRY[cls.slug] = cls
    return cls
