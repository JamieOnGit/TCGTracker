# Premium Bandai AU fixtures

Fetched 2026-09-27 from a cloud container (US egress, Ashburn, not an AU or residential IP). Trimmed: only the first 3 products and 1 image per product are kept. No personal data.

| File | Source | What it shows |
|---|---|---|
| `search-api-onepiececardgame.json` | `GET https://p-bandai.com/api/search?_f_brands=06-0074` with the headers `X-G1-Area-Code: au`, `X-Requested-With: XMLHttpRequest` and `Accept: application/json` | The search JSON that the site's own frontend calls. Holds `productResults.products[]` (`productCode`, `productType` = `PreOrder`, `saleStatus` = `End`, `saleStartExpectedDt`/`saleEndExpectedDt`, `flags` = `PRE_ORDER_CLOSED`, `fixedListPrice`) plus `aggs` (productStatuses Waiting/On/End, shippingMonths, shops = BANDAI CARD SHOP). All 19 OPCG items were `End` on the fetch date. If the `X-G1-Area-Code` header is missing, the API returns HTTP 500. |
| `fillProductDetailFlags-response.json` | `POST https://p-bandai.com/api/products/fillProductDetailFlags`, called by the brand page `/au/brand/onepiececardgame` (captured through a Playwright network log) | The label enrichment the frontend applies to product tiles: `flags: ["PRE-ORDER"]` and `productFlags[].labelCode = PRE_ORDER`. These are Gunpla and figure items from a homepage widget, not TCG. |
| `sitemap-product-au-excerpt.xml` | `https://p-bandai.com/au/sitemap-product_1.xml` (691 URLs) | The sitemap entry format: `<loc>/au/item/{productCode}</loc>` + `<lastmod>` + images. There are **no titles**, so a TCG item can't be identified from the sitemap alone. |

Note: the item pages (`/au/item/*`) and the HTML search page (`/au/search?...`) returned an F5 Distributed Cloud (`server: volt-adc`) JavaScript bot-defence interstitial, and after that "PAGE NOT AVAILABLE" (XHR 501), to both curl and headless Chromium from this IP. We did not try to get past it.
