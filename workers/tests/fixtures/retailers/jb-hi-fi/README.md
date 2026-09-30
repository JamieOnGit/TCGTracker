# JB Hi-Fi fixtures

Fetched 2026-09-27 from a cloud container (US egress, not AU or residential). Trimmed to a few hits and selected fields. No personal data.

| File | Source | What it shows |
|---|---|---|
| `algolia-query-pokemon-tcg.json` | `POST https://vtvkm5urpx-dsn.algolia.net/1/indexes/shopify_products_families/query` (app `VTVKM5URPX`, with the public search-only key embedded in the storefront). The filter is the same one the collection page `/collections/pokemon-trading-cards_1eld66jvxxoxw0ae4rjd36` sends: `("facets.Game type":"Trading card games" OR "category_hierarchy":"Trading card games") AND ("facets.Brands":"Pokemon TCG" OR "facets.Primary franchise":"Pokemon") AND (price > 0 AND product_published = 1 AND availability.displayProduct = 1)` | 3 hits: one in stock, one pre-order (`availability.canPreOrder=true`, `productLifecycle=PreOrder`, `availableNow="Coming Soon"`, `button="PreOrder"`, `banner_tags.label="Pre-Order"`) and one LimitedStock. The key fields are `availability.overallStatus`, `deliveryStatus`, `clickNCollectStatus`, `canBuyOnline`, `price`, `release_date` (epoch), `isMarketplace` and `in_stock_store_ids`. |
| `algolia-query-one-piece-marketplace.json` | Same endpoint, `query: "one piece card game"` with the trading-card-games filter | Every one of the 122 OPCG hits has `isMarketplace: true`, which means third-party sellers and no first-party JB OPCG stock on the fetch date. SKUs have 8 digits (10xxxxxx). |
| `shopify-product-js.json` | `GET https://www.jbhifi.com.au/products/{handle}.js` (Shopify AJAX product endpoint) | Shopify's view of a product: `available`, `variants[].available`, `price` in cents, and `tags` (such as `InStock`). The description is truncated. |

| `storefront-config-snippet.txt` | Fetched 2026-09-28. The theme `<script src=".../cdn/shop/t/{themeId}/assets/bundle.{hash}.js">` tags from the collection page HTML, the inline `window.featureFlags.searchProvider` and collection `filters`, and the webpack module object `{app_id:"…",search_api_key:"…",index_products:"…"}` from `bundle.86cb2b098f20e475.js` | Where a worker finds the Algolia app id and the public search-only key at runtime. See `docs/research/07-retailers-pricing-ebay.md` §B for the discovery algorithm and regex. |

Note: `/collections/{handle}/products.json` returns `{"products":[]}` for these Algolia-driven smart collections, so it can't be used.
