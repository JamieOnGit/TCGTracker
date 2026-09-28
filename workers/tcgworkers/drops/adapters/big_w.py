"""BIG W adapter skeleton (registered, retailer row DISABLED).

docs/research/07-retailers-pricing-ebay.md §C: BIG W's Akamai edge denies
cloud IPs (403 / HTTP/1.1 tarpit). robots allows plain category and product
pages but disallows search and any ``?filter``/``?sort`` URL.

Until the Fly.io syd probe (07 §C.4) shows category HTML is served to an
honest bot UA, every cycle raises ``AdapterBlocked`` without making a
request, so enabling it by mistake produces a health alert, not traffic.
Preferred route: BIG W's affiliate programme on Impact (catalogue feed).
"""

from __future__ import annotations

from tcgworkers.drops.adapters.category_page import CategoryPageAdapter
from tcgworkers.drops.base import register


@register
class BigW(CategoryPageAdapter):
    slug = "big-w"
    name = "BIG W"
    # Fill in from the sitemap once reachable (07 §C.4 step 3).
    category_urls = ()
    verified = False
    blocked_reason = (
        "BIG W is not verified: its Akamai edge denies cloud IPs (docs/research/07 §C). "
        "Run the Fly.io syd probe (07 §C.4) and add the category URLs and parser before enabling."
    )
