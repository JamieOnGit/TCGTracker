"""Retailer adapters are plug-ins (brief 9.1): one module per retailer in
``tcgworkers/drops/adapters/``, registered in ``REGISTRY``. Adding Target AU
or Amazon AU later means one new module and one row in ``retailers``.

Source preference, in order (brief 9.2):
1. public JSON endpoints the site's own frontend uses
2. sitemaps and feeds
3. category and search HTML
4. Playwright, only if required

No concrete adapters are enabled yet: each waits on Jamie signing off the
ToS/robots review in docs/research/04-retailers.md.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable

from tcgworkers.drops.http import PoliteClient
from tcgworkers.drops.models import Observation


class RetailerAdapter(ABC):
    slug: str
    name: str

    @abstractmethod
    def discover(self, client: PoliteClient) -> Iterable[Observation]:
        """Broad discovery: category/search listings. Runs on the slow interval."""

    def watch(self, client: PoliteClient, urls: Iterable[str]) -> Iterable[Observation]:
        """Priority watchlist items. Runs on the fast (60-120s) interval.
        Defaults to discovery; override when the retailer has a cheap
        per-product endpoint."""
        return self.discover(client)


REGISTRY: dict[str, type[RetailerAdapter]] = {}


def register(cls: type[RetailerAdapter]) -> type[RetailerAdapter]:
    REGISTRY[cls.slug] = cls
    return cls
