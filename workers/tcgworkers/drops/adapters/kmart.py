"""Kmart adapter skeleton (registered, retailer row DISABLED).

docs/research/07-retailers-pricing-ebay.md §C: Kmart's Akamai edge denies
cloud IPs. robots ``Disallow: /api/`` and ``*?postcode=``, so any data must
come from server-rendered HTML on allowed paths (e.g.
``/category/toys/pokemon-trading-cards/``), never the JSON API.

Until the Fly.io syd probe (07 §C.4) passes, every cycle raises
``AdapterBlocked`` without making a request.
"""

from __future__ import annotations

from tcgworkers.drops.adapters.category_page import CategoryPageAdapter
from tcgworkers.drops.base import register


@register
class Kmart(CategoryPageAdapter):
    slug = "kmart"
    name = "Kmart"
    category_urls = ("https://www.kmart.com.au/category/toys/pokemon-trading-cards/",)
    verified = False
    blocked_reason = (
        "Kmart is not verified: its Akamai edge denies cloud IPs and robots disallows /api/ "
        "(docs/research/07 §C). Run the Fly.io syd probe (07 §C.4) and write the parser before enabling."
    )
