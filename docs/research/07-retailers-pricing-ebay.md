# 07: Target AU, JB Hi-Fi runtime config, BIG W/Kmart re-check, PriceCharting API, eBay Partner Network

**Date:** 2026-09-28
**Project:** TCGTracker (tcgtracker.com.au)
**Builds on:** `04-retailers.md` (retailers) and `02-pricing-sources.md` (pricing).
**Method:** robots.txt was read first. We then made a small number of curl requests and headless Chromium visits (Playwright, `/opt/pw-browsers/chromium-1194`), spaced seconds apart, with no cart or checkout actions and no challenge solving. When a live site blocked us, we read **public Internet Archive (Wayback Machine) snapshots** instead. These show page shape, not current data.

> **Network caveat (unchanged from 04):** requests left a US cloud egress (Cloudflare `IAD`), not an AU residential or AU datacenter IP. Anything that depends on this is marked **UNVERIFIED**.
>
> **Environment note:** Chromium's NSS store (`/root/.pki/nssdb`) was empty, so headless Chrome failed with `ERR_CERT_AUTHORITY_INVALID`. We added the agent-proxy CA (`/root/.ccr/agent-proxy-ca.crt`) with `certutil -A -t "C,,"`, as the proxy README intends. TLS verification was **not** disabled.

---

## Summary

| Part | Result | Confidence |
|---|---|---|
| **A. Target AU** | **Akamai 403 at the edge** from cloud (curl and Chromium). From Wayback: a Next.js storefront (`/uir-plp`, `/uir-pdp`) over SAP Hybris-era paths (`/medias/`, `/_ui/`), with **Constructor.io** search/browse, a BFF GraphQL endpoint, and an Akamai Bot Manager sensor script. **The ToS forbids deep-linking without consent.** Fixtures come from Wayback. | Medium on shape, low on live endpoints |
| **B. JB Hi-Fi** | The Algolia app id and search key live in a **theme webpack bundle** (`/cdn/shop/t/{theme}/assets/bundle.{hash}.js`) as `{app_id:"…",search_api_key:"…",index_products:"…"}`. There is a stable regex, and discovery is 1 HTML request plus at most about 17 JS requests. Per-SKU `getObject`, multi-get and `filters: sku:X OR sku:Y` all work with the public key. | High |
| **C. BIG W / Kmart** | Both still get **Akamai 403** from cloud. robots.txt was recovered from Wayback. The affiliate programmes exist (BIG W on Impact; Kmart and Target unconfirmed), but no public product feed was found. There is a test plan for Fly.io `syd`. | Low (blocked) |
| **D. PriceCharting** | Fully documented from `/api-documentation`: `t=` token, `/api/product`, `/api/products`, CSV, **1 call/s** and **CSV 1 per 10 min**, prices in **integer US cents**. For cards: `loose-price` = ungraded, `cib-price` = Grade 7/7.5, `new-price` = Grade 8/8.5, `graded-price` = Grade 9 (any grader), `box-only-price` = 9.5, `manual-only-price` = **PSA 10**, `bgs-10-price`, `condition-17-price` = CGC 10, `condition-18-price` = SGC 10. `sales-volume` and `release-date` exist. | High (CSV URL UNVERIFIED) |
| **E. eBay Partner Network (AU)** | AU rotation id **`705-53470-19255-0`**. Link format: append `mkcid=1&mkrid=705-53470-19255-0&siteid=15&campid={10-digit}&customid={subid}&toolid=10001&mkevt=1`. **Email/SMS/push alerts containing EPN links need prior written EPN approval ("Special Business Model").** Disclosure must sit next to the links. Category `183454` = CCG Individual Cards. | Medium-high (developer.ebay.com returned 403) |

---

## A. Target Australia: `https://www.target.com.au`

### A.1 What we observed live (2026-09-28, cloud IP)
- `curl https://www.target.com.au/robots.txt` returned **HTTP/2 403 "Access Denied"**, `server: AkamaiGHost`, reference `errors.edgesuite.net/18.d41c2117.1790590682…`.
- Headless Chromium `GET /` returned **403 "Access Denied"** (`18.d51c2117…`). The 403 still carried a `Link:` preload header for `/_ui/_assets/fonts/…` (the SAP Hybris `_ui` convention).
- We made no bypass attempt. `https://www.target.com.au/businessupdate` also returned 403 to WebFetch.

### A.2 robots.txt (Wayback snapshot 2026-05-01, `web.archive.org/web/20260501013622id_/https://www.target.com.au/robots.txt`)
Saved as `workers/tests/fixtures/retailers/target-au/robots-wayback-20260501.txt`.
```
User-agent: *
Disallow: /checkout/   /my-account/   /~/   /spc/   /communities/donate   /target-talk
Disallow: /expired-link  /expired-email-link  /no-its-not  /yes-its-me  /enews/quick
Disallow: /search/*
Disallow: /enableauth0login
Disallow: *&viewAs=grid   *?viewAs=grid   *sortBy=   *sortOrder=   *?newarrivals
Sitemap: https://www.target.com.au/sitemap-index.xml
(Googlebot: same list plus Allow: / and Allow: /medias/; CazoodleBot, MJ12bot, dotbot/1.0, Gigabot: Disallow: /)
```
- There is no crawl-delay. Category (`/c/...`) and product (`/p/...`) pages are allowed. `/search/*` and sort params are disallowed.

### A.3 Sitemaps (Wayback snapshot 2026-05-01)
`/sitemap-index.xml` lists:
- `https://www.target.com.au/content-sitemap.xml`
- `https://www.target.com.au/category-sitemap.xml`
- `https://www.target.com.au/medias/feeds/sitemap/brand-sitemap.xml`
- `https://www.target.com.au/stores-sitemap.xml`
- `https://www.target.com.au/medias/feeds/sitemap/sitemap.xml` (the product sitemap, by the Hybris `/medias/feeds` convention; its contents are UNVERIFIED)

### A.4 Platform
The following comes from the `__NEXT_DATA__` in the Wayback snapshots of the category and product pages:
- **Next.js micro-frontends**: `assetPrefix: "/uir-plp"` (listing), `"/uir-pdp"` (product). There is a `buildId` per deploy, and `__N_SSP: true` (server-side rendered, so the first page of products is already in the HTML).
- **Search/browse: Constructor.io.** Evidence: `runtimeConfig.NEXT_PUBLIC_CONSTRUCTOR_API_KEY = "key_kWcXakjuyHSxpu75"`, and the DOM attributes `data-cnstrc-browse`, `data-cnstrc-filter-name="group_id"`, `data-cnstrc-filter-value="W1852642"`, `data-cnstrc-item-id="P72533239"`.
- **BFF GraphQL:** `NEXT_PUBLIC_BFF_URL = "https://www.target.com.au/uir-bff/graphql"`. Feature flags show a migration in progress: `uirBffPlpPages: true`, `uirBffPlpComponent: true`, `uirBffPdpPages: true`, `uirBffPdpProducts: false`, `uirBffStoreQuery: false`.
- A services host: `NEXT_PUBLIC_SERVICES_API_HOST = "https://api.target.com.au"`.
- Other services: Auth0 login, Bazaarvoice reviews, **Yottaa** (`rapid-cdn.yottaa.com`), Split.io, GTM, and images on `assets.target.com.au`.
- **Bot protection:** Akamai edge denial, plus an obfuscated same-origin script (`/BKifyVcbf6Fk7/R2Esz6EF8Fq/...`) of the kind **Akamai Bot Manager** uses for its sensor script.
- **Corporate context:** Target and Kmart have run as one Wesfarmers business ("Kmart Group") since July 2023. The brands and websites remain separate ([Wikipedia](https://en.wikipedia.org/wiki/Target_Australia), [ABC](https://www.abc.net.au/news/2023-07-25/kmart-and-target-merger-no-change-stores/102643226)). The Kmart 403 sets the cookie `mnm_rollout=TARGET_MARKETPLACE`, which suggests shared infrastructure (UNVERIFIED).

### A.5 Category and product URLs
| What | URL | Id |
|---|---|---|
| Pokémon TCG category | `https://www.target.com.au/c/toys/trading-card-games/pokemon-cards/W1852642` | `categoryCode` / Constructor `group_id` = `W1852642` |
| One Piece Card Game category | `https://www.target.com.au/c/toys/trading-card-games/one-piece-trading-cards/W130520251` (from search-engine results; not fetched) | `W130520251` |
| Parent "Trading Card Games" | `https://www.target.com.au/c/toys/trading-card-games/W1852625` | `W1852625` |
| Brand page | `https://www.target.com.au/b/pokemon` | |
| Pre-order info | `https://www.target.com.au/pre-order` | |
| Product | `https://www.target.com.au/p/{slug}/{code}`, e.g. `/p/pokemon-tcg-mega-evolution-perfect-order-blister-assorted/72554982` | `code` = 8 digits; `baseProduct` = `P` + code |

The OPCG products we saw in search results include OP-09, OP-11, OP-12 (12-pack), OP-13, OP-14 and OP-15 booster packs, Illustration Boxes and "Learn Together Deck Set", so **Target is a first-party OPCG retailer**, unlike JB.

### A.6 JSON endpoints the frontend uses
| Endpoint | Status | Notes |
|---|---|---|
| SSR `__NEXT_DATA__` in `/c/{…}/{categoryCode}` HTML | **Observed (Wayback)** | `props.pageProps.metadata.productList.{products[],filters[],totalNumProducts,sortOptions}`. This is the page's own data, so robots-clean. Blocked live from cloud. |
| SSR `__NEXT_DATA__` in `/p/{slug}/{code}` HTML | **Observed (Wayback)** | `props.pageProps.product` holds the full product record, delivery modes included. |
| `/uir-plp/_next/data/{buildId}/c/{…}.json` | UNVERIFIED | Standard Next.js client-navigation JSON for a `getServerSideProps` page. It would return the same `pageProps` without HTML. Needs `buildId` from a page. |
| Constructor.io browse, e.g. `https://ac.cnstrc.com/browse/group_id/W1852642?key=key_kWcXakjuyHSxpu75&c=…&i=…&s=…&page=1&num_results_per_page=…` | UNVERIFIED (URL shape taken from Constructor's public client docs; **not called**) | The frontend's own search vendor. **We did not call it.** Calling a vendor API with a harvested key to get round the retailer's Akamai block is circumvention in substance. Needs Target's consent. |
| `https://www.target.com.au/uir-bff/graphql` | UNVERIFIED (not called) | Used for PDP/PLP pieces, cart and stock. Behind the same Akamai. |
| `https://api.target.com.au/...` | UNVERIFIED | Services host (store stock or delivery estimates, per the flag names `uirPdpStockAvailability`, `uirPdpNearestStore`). |

### A.7 How price, stock, channel and pre-order are signalled (from the Wayback `__NEXT_DATA__`)
**Listing (`productList.products[]`):**
- `price.offerPrice` is **AUD dollars as a float** (`8.5`). There is also `wasPrice`, `onePassPrice`, `priceRange{min,max}` and `recommendedRetailPrice`.
- `variations[].productDisplayType`: seen **`AVAILABLE_FOR_SALE`** and **`COMING_SOON`**. `variations[].inStock` is a boolean, and `variations[].comingSoon` is a boolean.
- `labelProps.onlineDate` (epoch seconds, the date it went online), `labelProps.pTypeCode` (`normal`; a pre-order value is UNVERIFIED), `onlineExclusive`, `targetExclusive`, `clearance`, `bestSeller`, `totalInterest`.
- `onePassEarlyAccess`, `onePassStartDate`/`EndDate`, `onepassexclusive`, `onepassexclusivestartdate`/`enddate`: **OnePass (paid membership) early-access windows**. This is relevant for drops, because members may get first access.
- `filters[]` includes `deliverymodes` (`Home Delivery`, `Click & Collect` with counts) and `newarrivals` (`True`/`False`).

**Product page (`pageProps.product`):**
- `productAvailability` (`NORMAL`; other values UNVERIFIED), `comingSoon`, `displayOnly`, `onlineOnly`, `productTypeCode`.
- `deliveryModes.homeDelivery.available`, `deliveryModes.expressDelivery.available`, **`deliveryModes.clickAndCollect.available`**, and `cncIstAllowed` (click & collect inter-store transfer).
- `price.{value, currencyIso:"AUD"}`, `purchasableVariantCodes[]`.
- Store-level stock is not in the SSR payload. It is fetched client-side (the `uirPdpStockAvailability`/`uirPdpNearestStore` flags; endpoint UNVERIFIED).

**Pre-order rules** (`/pre-order`, Wayback 2026-03-11): "Add one pre-order item to cart. To pre-order multiple products, please place separate orders." "**You currently cannot pre-order products with Click & Collect.**" "Your pre-order ships on the product release date." The ToS adds: "Payment in full is required if you pre-order this product. Due to strict supplier embargo, pre-order products cannot be delivered prior to the official release date." The field that marks an item as pre-order is **UNVERIFIED** (candidates are `pTypeCode`, `productDisplayType` or `productAvailability`). We need a live capture of a pre-order product.

### A.8 Terms of use
From `https://www.target.com.au/corporate/condition-of-use` (Wayback 2026-01-01):
> "You recognise and agree that the content contained within this website is only intended for your own personal, non-commercial use and you may only download, print or use content for this purpose. Unless you have prior consent **you must not copy, reproduce, modify, distribute, imitate, publish, commercially exploit or link to or deep-link into this website.** If you're a corporate customer and would like to use any content, photography or logos contained within this site for corporate purposes please contact target.online@target.com.au…"
> "…reserve the right to limit the sale of products to reasonable or normal household quantities."

There is no explicit robots/scraping clause, but there are two problems:
1. The personal, non-commercial clause.
2. **An explicit prohibition on deep-linking without consent.** That clause directly affects an alert service that links to `/p/...` pages.

### A.9 Implementation notes (Target AU)
1. **Do not poll Target from the cloud today.** The edge is Akamai-denied, and Akamai Bot Manager's sensor is present. Getting past it means solving the sensor, which is out of scope. Don't call `ac.cnstrc.com` with Target's key either; see A.6.
2. **Ask for consent first.** Email `target.online@target.com.au` covering both automated reading of public category pages and deep-linking. Until consent is given, alerts should say "Target: check Target's Pokémon page" and link to the **category** page at most. Even that is "linking" under the ToS, so get sign-off from Jamie.
3. If consent is given (or the Fly.io syd test in C.4 shows the category HTML is served), the robots-clean parser is:
   - `GET https://www.target.com.au/c/toys/trading-card-games/pokemon-cards/W1852642` and `…/one-piece-trading-cards/W130520251` (**no** `sortBy`/`sortOrder`/`viewAs`/`newarrivals` params).
   - Extract `<script id="__NEXT_DATA__" type="application/json">(.*?)</script>`, then `JSON.parse`, then `props.pageProps.metadata.productList.products`.
   - Key = `id` (`P\d{8}`). Signals = `variations[0].{productDisplayType,inStock,comingSoon}`, `price.offerPrice`, `labelProps.onlineDate`, `onePassEarlyAccess`/`onepassexclusive` + dates.
   - Alert on: a new `id`; `COMING_SOON` → `AVAILABLE_FOR_SALE`; `inStock` false → true.
   - Page 2+ uses `?page=N` (the param name is UNVERIFIED; `paginationOptions.page` exists).
4. Interval, if allowed: 10–15 min for 2 category pages.
5. Fixtures: `workers/tests/fixtures/retailers/target-au/` holds `plp-pokemon-cards-nextdata.json`, `pdp-pokemon-blister-nextdata.json` and `robots-wayback-20260501.txt`, with a README.

---

## B. JB Hi-Fi: runtime discovery of the Algolia credentials (approved retailer)

### B.1 Where the credentials live (verified 2026-09-28)
- The collection page HTML (`https://www.jbhifi.com.au/collections/pokemon-trading-cards_1eld66jvxxoxw0ae4rjd36`, 97 KB) **does not contain the app id or key inline**. It contains:
  - `window.featureFlags.searchProvider = "algolia";` (and `optimizelyTestSearchProvider`)
  - the collection's own filter in inline JS: `var filters = '("facets.Game type": "Trading card games" OR "category_hierarchy":"Trading card games") AND ("facets.Brands": "Pokemon TCG" OR "facets.Primary franchise": "Pokemon")';`
  - also `var googleFilters = 'attributes.categoryHierarchy: ANY(…)'`, which is Google Retail/Vertex search syntax. **JB appears to be preparing, or A/B testing, a switch from Algolia to Google search.** The worker must detect this; see B.4.
  - 17 theme bundle `<script>` tags: `//www.jbhifi.com.au/cdn/shop/t/535/assets/bundle.{16-hex}.js?v=…`, plus `bundle.runtime.js` and `bundle.template.collection.enhanced.js`.
- The credentials are in **one** theme bundle, `bundle.86cb2b098f20e475.js` (51 KB) on this date. They sit in webpack module `76099` as a plain object literal:
  ```js
  let i={app_id:"VTVKM5URPX",search_api_key:"a0c0108d737ad5ab54a0e2da900bf040",index_prefix:"shopify_",index_products:"shopify_products_families",index_suggested_keywords:"shopify_products_families_query_suggestions",index_suggested_categories:"shopify_collections",index_collections:"shopify_collections",index_category_order:"shopify_products_families_facets",sort_orders:[…]
  ```
- The theme id (`t/535`) and the bundle hashes change on every theme deploy. The **object keys** (`app_id`, `search_api_key`, `index_products`) are source-level names, so they survive minification. That makes them the stable anchor.
- Fixture: `workers/tests/fixtures/retailers/jb-hi-fi/storefront-config-snippet.txt` (script tags, inline flags and filters, and the config object excerpt).
- robots.txt: `/cdn/shop/t/*/assets/*.js` is **allowed**. Only `/cdn/wpm/*.js` is disallowed.

### B.2 Discovery algorithm (worker)
```
1. GET https://www.jbhifi.com.au/collections/pokemon-trading-cards_1eld66jvxxoxw0ae4rjd36
   (any collection page works; the homepage probably does too, UNVERIFIED)
2. Check the provider flag:
     /window\.featureFlags\.searchProvider\s*=\s*"([a-z]+)"/   → expect "algolia"; else raise alert "JB search provider changed"
3. Collect bundle URLs:
     /\/\/www\.jbhifi\.com\.au\/cdn\/shop\/t\/\d+\/assets\/bundle\.[0-9a-f]{16}\.js(?:\?v=\d+)?/g
   Try the cached "last good" bundle filename first (same hash ⇒ same key), then the rest,
   sequentially with ≥1 s spacing, stopping at the first match.
4. In each bundle apply:
     /app_id:"([A-Z0-9]{10})",search_api_key:"([0-9a-f]{32})"/
   and, to get the index name:
     /index_products:"([a-z0-9_]+)"/
   Looser fallback if the key order changes:
     /app_id\s*:\s*"([A-Z0-9]{8,12})"/  and  /search_api_key\s*:\s*"([0-9a-f]{32})"/  (same module)
5. Validate with one cheap query (hitsPerPage:0). On HTTP 403 {"message":"Invalid Application-ID or API key"}
   or 404 index → rediscover. Cache {appId, key, index, bundleFile, themeId, fetchedAt} in KV.
```
- Rediscover **daily**, and immediately on any 401/403/404 from Algolia. Normal cost is 1 HTML request + 1 JS request (the cached filename hits). Worst case is about 18 requests.
- Also re-read the inline `var filters = '…'` from the collection HTML during rediscovery. JB merchandisers can change the collection's filter, and using theirs keeps our result set identical to the page.

### B.3 Queries (verified 2026-09-28)
Host: `https://vtvkm5urpx-dsn.algolia.net`. Headers: `x-algolia-application-id: {appId}`, `x-algolia-api-key: {key}`. We also sent `Origin`/`Referer: https://www.jbhifi.com.au/`, although the key does not appear to be referer-restricted (UNVERIFIED).

**Pokémon TCG** (51 hits: 38 marketplace, 13 first-party, of which 1 is `canPreOrder:true`):
```json
POST /1/indexes/shopify_products_families/query
{"query":"","hitsPerPage":100,"distinct":true,
 "filters":"(\"facets.Game type\": \"Trading card games\" OR \"category_hierarchy\":\"Trading card games\") AND (\"facets.Brands\": \"Pokemon TCG\" OR \"facets.Primary franchise\": \"Pokemon\") AND (price > 0 AND product_published = 1 AND availability.displayProduct = 1)",
 "attributesToRetrieve":["sku","title","handle","price","isMarketplace","release_date","availability","in_stock_store_ids"],
 "attributesToHighlight":[]}
```
**One Piece Card Game:** there is no OPCG brand facet. `facets.Brands` across all 2,600 TCG items has no One Piece value, and `facets.Primary franchise:"One Piece"` has only 1 item. Use a text query plus the TCG filter:
```json
{"query":"one piece card game","hitsPerPage":100,
 "filters":"(\"facets.Game type\": \"Trading card games\" OR \"category_hierarchy\":\"Trading card games\") AND price > 0 AND product_published = 1 AND availability.displayProduct = 1"}
```
That gave 122 hits on 2026-09-28, **all `isMarketplace:true`** (vendor `BANDAI`), so JB still has no first-party OPCG. For first-party-only alerts add `AND isMarketplace:false` (a facet: `isMarketplace` true 2448 / false 152 across the TCG category).

### B.4 Per-SKU fast endpoints for 60–120 s watchlist polling (verified)
All three worked with the public search key (about 0.7–0.9 s round trip from the US; Algolia `processingTimeMS` about 2):

| Option | Request | Notes |
|---|---|---|
| **Filtered query (recommended)** | `POST /1/indexes/shopify_products_families/query` `{"query":"","hitsPerPage":100,"filters":"sku:880545 OR sku:880621 OR …","attributesToRetrieve":["sku","price","availability.overallStatus","availability.canPreOrder","availability.canBuyOnline","availability.deliveryStatus","availability.clickNCollectStatus"],"attributesToHighlight":[]}` | **One request for the whole watchlist.** This is the same pattern the storefront itself uses (`browse` with `sku:` filters for curated blocks), so it is the least unusual traffic. Keep each filter under about 100 SKUs. |
| Multi-get | `POST /1/indexes/*/objects` `{"requests":[{"indexName":"shopify_products_families","objectID":"880545","attributesToRetrieve":["sku","price"]},…]}` | Works. `objectID` = `sku`. |
| getObject | `GET /1/indexes/shopify_products_families/{sku}?attributesToRetrieve=sku,price,availability,isMarketplace` | Works. It's one request per SKU, so avoid it for lists. |
| Shopify `/products/{handle}.js` | `GET https://www.jbhifi.com.au/products/{handle}.js` | `cdn-cache-control: no-cache, no-store`, `cf-cache-status: BYPASS`: **uncached, and every hit reaches Shopify origin.** Don't poll it at 60–120 s. Use it only for a one-off confirm before alerting. |

**Recommendation.** One filtered-query request every **60–120 s** covering all watchlist SKUs, and never one request per SKU. Add 5-min full-category queries (Pokémon + OPCG) to discover new SKUs.
- Algolia usage is billed to JB, so keep the volume around 1 request/min.
- How fresh the index is compared to JB's inventory system is **UNVERIFIED**. `updated_at` is present on hits, so log it to measure the lag.
- Before a user-facing "in stock now" alert, optionally confirm once with `/products/{handle}.js` (`available:true`).

### B.5 Implementation notes (JB)
- KV: `jb:algolia = {appId, apiKey, index, bundleFile, themeId, filtersPokemon, fetchedAt}`.
- Alert triggers, keyed on `sku`:
  - a new SKU with `isMarketplace:false`;
  - `availability.canPreOrder` false → true (pre-order opened);
  - `availability.overallStatus` changing to `InStock`/`LimitedStock` from anything else;
  - `clickNCollectStatus` changing from `NotAvailable` to `InStock`/`LimitedStock`;
  - a drop in `price`.
- Values seen: `overallStatus` / `deliveryStatus` / `clickNCollectStatus` ∈ {`InStock`, `LimitedStock`, `NotAvailable`}. `OutOfStock` is still UNVERIFIED.
- Treat an HTTP 403 with `Invalid Application-ID or API key`, or `searchProvider` ≠ `algolia`, as a "rediscover / provider changed" event, and don't hammer while it lasts.
- User-Agent for the storefront HTML and JS fetches: a contactable bot UA (`TCGTrackerBot/0.1 (+https://tcgtracker.com.au/bot; contact@…)`).

---

## C. BIG W and Kmart: re-check (2026-09-28)

### C.1 Live results (cloud IP, US egress)
| Site | Request | Result |
|---|---|---|
| BIG W | `GET /robots.txt` (curl, HTTP/2) | **403** (fast now; on 09-27 it was a stream `INTERNAL_ERROR`). Set-cookie `akaalb_www.bigw.com.au=…op=www_bigw_com_au:wwwbigw-azure-storefront`: Akamai load balancer in front of an Azure-hosted storefront. |
| BIG W | `GET /robots.txt` (curl, HTTP/1.1) | Timed out after 25 s with 0 bytes (tarpit, unchanged). |
| Kmart | `GET /robots.txt` | **403** `server: AkamaiGHost`, `akamai-grn: 0.16a4c017…`. The same cookies as 09-27 (`mnm_rollout=TARGET_MARKETPLACE`, `new_search_enabled=true`). |

No change: both sites are still denied at the edge. We made no bypass attempt.

### C.2 robots.txt (from Wayback, which is legitimate public copies)
**Kmart** (snapshot 2026-05-01):
```
User-agent: *
Allow: /
Disallow: /login /user/ /bag /bag/* /delivery/* /checkout /payment /sitec* /Login* /login*
Disallow: /track-my-order*?* */undefined* /api/ *?device= /rb_* *?gclid= *?utm_s= *?ref= *?postcode=
Disallow: /store-locator*?* /store-locator? /product-discovery*?* */?reviews=true*
Allow: /store-locator
Sitemap: https://www.kmart.com.au/sitemap-index.xml
User-agent: Pinterestbot  Crawl-delay: 0.4
```
- **`Disallow: /api/`** means Kmart's first-party JSON API is off-limits to robots even if it becomes reachable. `*?postcode=` is disallowed too, which rules out store-stock lookups by postcode.

**BIG W** (Wayback snapshot nearest 2025-06-01):
```
User-agent: *
Sitemap: https://www.bigw.com.au/sitemap.xml
Disallow: /*?bvstate /*?departmentPage= /*?*filter /*?*sort /*?q /*promotion_regional/ /all-departments/
Disallow: /c/2/ /cart /checkout /collection/undefined/ /help/CompetitionsContent /my-account /search?* /temporary/ /sales/c/2/
User-agent: CazoodleBot / dotbot/1.0 / Gigabot / GPTBot / MJ12bot → Disallow: /
```
- Search and any `?filter`/`?sort` URLs are disallowed. Plain category and product pages are allowed.

### C.3 Alternative legitimate data paths
| Path | BIG W | Kmart / Target | Notes |
|---|---|---|---|
| Public sitemaps | `https://www.bigw.com.au/sitemap.xml` (listed in robots) | `https://www.kmart.com.au/sitemap-index.xml`, `https://www.target.com.au/sitemap-index.xml` | **Behind the same Akamai edge**, so they are blocked from cloud too. From an allowed IP, sitemap diffs (new product URLs) are the most robots-friendly signal. |
| Affiliate programme + product feed | BIG W has an affiliate programme on **Impact** (up to 4% per [HiEnergy/Impact listing](https://app.hienergyrocket.com/a/big-w-hienergy-impact) search snippet, and listed on Sovrn/Brandreward/Linkbux aggregators). **Product catalogue feed: UNVERIFIED.** Impact advertisers often expose a catalog to approved partners through Impact's Catalog API. | **No confirmed Kmart AU or Target AU programme found** (FlexOffers "Kmart" is Kmart US; Target Partners is Target US on Impact). UNVERIFIED. | This is the **most compliant route**: apply to BIG W on Impact and ask whether a product catalogue (price/stock) is available to partners. For Kmart Group, contact the retailer directly. |
| Commission Factory / Partnerize | None found for BIG W, Kmart or Target AU | none found | UNVERIFIED. It is worth one email to each network's AU team. |
| Google Merchant / Shopping | Their products are almost certainly in Google Merchant Center, but **there is no public API for reading another merchant's feed**. The Shopping Content API only covers your own merchant account. Scraping Google Shopping violates Google's ToS. | same | Not a viable path. |
| Retailer permission | email | Kmart Group (Target's ToS offers `target.online@target.com.au`) | Ask for either a feed or permission to poll 2 category pages every 10–15 min with an identified UA. |

### C.4 What to test from a worker in Fly.io `syd`
Fly.io egress is still a **datacenter ASN** (Fly.io, AS40509). Akamai Bot Manager weighs ASN, IP reputation and client fingerprint, not just country, so AU geography alone may not help. Expectation: **probably still blocked** (UNVERIFIED).

Test plan (run manually, once, with an identified UA; stop at the first 403):
1. `curl -sS -o /dev/null -w "%{http_code} %{remote_ip}\n" -A "TCGTrackerBot/0.1 (+https://tcgtracker.com.au/bot)" https://www.{bigw,kmart,target}.com.au/robots.txt`. Record the status, `server`, `akamai-grn` / `errors.edgesuite.net` reference, and any `akaalb_*` cookie.
2. Repeat with a normal desktop Chrome UA string. If only the bot UA is denied, that is a policy signal: respect it and don't pretend to be a browser for polling.
3. If robots returns 200: fetch the sitemap index (1 request). Then fetch one category page each:
   - BIG W `https://www.bigw.com.au/toys/…/pokemon…` (find the path from the sitemap)
   - Kmart `https://www.kmart.com.au/category/toys/pokemon-trading-cards/`
   - Target `…/pokemon-cards/W1852642`
   Check whether the HTML contains server-rendered product data (for example `__NEXT_DATA__`) **without** executing the Akamai sensor JS.
4. Also test EB Games (`https://www.ebgames.com.au/robots.txt`, Cloudflare) the same way.
5. Repeat step 1 hourly for 24 h to see whether the IP gets reputationally blocked after sustained use.
6. Decision rule: proceed only if (a) robots and pages return 200 to an honest bot UA with no JS challenge, and (b) the ToS doesn't prohibit it (Target: deep-link clause, consent needed). **Never** use residential proxies, headless-browser sensor solving or UA spoofing to pass a 403.

### C.5 Implementation notes (BIG W / Kmart)
- Today: **no automated polling**. Show a "check manually" card with a link to the category page. The Target link needs consent, as above.
- Build the Fly.io `syd` probe as a one-off script (not a cron) that writes its results to the ops log.
- Pursue the BIG W Impact application and ask about a catalogue feed.
- **Kmart:** robots `Disallow: /api/` stands even if the edge opens, so any JSON must come from SSR HTML on allowed paths.

---

## D. PriceCharting API (Legendary plan, $49/mo)

Sources: https://www.pricecharting.com/api-documentation and https://www.pricecharting.com/pricecharting-pro (both fetched 2026-09-28, HTTP 200). robots.txt only disallows `/stripe-connect`, `/publish-offer` and `/buy`.

### D.1 Plan
From `/pricecharting-pro`: "**Legendary Sub**, Tools for Retailers & Hardcore Collectors, **$49 /month**", which includes:
- "**Download Price Lists**: Download all price, UPC & other meta data in a .CSV file"
- "**API Access to Price Data**: Use our API to programmatically access all prices for every item"
- "Item Demand Reports: For each item, see sales volume…"

(The Collector plan at $6/mo has no API or CSV.)

### D.2 Auth
> "API's are a premium tool. You must have a paid subscription to access the API. Each subscription has a unique, **40-character token** associated with it. You can find this token by visiting the Subscription page and clicking 'API/Download' button… Each API call is authenticated by including this token as the **`t` parameter** in the HTTP request… Please keep this token private."

The demo token in the docs is `c0b53bce27c1bdab90b1605249e600dc43dfd1d5`. Store ours as a worker secret (`PRICECHARTING_TOKEN`). Never expose it client-side: responses carry "liberal CORS headers", so don't be tempted.

### D.3 Conventions
- Base URL `https://www.pricecharting.com`, HTTPS, JSON. **GET** for read APIs.
- "Dates are encoded as YYYY-MM-DD strings."
- "**Prices an integer number of pennies.** For example, the amount $17.32 would be encoded as 1732." The currency is **USD** ("CSV price columns are in USD with two decimal places").
- "All other keys are encoded as strings." **`id` is a string** (`"6910"`).
- Errors: `"status":"error"` + `"error-message"`, HTTP 4xx/5xx. On success it's `"status":"success"`, HTTP 200.
- "The API and CSV only support **current** item values in various grades and conditions. **Historic prices and historic sales are not supported.**" We have to build our own history by snapshotting daily.

### D.4 Rate limits
> "The API is limited to **1 call every second**. Any more than that and your calls will be blocked and your account permissions revoked if it persists."
> "**CSV calls are limited to one every 10 minutes.** If you need lots of data on multiple items, it is best practice to download a CSV…"
> "The CSV files are generated **once every 24 hours** so no need to download it more often than once per day."

### D.5 Endpoints
| Endpoint | Params | Returns |
|---|---|---|
| `GET /api/product?t={token}&id={id}` | exactly one of `id=` (PriceCharting id), `upc=`, `q=` (full-text; "If multiple products match the search, only the best match is returned") | One product. "Semantically equivalent to a single row in your downloadable CSV… JSON key names exactly match the column names." |
| `GET /api/products?t={token}&q={text}` | `q=` only | `{"status":"success","products":[{…},…]}`: "a list of the **first 20** products matching your search". Example query from the docs: `charizard #4`. Use it only for **mapping and search**, not for bulk. |
| CSV download | Legendary only. "To access an existing download, visit the Subscriptions page and click 'API/Download' button." | Full price guide as CSV. Columns = the API key names. Prices as USD decimals. |

**CSV URL: UNVERIFIED.** The docs do not print it. It is only shown on the logged-in Subscription → "API/Download" page, and the "Download Price List" link on set pages only renders for subscribers (we saw `href="/pricecharting-pro?f=consoleDownload"` logged out). The expected shape is `https://www.pricecharting.com/price-guide/download-custom?t={token}&category=pokemon-cards` (and `category=one-piece-cards`). Those category slugs are verified as `/category/pokemon-cards` and `/category/one-piece-cards`. **Copy the exact URL from the Subscription page once the plan is bought.**

### D.6 Response example (verbatim from the docs, video-game item; card items use the same keys)
```json
$ curl "https://www.pricecharting.com/api/product?t=c0b53bce27c1bdab90b1605249e600dc43dfd1d5&id=6910"
{
    "status": "success",              // response status
    "cib-price": 42995,               // $429.95
    "console-name": "Super Nintendo",
    "id": "6910",                     // unique PriceCharting product ID
    "loose-price": 17244,             // $172.44
    "new-price": 53000,               // $530.00
    "product-name": "EarthBound",
    "release-date": "1995-06-05"      // 5 June 1995
}
```
```json
$ curl "https://www.pricecharting.com/api/products?t=…&q=tactics ogre"
{ "status": "success",
  "products": [ {"console-name":"Playstation","id":"4801","product-name":"Tactics Ogre"}, … ] }
```
The shape we expect for a card (keys from the docs table; values illustrative, **not real data**):
```json
{"status":"success","id":"5809582","product-name":"Charizard ex #199","console-name":"Pokemon Scarlet & Violet 151",
 "loose-price":0,"cib-price":0,"new-price":0,"graded-price":0,"box-only-price":0,"manual-only-price":0,
 "bgs-10-price":0,"condition-17-price":0,"condition-18-price":0,"condition-19-price":0,"condition-20-price":0,
 "condition-21-price":0,"condition-22-price":0,"sales-volume":"…","release-date":"2023-09-22","tcg-id":"517045","epid":"…","genre":"Pokemon Card"}
```
(Whether the API omits keys that have no price or returns 0 is UNVERIFIED. Handle both.)

### D.7 Field meanings for trading cards (from the docs' "Description of Keys" and "Condition Table")
| Key | Card meaning (docs wording) | Our column |
|---|---|---|
| `loose-price` | "Cards: **Ungraded** card" | `ungraded` |
| `cib-price` | "Cards: **Graded 7 or 7.5** by a grading company" | `grade7` (any grader) |
| `new-price` | "Cards: **Graded 8 or 8.5** by a grading company" | `grade8` (any grader) |
| `graded-price` | "Cards: **Graded 9** by a grading company" | `grade9`. **Not PSA-only.** The methodology page says "Graded by PSA or BGS as 9" (see 02). |
| `box-only-price` | "Cards: **Graded 9.5** by a grading company" | `grade9_5` (mostly BGS/CGC 9.5) |
| `manual-only-price` | "Cards: **Graded 10 by PSA** grading service" | **`psa10`** |
| `bgs-10-price` | "Cards: **BGS 10**" | `bgs10` |
| `condition-17-price` | "Cards: **CGC 10**" | `cgc10` |
| `condition-18-price` | "Cards: **SGC 10**" | `sgc10` |
| `condition-19-price` | "Cards: CGC 10 Pristine" | `cgc10_pristine` |
| `condition-20-price` | "Cards: BGS 10 Black" | `bgs10_black` |
| `condition-21-price` | "Cards: TAG 10" | `tag10` |
| `condition-22-price` | "Cards: ACE 10" | `ace10` |
| `condition-9/10/13/14/15/16-price` | Cards: Graded 1 / 2 / 3 / 4 / 5 / 6 | optional |
| `sales-volume` | "The yearly units sold" | liquidity indicator. **It exists.** |
| `release-date` | "The date the item was original released" (YYYY-MM-DD) | **It exists.** |
| `id` | "PriceCharting unique id for a product" (string) | FK `pc_id` |
| `product-name` | e.g. `Charizard ex #199`. The card number is embedded after `#`, and the variant is in `[...]` brackets | parse |
| `console-name` | the set ("console") name | map to (game, lang, set) |
| `tcg-id` | "Unique identifier for this product on TCGplayer.com. Only available for trading cards" | second key (EN) |
| `epid` | eBay ePID | can help build eBay links (not needed) |
| `upc`, `asin`, `genre` (e.g. "Pokemon Card"), `retail-*-buy/sell`, `gamestop-*` | mostly irrelevant for singles | ignore |

There is **no PSA 9-only field**, and **no PSA 7/8-only field**. The 7, 8, 9 and 9.5 columns are grader-agnostic.

### D.8 Console naming (set = "console")
Verified from `/category/pokemon-cards` (459 console links) and `/category/one-piece-cards`:

| Game / language | `console-name` pattern | Slug pattern | Examples |
|---|---|---|---|
| Pokémon EN | `Pokemon {Set Name}` | `pokemon-{set}` | `Pokemon Base Set` (`pokemon-base-set`), `pokemon-scarlet-&-violet-151`, `pokemon-evolving-skies`, `pokemon-promo` |
| Pokémon JP | `Pokemon Japanese {Set Name}` (116 consoles) | `pokemon-japanese-{set}` | `pokemon-japanese-scarlet-&-violet-151`, `pokemon-japanese-eevee-heroes`, `pokemon-japanese-expansion-pack` |
| Pokémon other | `Pokemon Chinese …` (23), `Pokemon Korean …`, plus EN specials `Pokemon McDonalds …`, `Pokemon POP …` | | exclude or map explicitly |
| One Piece EN | `One Piece {Set Name}` | `one-piece-{set}` | `One Piece Romance Dawn`, `One Piece Awakening of the New Era`, `One Piece Extra Booster EB04` |
| One Piece JP | `One Piece Japanese {Set Name}` | `one-piece-japanese-{set}` | `One Piece Japanese Romance Dawn`, `One Piece Japanese Azure Sea's Seven` |
| **Trap** | `One Piece Carddass Hyper Battle …` / `One Piece Japanese Carddass …` | | The old Carddass game, **not OPCG**. Exclude. |

- Language rule: `/^Pokemon Japanese /` or `/^One Piece Japanese /` means JP. `/^Pokemon (Chinese|Korean) /` means other. Everything else under the game prefix is EN (with the specials above).
- Set names are PriceCharting's own (for example `Azure Sea's Seven`), **not** set codes, so keep a manual `console-name → set_code` table. `product-name` often includes the OP card code (`op05-119` appears in slugs).
- IDs: JP and EN are separate products with separate `id`s (see 02 §5). JP One Piece ids (850xxxx) are much newer than EN (62xxxxx), so watch for re-splits (UNVERIFIED stability).

### D.9 Licence (brief reminder; details in 02 §2.1)
> "The API and CSV data are licensed for **internal use only**. Sharing our price data with a third party, or making it available within an application or service used by others, requires a **commercial license and express written permission** from us."
> With a Commercial Agreement: "we'd prefer attribution of either a logo or text linkback to our specific product page `https://www.pricecharting.com/game/{{PriceCharting_ID_Goes_Here}}`."
> "Data can and should be cached/stored on your servers… **All data gathered from the API or CSV must be purged after your subscription has ended.**"

**The $49 Legendary plan alone does not permit showing prices on tcgtracker.com.au.** A commercial licence (email brady@vgpc.com; price on request) is needed before any public display.

### D.10 Implementation notes (PriceCharting)
1. **Bulk path (daily):** one CSV download per category per day (`pokemon-cards`, `one-piece-cards`), at least 10 min apart, e.g. 16:00 and 16:15 UTC. Parse the header row and map columns by name, never by position. Price columns are USD decimals, so convert them to integer cents to match the API. Upsert into `pc_prices(pc_id, snapshot_date, ungraded_c, g7_c, g8_c, g9_any_c, g9_5_c, psa10_c, bgs10_c, cgc10_c, sgc10_c, sales_volume)`. **Keep the daily snapshots**, because the API has no history.
2. **Point lookups:** `/api/product?t=…&id=…` for a newly mapped card or an on-demand refresh. Use a global token-bucket of **1 req/s** (queue in a Durable Object or a single worker). Back off on HTTP 429/403.
3. **Mapping:** `/api/products?q={name} {number} {set}` → take the top 20 → filter by `console-name` pattern (D.8) → confirm `#number` in `product-name` → store `pc_id`, `tcg-id`.
4. **Labelling on our site:**
   - `graded-price` must be labelled "Grade 9 (PSA/BGS)", not "PSA 9".
   - `manual-only-price` is the only PSA-specific column (PSA 10).
   - Show USD, or convert to AUD with a dated FX rate and label it.
   - Keep attribution: a link to `https://www.pricecharting.com/game/{id}`.
5. **Secrets:** `PRICECHARTING_TOKEN` as a worker secret. Never log full URLs that contain `t=`.
6. **Purge job:** on cancellation, delete all `pc_*` data (a licence requirement).

---

## E. eBay Partner Network (EPN) for eBay Australia

Access notes:
- `developer.ebay.com` (including "Creating an EPN Tracking Link", `https://developer.ebay.com/api-docs/buy/static/ref-epn-link.html`) returned **403** to curl and WebFetch.
- `partnernetwork.ebay.com` 307-redirected to an eBay **bot challenge** (`/splashui/challenge`), which we did not follow.
- The **same EPN pages are served un-challenged on `epnmarketing.ebay.com`**, and those were fetched (200).
- `ebay.com.au/sch/…` returned **403** from this IP, so the AU search URL params below are UNVERIFIED live.

### E.1 AU link format
**Rotation id for eBay AU: `705-53470-19255-0`.**
- eBay's own AU homepage link, as indexed by search: `https://www.ebay.com.au/?campid=5336728181&mkcid=1&mkevt=1&mkrid=705-53470-19255-0&toolid=10001`.
- Real affiliate links on AU sites use the legacy rover form `http://rover.ebay.com/rover/1/705-53470-19255-0/1?…&campid=…&customid=…&toolid=10001&mpre=https%3A%2F%2Fwww.ebay.com.au%2Fitm%2F…` ([example](https://www.diyjewelryhub.com/how-to-make-a-half-and-half-necklace-using-beads-and-chain/)).
- Other rotation ids (from the EPN Feed API Playbook PDF, `https://ir.ebaystatic.com/cr/v/c1/EPN/Feed_API_Playbook.pdf`): US `711-53200-19255-0`, UK `710-53481-19255-0`, CA `706-53473-19255-0`, DE `707-53477-19255-0` (AU is not in that 2019 table).

**Current (direct) format.** Append to any ebay.com.au URL:
```
https://www.ebay.com.au/sch/i.html?_nkw={urlencoded query}&_sacat=183454
  &mkcid=1
  &mkrid=705-53470-19255-0
  &siteid=15
  &campid={YOUR_10_DIGIT_CAMPAIGN_ID}
  &customid={optional subid ≤256 chars, e.g. card_id or alert_id}
  &toolid=10001
  &mkevt=1
```

| Param | Meaning | Value |
|---|---|---|
| `mkcid` | marketing channel id (1 = EPN / affiliate) | `1` |
| `mkrid` | rotation id (marketplace) | AU `705-53470-19255-0` |
| `siteid` | eBay site id (EBAY_AU = 15 per eBay's site-code table) | `15` (UNVERIFIED whether required. The eBay AU homepage example omits it, so it's safe to include.) |
| `campid` | your EPN **Campaign ID**, a 10-digit number ("a required parameter") | from the EPN portal |
| `customid` | "an open form field" that "can hold up to 256 alphanumeric characters", for sub-tracking ([EPN](https://partnernetwork.ebay.com/solutions/optimizing-using-tracking-parameters)) | e.g. `c-{cardId}` |
| `toolid` | tool id; `10001` = link generator / default | `10001` |
| `mkevt` | tracking event (1 = click) | `1` |

**How to get a campaign id:**
1. Sign up at the EPN portal (partnernetwork.ebay.com; payouts in AUD are supported per the Network Agreement).
2. Once approved, log in → **Campaigns** tab → create a campaign (e.g. "tcgtracker-web", and a separate "tcgtracker-email" if approved) → copy the 10-digit Campaign ID.

EPN's step 2 page says: "Sign in to the portal / Locate the 'Create A Promotable Link' section / Select the campaign… / Add a Custom ID… / Paste in any link from eBay… / Click the Generate Link button". Generate one AU search link there to confirm the exact param set the portal emits. Then template it in code.

### E.2 Rules on link usage
Source: the Network Agreement (`https://epnmarketing.ebay.com/page/network-agreement`), the Disclosure FAQ, "Step 5: Knowing the rules" and Special Business Models, all fetched 2026-09-28.

**Disclosure**, where the relevant Network Agreement section is I.G:
- "requires that all partners disclose their relationship with EPN regardless of partners' location, consumers' location… **Disclosure is required globally.**"
- "Disclosure must be 'unavoidable'. The disclosure should be as close to the promotional contents, advertisements, logos and/or links as possible."
- "Disclosure… only in a 'Terms of Use', 'Legal', 'About Us', 'Disclaimers' or other pages… are **not sufficient**."
- "Is a disclosure in the footer sufficient? **No**, not if the affiliate links are at the top of the page…"
- "**linking to an affiliate disclosure is not sufficient.** The affiliate disclosure statement itself needs to be in close proximity to the affiliate links."
- "Disclosure is required for all live links regardless of how old they are."
- Social posts: `#ad` / `#sponsored` are OK; `#affiliate` is **not**.
- Suggested wording from the Agreement: "As an eBay Partner Network Affiliate, I earn from qualifying purchases."

**Restricted methods (need prior written EPN approval, "Special Business Models"):**
- "**Electronic Communications:** You may not promote Participating Sites and Content using **email or other forms of electronic communication (for example, SMS, instant messaging, or IRC)** without EPN's prior written approval." **This matters for TCGTracker:** alert emails or push notifications that contain EPN links need approval. The fallback is to send a non-affiliate link, or link to our own card page where the affiliate link and disclosure sit.
- Incentive/loyalty programmes; Software Applications / browser extensions; PLA/paid traffic; **"AI Tools: Promoting eBay through any generative artificial intelligence or tool"**.
- "Additional Restricted Promotional Methods… **Promotional Content created by a developer's program tool or API**." Programmatically generated search links on our pages arguably fall under this. **Ask EPN when applying (UNVERIFIED interpretation).**

**Prohibited:**
- cookie stuffing;
- "automated clicking tools… robots" (never prefetch or crawl our own affiliate links, and add `rel="sponsored nofollow"` and no link-preview unfurling);
- auto-redirecting from our domain to eBay ("You can't auto-redirect from your domain to eBay using an affiliate link");
- masking redirects ("sending traffic to middle servers for the purpose of masking your referring source", except the listed shorteners);
- bidding on "eBay" keywords;
- eBay in our domain or social names;
- links on eBay properties;
- "**sniping functionality**" (links in software that auto-bids or buys);
- "content aimed at children" is an "Unacceptable Placement". **Pokémon's audience makes this worth a sentence in the EPN application** (UNVERIFIED risk).

**Links:** "You may not modify a Link unless it is specifically designed to be modified, and then only within the parameters provided by EPN." Appending the documented params to eBay URLs is the documented method.

### E.3 Non-affiliate fallback search URL (ebay.com.au)
Category: **`183454` = "CCG Individual Cards"** (Toys & Hobbies > Collectible Card Games > CCG Individual Cards). Confirmed for the eBay US/CA taxonomy (e.g. `https://www.ebay.com/b/CCG-Individual-Cards/183454`). The AU site shares the category id per AU search results (`ebay.com.au/shop/…`), but that is UNVERIFIED live because of the 403. There are community reports that eBay is changing CCG categories, which we could not read (404), so **re-verify the id before launch**.

```
https://www.ebay.com.au/sch/i.html?_nkw={q}&_sacat=183454&Graded=Yes&_sop=12
```
- `_nkw`: the query, e.g. `charizard ex 199 151 psa 10`
- `_sacat=183454`: the category
- `Graded=Yes`: item-specific filter. Seen in eBay URLs (`&_dcat=183454&Graded=Yes&Grade=7`); UNVERIFIED on AU.
- optional `Professional%20Grader=Professional%20Sports%20Authenticator%20%28PSA%29`, `Grade=10`: aspect filters, UNVERIFIED names on AU.
- optional `LH_BIN=1` (Buy It Now), `LH_PrefLoc=1` (items located in Australia; UNVERIFIED on AU)
- `_sop=12`: "Best Match" (`15` = price + postage lowest)
- Sold listings (`LH_Sold=1&LH_Complete=1`) have required sign-in since late Aug 2026 (see 02 §2.5), so don't rely on them for users.

### E.4 Implementation notes (eBay)
1. Config: `EBAY_AU_ROTATION_ID="705-53470-19255-0"`, `EPN_CAMPAIGN_ID_WEB`, optional `EPN_CAMPAIGN_ID_EMAIL` (only after Special Business Model approval), `EPN_TOOL_ID="10001"`.
2. Builder:
   ```ts
   function ebayAuSearchUrl(q: string, opts: {graded?: boolean; affiliate?: {campid: string; customid?: string}}) {
     const u = new URL("https://www.ebay.com.au/sch/i.html");
     u.searchParams.set("_nkw", q);
     u.searchParams.set("_sacat", "183454");
     if (opts.graded) u.searchParams.set("Graded", "Yes");
     u.searchParams.set("_sop", "12");
     if (opts.affiliate) {
       u.searchParams.set("mkcid", "1");
       u.searchParams.set("mkrid", "705-53470-19255-0");
       u.searchParams.set("siteid", "15");
       u.searchParams.set("campid", opts.affiliate.campid);
       if (opts.affiliate.customid) u.searchParams.set("customid", opts.affiliate.customid.slice(0, 256));
       u.searchParams.set("toolid", "10001");
       u.searchParams.set("mkevt", "1");
     }
     return u.toString();
   }
   ```
3. UI: render affiliate links as `<a rel="sponsored nofollow noopener" target="_blank">`, with an **inline** disclosure right next to them, e.g. "Ad · We may earn a commission from eBay (eBay Partner Network)". No footer-only disclosure and no disclosure-link-only.
4. Emails and push: use **non-affiliate** eBay URLs (or links to our own card page) until EPN approves "Electronic Communications".
5. Never let our crawler, link-checker, OG-unfurler or the email client's image proxy hit affiliate URLs. Exclude them from any server-side prefetch.
6. Use `customid` for attribution (`c-{cardId}` / `a-{alertId}`), and read the Transaction Detail Report in the EPN portal.

---

## Open questions
1. **Target:** will Kmart Group consent to (a) reading 2 category pages every 10–15 min and (b) deep-linking? Which field marks a pre-order item? What are the actual Constructor/BFF calls? These need a consented live capture.
2. **Fly.io syd probe** (C.4): does any of BIG W, Kmart, Target or EB serve robots.txt to an honest bot UA from an AU datacenter IP?
3. **BIG W on Impact:** is a product catalogue (price/stock) available to approved partners? Are there any Kmart or Target AU affiliate programmes?
4. **JB:** index freshness against real stock (log `updated_at`). Is the `googleFilters` / `searchProvider` switch imminent?
5. **PriceCharting:** the exact CSV URL (from the Subscription page); whether the API omits unpriced keys; commercial licence terms.
6. **EPN:** approval for email/push links and for programmatic ("developer tool") links; confirm `183454` and the aspect names on ebay.com.au; the "content aimed at children" placement rule with a Pokémon audience.

## Sources
- Target AU (live 403): https://www.target.com.au/robots.txt. Wayback copies:
  - robots: https://web.archive.org/web/20260501013622id_/https://www.target.com.au/robots.txt
  - sitemap index: https://web.archive.org/web/20260501025424id_/https://www.target.com.au/sitemap-index.xml
  - Pokémon category: https://web.archive.org/web/20260207204531id_/https://www.target.com.au/c/toys/trading-card-games/pokemon-cards/W1852642
  - product page: https://web.archive.org/web/20260420013355id_/https://www.target.com.au/p/pokemon-tcg-mega-evolution-perfect-order-blister-assorted/72554982
  - pre-order page: https://web.archive.org/web/20260311170801id_/https://www.target.com.au/pre-order
  - ToS: https://web.archive.org/web/20260101071849id_/https://www.target.com.au/corporate/condition-of-use
- Target One Piece category (search result): https://www.target.com.au/c/toys/trading-card-games/one-piece-trading-cards/W130520251
- Kmart/Target merger: https://en.wikipedia.org/wiki/Target_Australia , https://www.abc.net.au/news/2023-07-25/kmart-and-target-merger-no-change-stores/102643226
- JB Hi-Fi: https://www.jbhifi.com.au/collections/pokemon-trading-cards_1eld66jvxxoxw0ae4rjd36 ; bundle `https://www.jbhifi.com.au/cdn/shop/t/535/assets/bundle.86cb2b098f20e475.js` ; Algolia `https://vtvkm5urpx-dsn.algolia.net/1/indexes/shopify_products_families/query`
- Kmart robots (Wayback): https://web.archive.org/web/20260501031526id_/https://www.kmart.com.au/robots.txt ; BIG W robots (Wayback, nearest 2025-06-01): https://web.archive.org/web/2025/https://www.bigw.com.au/robots.txt
- BIG W affiliate: https://app.hienergyrocket.com/a/big-w-hienergy-impact (search snippet), https://linkclicky.com/affiliate-program/big-w/ ; Kmart (US) FlexOffers: https://www.flexoffers.com/affiliate-programs/kmart-affiliate-program/
- PriceCharting: https://www.pricecharting.com/api-documentation , https://www.pricecharting.com/pricecharting-pro , https://www.pricecharting.com/category/pokemon-cards , https://www.pricecharting.com/category/one-piece-cards , https://blog.pricecharting.com/2023/01/download-prices-for-individual.html
- EPN:
  - Network Agreement: https://epnmarketing.ebay.com/page/network-agreement
  - Disclosure FAQ: https://epnmarketing.ebay.com/resources/affiliate-disclosure-faq
  - Rules: https://epnmarketing.ebay.com/solutions/step-5-knowing-the-rules
  - Links: https://epnmarketing.ebay.com/solutions/step-2-creating-campaigns-links-and-ads
  - Special Business Models: https://epnmarketing.ebay.com/resources/special-business-models
  - Tracking params: https://partnernetwork.ebay.com/solutions/optimizing-using-tracking-parameters
  - Feed API Playbook (rotation ids): https://ir.ebaystatic.com/cr/v/c1/EPN/Feed_API_Playbook.pdf
  - Campaign id (Geniuslink): https://intercom.geni.us/en/articles/5492410-how-to-add-your-ebay-campaign-id-epn
  - AU rotation id in the wild: https://www.ebay.com.au/?campid=5336728181&mkcid=1&mkevt=1&mkrid=705-53470-19255-0&toolid=10001
  - eBay dev link doc (403 here): https://developer.ebay.com/api-docs/buy/static/ref-epn-link.html
- eBay category 183454: https://www.ebay.com/b/CCG-Individual-Cards/183454
