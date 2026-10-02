# Kmart fixtures

Trimmed from the live site on 2 Oct 2026. Kmart served these pages with HTTP 200 to `TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/)`, and its robots.txt allows `/category/` and `/product/` pages.
- `category.html`: the category page's schema.org `ItemList`, cut down to 3 products.
- `product_preorder.html`: `__NEXT_DATA__.props.pageProps.productDetail` for a Kmart pre-order (30th Celebration Booster Bundle, `isPreOrderActive`).
- `product_nostock.html`: a Kmart Marketplace (third-party seller) listing that is out of stock in every state except NSW.

(On 27 Sep 2026 the same site returned Akamai 403 to a US cloud container. That is why it was disabled until it was re-checked.)
