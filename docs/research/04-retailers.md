# 04: Retailer investigation (brief §14.4 / §9)

**Date:** 2026-09-27
**Scope:** Premium Bandai AU, JB Hi-Fi, EB Games, BIG W and Kmart. The service is a notify-only drop/restock/pre-order alert for Pokémon TCG and One Piece Card Game (OPCG).
**Method:** robots.txt was read first. We then made a small number of curl requests and ran headless Chromium (Playwright 1.62, network log) spaced seconds apart, with no cart or checkout actions and no challenge solving.

> **Network caveat.** Every request came from a cloud container that egresses in the US (Cloudflare `IAD`, CloudFront `IAD55`, F5 `b-dc12-ash`), not from an Australian residential IP. Akamai and Cloudflare decide largely on IP reputation, ASN and geography. **The three retailers that blocked us might behave differently from an AU residential line, and the two that let us in might block a datacenter IP once polling becomes regular.** Anything that depends on this is marked UNVERIFIED.

Fixtures: `workers/tests/fixtures/retailers/<slug>/` (there is a README in each folder).

---

## Summary

| Retailer | Platform / search | Best data source (per the brief's preference order) | Bot protection observed (from cloud IP) | Feasibility | Recommended interval |
|---|---|---|---|---|---|
| **Premium Bandai AU** | Custom Vue 3/Vite SPA with Spring-style JSON API (`/api/*`), CloudFront in front, **F5 Distributed Cloud (`server: volt-adc`)** WAAP/bot defence, Global-e checkout | **(1)** `GET /api/search?_f_brands=06-0074` with header `X-G1-Area-Code: au`; **(2)** `/au/sitemap-product_1.xml` `lastmod` as a cheap change signal | F5 JS bot-defence interstitial on `/au/item/*` and `/au/search` HTML (then "PAGE NOT AVAILABLE", 501). Brand pages, sitemaps and `/api/search` JSON were served normally | **Medium** (technically easy, **ToS explicitly prohibits robots/spiders**) | 10–15 min baseline; 1–2 min only inside known `saleStartExpectedDt` windows (and only if ToS risk is accepted) |
| **JB Hi-Fi** | **Shopify (Plus)** served via Cloudflare Workers; **Algolia** search (`VTVKM5URPX`, index `shopify_products_families`); Contentful CMS | **(1)** Algolia `/1/indexes/shopify_products_families/query` with the same filters the collection page uses; supplemented by Shopify `/products/{handle}.js` for a single product | Cloudflare in front of www, but no challenge seen for robots, sitemaps, collections or `.js`. Algolia is not behind a WAF | **High** (JB's ToS has no explicit anti-automation clause, only a copyright/"personal, non-commercial use" clause) | 5 min (Algolia); 10–15 min per-product `.js` on a watchlist |
| **EB Games** | UNVERIFIED (custom platform; URL pattern `/product/toys-and-collectibles/{id}-{slug}`, `/featured/pokemon-trading-card-game`) | Unknown. Needs an AU residential re-check. | **Cloudflare managed challenge (Turnstile)** on everything, including `/robots.txt` (403, `cf-mitigated: challenge`) | **Low** from cloud. ToS reportedly prohibits scraping (see below) | n/a until verified |
| **BIG W** | UNVERIFIED | Unknown. Needs an AU residential re-check. | **Akamai**: curl tarpit (HTTP/2 INTERNAL_ERROR / 30 s timeout); Chromium got 403 "Access Denied" (edgesuite ref) on `/robots.txt` | **Low** from cloud | n/a until verified |
| **Kmart** | UNVERIFIED. The third-party claim is that search uses **Constructor.io**. The 403 response set the cookies `new_search_enabled=true` and `mnm_rollout=TARGET_MARKETPLACE` | Unknown. Possibly the Constructor.io public search API (UNVERIFIED, see risks) | **Akamai** (`server: AkamaiGHost`, `akamai-grn`) 403 "Access Denied" on `/robots.txt`, curl and Chromium | **Low** from cloud | n/a until verified |

Feasibility means: technical accessibility × data quality × ToS/compliance risk.

---

## 1. Premium Bandai AU: `https://p-bandai.com/au`

### robots.txt (`https://p-bandai.com/robots.txt`, 200)
```
User-agent: *
Disallow: /*?*offset=
Disallow: /*?*limit=
Disallow: /*?*sortType=
Disallow: /*?*_f_productStatuses=
Sitemap: https://p-bandai.com/sitemap.xml
Sitemap: https://p-bandai.com/au/sitemap.xml   (+ hk, nz, sg, tw, us, fr)
```
- There is no crawl-delay and no path-level disallows. Only the parameterised listing URLs are disallowed (to prevent duplicate crawling).
- **Compliance note:** the frontend's widget APIs (`/api/widget/product/*`, `/api/widget/shippingMonths`) require a `limit=` query param, which matches `Disallow: /*?*limit=`. **Our worker should not call them.** `/api/search` works *without* `limit`/`offset`/`sortType`/`_f_productStatuses` (it defaults to 20 results), so a robots-clean call exists.

### Sitemaps
- `/au/sitemap.xml` is an index that points to `sitemap-{homepage,product,series,shoppage,brand,news,content,static}_1.xml`.
- `sitemap-product_1.xml` holds **691 URLs** of the form `https://p-bandai.com/au/item/{productCode}` with `<lastmod>` (latest was 2026-09-26) and `<image:image>`, but **no titles**. A new OPCG item can only be detected by diffing `loc`s and then resolving each code through the API.
- The brand sitemap lists `/au/brand/onepiececardgame` (plus Digimon, DBS, Gundam card games). **Premium Bandai does not sell Pokémon TCG.**

### Platform / tech
- Vue 3 SPA built with Vite (`/assets/main-*.js`, `*.vue_vue_type_*` chunks), axios client, backend errors in Spring format (`application/problem+json`, `{"timestamp","status","error","path"}`).
- Infra: AWS CloudFront → **F5 Distributed Cloud / Volterra** (`server: volt-adc`, `x-volterra-location`) → envoy.
- Checkout and localisation go through **Global-e** (`gepi.global-e.com`, merchant 1925). Firebase config comes from `/api/firebase/configData`. There is also OneTrust, HubSpot, Clarity and GA.
- The axios client sets `X-Requested-With: XMLHttpRequest`, `Accept-Language`, **`X-G1-Area-Code: <area>`** and `X-CSRF-TOKEN` (not needed for GETs).

### Frontend JSON endpoints (from the Playwright network log and the `searchResultService` chunk)
| Endpoint | Method | Key params | Notes |
|---|---|---|---|
| `/api/search` | GET | `_f_brands=06-0074` (OPCG), `_f_series=03-002` (ONE PIECE, UNVERIFIED param name), `keyword=`; header `X-G1-Area-Code: au` | **Primary source.** Returns `productResults{products[],totalCount,limit,offset,productStatus{Waiting,On,End}Count}` + `aggs{productStatuses,series,shops,brands,categories,shippingMonths,deliveryGroups,productTypes}`. Returns 500 without the area header. |
| `/api/search/bulk` | GET | `productCodes=a,b,c`, `limit`, `excludeOutOfStock` | Lookup for a watchlist of product codes. **Requires `limit` (robots conflict), so avoid it.** |
| `/api/search/suggestions` | GET | `keyword` | typeahead |
| `/api/widget/product/NewArrivalItem`, `/ClosingReservedItem` | GET | `brandCode=06-0074&excludeOutOfStock=true&limit=10` | Both returned `[]` for OPCG on the fetch date. `limit` is required (robots conflict). |
| `/api/widget/shippingMonths` | GET | `startingMonth=202609&brandCode=06-0074&limit=6` | robots conflict |
| `/api/products/fillProductDetailFlags` | POST | JSON array of product tiles | Returns tile labels (`PRE_ORDER`, `PRE_ORDER_CLOSED`, …) |
| `/api/display/area-banners/current-of-area?areaCode=AU` | GET | | banners |
| `/api/cart/summary` | GET | | cart. **Do not use.** |

**Status fields (in `/api/search` products):**
- `productType`: seen as `PreOrder`. Other values such as in-stock or lottery types are UNVERIFIED.
- `saleStatus`: the frontend sorts by `["Waiting","On","End"]`. **`Waiting` = announced, not yet on sale; `On` = orderable; `End` = closed or sold out.** These map to the aggregation `productStatuses` and the robots-disallowed `_f_productStatuses` filter.
- `displayStatus`: `On`.
- `saleStartExpectedDt` / `saleEndExpectedDt`: ISO UTC timestamps. **This is the key to scheduling.** Windows are known in advance, for example `2026-04-24T02:00:00Z` = 12:00 AEST.
- `flags` / `productFlags[].labelCode`: `PRE_ORDER`, `PRE_ORDER_CLOSED`; others (e.g. `SOLD_OUT`, `LOTTERY`) UNVERIFIED.
- `fixedListPrice.amount` is in AUD.
- `shops`: `05-0004` = "BANDAI CARD SHOP". OPCG product codes start with `N` (`N2856354001`), figures with `A`.
- There is no stock-quantity field. Premium Bandai has no click & collect.

On 2026-09-27 the AU store listed 19 OPCG items (3rd Anniversary Set, Premium Card Collections, playmats), **all `End` / `PRE_ORDER_CLOSED`**.

### Category / search URLs
- Brand: `https://p-bandai.com/au/brand/onepiececardgame` (brand code `06-0074`)
- Series: `https://p-bandai.com/au/series/onepiece-series` (series `03-002`)
- The site's own links use `https://p-bandai.com/au/search?limit=20&sortType=NewArrival&_f_productStatuses=Waiting,On&_f_brands=06-0074`. These are robots-disallowed and served the F5 challenge to us.
- Product: `https://p-bandai.com/au/item/{productCode}`

### Bot protection
- **F5 Distributed Cloud Bot Defense** (formerly Shape). Requests to `/au/item/*` and `/au/search?…` from curl and from headless Chromium got a 200 response that was an obfuscated JS interstitial (~230 KB). The follow-up XHR returned **501** and the page showed "PAGE NOT AVAILABLE | PREMIUM BANDAI". We did not try to get past it.
- `/au/brand/*`, `/au/terms/*`, the sitemaps, static assets and **`/api/search` (curl, plain headers) all returned 200**. That could change at any time, and a sustained polling pattern from one datacenter IP is exactly what F5 is designed to score.

### Queue / lottery mechanics (QUEUE_LIVE)
- We saw **no queue vendor** (no Queue-it, Akamai waiting room or Cloudflare waiting room) in the brand page, the main bundle or the network log.
- Third-party commentary (autoqueue.app, UNVERIFIED) says Premium Bandai OPCG drops are **either timed first-come-first-served pre-order windows or raffles/lotteries, with no waiting room**, and that windows sell out in minutes.
- **QUEUE_LIVE detectability:** unlikely to be needed for the AU store. The equivalent signal is `saleStatus` changing from `Waiting` to `On` at `saleStartExpectedDt`. Treat an F5 interstitial or 501 on an item page during a drop window as a possible "site under load" signal, not as a queue. Lottery-type `productType`/flags values are UNVERIFIED. **Open question:** capture one during a live AU lottery.
- **Region specifics:** the store is area-scoped by URL prefix (`/au/`) and by the `X-G1-Area-Code` API header. Prices are in AUD through Global-e. Product codes are global but an `areaProductNo` suffix is area-specific (`…001AU`). Timestamps are UTC, and AU drops seen were at `02:00Z` (12:00 AEST) or `23:00Z`. The ToS forbids more than one account per person and prohibits resale or "pre-selling".

### Terms of Use: automated access
URL: https://p-bandai.com/au/terms/termsofuse (fetched 2026-09-27)
> "This Website is provided for your personal use, any commercial use and resale being strictly prohibited, and for informational purposes only. Any other use of the Website requires the prior written consent of Company."
> "**You may not use spiders, robots, data mining techniques or other automated devices or programs to catalog, download or otherwise reproduce, store or distribute content available on the Website.** Further, you may not use any such automated means to manipulate the Website, such as automating what are otherwise manual or one-off procedures. You may not take any action to interfere with, or disrupt, the Website … circumventing security or user authentication measures…"

### Recommended approach
1. **Primary:** `GET https://p-bandai.com/api/search?_f_brands=06-0074` with the header `X-G1-Area-Code: au`, a single call every **10–15 min**. Diff by `productCode` and alert on (a) a new code, (b) `saleStatus` changing to `Waiting` (announcement, including `saleStartExpectedDt`) and (c) `saleStatus` changing to `On` (open). Schedule a few extra polls at 1–2 min spacing around a known `saleStartExpectedDt` **only if Jamie accepts the ToS risk**.
2. **Secondary:** once or twice a day, diff `/au/sitemap-product_1.xml` `loc`s (robots-clean, 1 request).
3. Never fetch `/au/item/*` or `/au/search` HTML (F5 challenge). Never use Playwright here.
4. **Risks:** the explicit ToS prohibition; F5 may start challenging `/api/*`; it's an undocumented API (the header requirement and params may change); robots `limit=` conflict on other endpoints.
5. **Safest alternative:** alert only on sitemap changes and on Premium Bandai's own news pages (`sitemap-news_1.xml`), and link users to the page.

---

## 2. JB Hi-Fi: `https://www.jbhifi.com.au`

### robots.txt (200, `# we use Shopify as our ecommerce platform / served using Cloudflare Workers`)
- `User-agent: *` disallows: `/admin`, `/cart`, `/carts`, `/checkout`, `/orders`, `/account`, **`/search`**, `/*?q*`, Algolia InstantSearch URL state (`/*?*hPP=*`, `/*?*idx=*`, `/*?*dFR%5Bfacets.*`, `/*?*queryID=*`), sort/filter combos (`/collections/*sort_by*sort_by*`, `/collections/*+*`), `/pages/sku/*`, `/*.atom$`, `/*.oembed$`, `/web-pixel*`, `/cdn/wpm/*.js`, `/products/gift-card-*`, `/products/extra-care-*`.
- Allows `/*?page=*`.
- Sitemaps: `https://www.jbhifi.com.au/sitemap.xml`, `http://www.jbhifi.com.au/sitemap-subcollections.xml`.
- No crawl-delay for `*`. There is `Crawl-delay: 10` for AhrefsBot/AhrefsSiteAudit. `Nutch` is fully disallowed.
- `/collections/{handle}`, `/products/{handle}` and `/products/{handle}.js` are **allowed**. Algolia calls go to `*.algolia.net`, which JB's robots.txt doesn't govern.

### Sitemaps
- The standard Shopify index contains `sitemap_products_1..104.xml` (by product-ID range; new products land in the highest-numbered file), `sitemap_collections_1..6.xml` (10,270 collections), `sitemap_pages_1.xml`, blogs and **`sitemap_agentic_discovery.xml`**.
- The latest product sitemap (`_104`, 388 URLs) had no TCG product on the fetch date. Collection sitemaps include TCG collections (below).

### Platform / tech
- **Shopify Plus** (`powered-by: Shopify`, storefront GraphQL at `prod-jbhifi.myshopify.com/api/2026-01/graphql.json`) behind **Cloudflare Workers** (custom React front end: react-instantsearch 7.22, React 19).
- **Algolia** app `VTVKM5URPX`, index `shopify_products_families`, with a public search-only API key embedded in the storefront.
- Other services: Contentful (collection landing content), Optimizely, Insider, Klaviyo, Decibel, Riskified.

### Frontend JSON endpoints
| Endpoint | Method | Key params / body | Notes |
|---|---|---|---|
| `https://vtvkm5urpx-dsn.algolia.net/1/indexes/shopify_products_families/query` | POST | headers `x-algolia-application-id: VTVKM5URPX`, `x-algolia-api-key: <public search key>`; body `{"query":"","hitsPerPage":36,"page":0,"distinct":true,"filters":"(\"facets.Game type\": \"Trading card games\" OR \"category_hierarchy\":\"Trading card games\") AND (\"facets.Brands\": \"Pokemon TCG\" OR \"facets.Primary franchise\": \"Pokemon\") AND (price > 0 AND product_published = 1 AND availability.displayProduct = 1)"}` | **Primary source.** This is the collection page's own filter. The page itself uses the multi-index `/1/indexes/*/queries`; that returned 404 "Path not supported" to us, possibly because of the egress proxy (UNVERIFIED). The single-index `/query` and `/browse` are used by the page too and worked. 55 Pokémon hits. |
| `…/shopify_products_families/browse` | POST | `filters` by `sku:` list | Used by the page for curated SKU blocks |
| `https://www.jbhifi.com.au/products/{handle}.js` | GET | | Shopify AJAX product. Fields: `available`, `variants[].available`, `price` (cents), `tags` |
| `https://www.jbhifi.com.au/collections/{handle}/products.json` | GET | | Returns `{"products":[]}` (the collections are Algolia-driven), so it's **not usable** |
| `https://cdn.contentful.com/.../entries?content_type=smartCollection&fields.handle=pokemon-trading-cards` | GET | | Collection definition (merchandising) |
| `prod-jbhifi.myshopify.com/api/2026-01/graphql.json` | POST | | Cart and variant lookups by the site. **Do not use for cart.** |

**Availability fields (Algolia hit `availability`):**
- `canBuyOnline`: boolean.
- **`canPreOrder`**: `true` on pre-order items, which also have `productLifecycle: "PreOrder"`, `availableNow: "Coming Soon"`, `availabilityStatement: "Pre-order online"`, top-level `button: "PreOrder"` and `banner_tags.label: "Pre-Order"`.
- `overallStatus` / `deliveryStatus`: seen `InStock`, `LimitedStock`. `OutOfStock` and similar are UNVERIFIED.
- **`clickNCollectStatus`**: seen `InStock`, `LimitedStock`, `NotAvailable`. `cashNCarryStatus` is also present.
- Top-level: `in_stock_store_ids[]` (store-level C&C availability), `price`, `compare_at_price`, `onPromotion`, `release_date` (epoch seconds), `isMarketplace`, `sku`, `handle`, `tags` (`Brand:Pokemon Tcg,InStock`), `published_at`, `updated_at`.
- **Important:** JB's own stock has 6-digit SKUs and `isMarketplace:false`. **Marketplace sellers** have 8-digit SKUs (`10xxxxxx`), `isMarketplace:true` and often inflated prices. **All 122 OPCG hits were marketplace**, so JB had no first-party OPCG. Alerts should default to `isMarketplace:false`.

### Category / search URLs
- Pokémon TCG: `https://www.jbhifi.com.au/collections/pokemon-trading-cards_1eld66jvxxoxw0ae4rjd36`. Also `/collections/new-pokemon-tcg`, `/collections/trading-card-games_1pvbogrlizsjxqxxjjwlpu`, and per-set collections (`/collections/pokemon-tcg-scarlet-and-violet-151_…`).
- OPCG: there is no first-party OPCG collection. `/collections/one-piece` is merch. Use an Algolia `query:"one piece card game"` with the TCG filter.
- The `/search` HTML is robots-disallowed.

### Bot protection
- Cloudflare in front (`server: cloudflare`, `cf-ray`), but no challenge was seen for robots.txt, sitemaps, the collection page (Playwright), `.js` or ToS. Algolia is Algolia's own infrastructure with per-key rate limits. JB can rotate or referrer-restrict the key.

### Terms of Use
URL: https://www.jbhifi.com.au/pages/help-and-support/terms-of-use (fetched 2026-09-27). **There is no explicit scraping, robots or automated-access clause.** The relevant clause:
> "You may view this Website and its contents using your web browser and electronically copy and print hard copies of parts of this Website and its contents for personal, non-commercial use. Except as permitted under the Copyright Act 1968 (Cth) … any other use (including any adaptation, reproduction, broadcast, decompiling, disassembling, downloading, copying, storage, distribution, transmission, printing, display, publication or creation of derivative works) of any part of this Website is prohibited."

Storing and republishing product data (titles, images, prices) goes beyond "personal, non-commercial use". Keep stored data minimal (SKU, status, price) and link out rather than republishing images or descriptions.

### Recommended approach
1. **Primary:** 2 Algolia `/query` calls (Pokémon filter; OPCG query) every **5 min**, `hitsPerPage` ≤ 100, `attributesToRetrieve` limited to `sku,title,handle,price,availability,isMarketplace,release_date,in_stock_store_ids`. Diff on `sku` + `availability.{canPreOrder,overallStatus,clickNCollectStatus}`.
2. **Watchlist:** `/products/{handle}.js` for specific hot SKUs every 10–15 min (robots-clean, Shopify-cached).
3. **Secondary:** daily diff of the highest `sitemap_products_N.xml` for new TCG handles.
4. No Playwright needed.
5. **Risks:** the Algolia key or index name may change (re-discover from the collection page with a Playwright run weekly); the Algolia usage bill is JB's (keep volume low); marketplace noise; Cloudflare may start challenging a datacenter IP.

---

## 3. EB Games: `https://www.ebgames.com.au`

### What we observed (cloud IP)
- `GET /robots.txt` gave **403** with `server: cloudflare`, `cf-mitigated: challenge`, `cf-ray: …-IAD` and a "Just a moment..." **Cloudflare managed challenge (Turnstile, sitekey `0x4AAAAAAADnPIDROrmt1Wwj`)**, to both curl and headless Chromium. The Turnstile `pat` call returned 401.
- **robots.txt, sitemaps, platform and endpoints: UNVERIFIED.** We made no bypass attempt and saved no fixtures.

### From public sources (UNVERIFIED, search-engine results only)
- Category URLs: `https://www.ebgames.com.au/featured/pokemon-trading-card-game` and `https://www.ebgames.com.au/featured/trading-cards`.
- Product URL pattern: `https://www.ebgames.com.au/product/toys-and-collectibles/{numericId}-{slug}` (e.g. `/product/toys-and-collectibles/340997-pokemon-tcg-mega-evolution-chaos-rising-booster`).
- EB takes TCG **pre-orders with a deposit** (e.g. $3 deposit on a $9.95 booster). Press reports say some Pokémon TCG drops are gated to **EB World Plus** members. A monitor can see that a pre-order has opened, but users may need membership to buy.
- **ToS** (https://www.ebgames.com.au/terms, quoted from a search-engine snippet and not fetched directly): "*You must not frame, mirror, scrape, data-mine, or otherwise reproduce or extract content from the Website, in whole or in part, by any means or in any form.*" It also prohibits "use of any collaborative browsing, mirroring or display technologies". **This is an explicit anti-scraping clause.**

### Recommended approach
- **Not feasible from cloud infrastructure without bypassing Cloudflare, which is out of scope.**
- Next step: Jamie checks from an AU residential browser whether `/robots.txt` and `/featured/pokemon-trading-card-game` load without a challenge, and captures the network log (XHR endpoints, pre-order signalling).
- Even if it's reachable, the explicit ToS clause makes automated polling **high risk**. Compliant alternatives: EB's own email/app notifications, EB's social accounts and press coverage (press-start.com.au regularly reports "EB pre-orders live"), or user-submitted reports.
- Interval: n/a.

---

## 4. BIG W: `https://www.bigw.com.au`

### What we observed (cloud IP)
- curl over HTTP/2 hit a stream `INTERNAL_ERROR`. Over HTTP/1.1 it timed out after 30 s with 0 bytes (tarpit behaviour).
- Headless Chromium got **403 "Access Denied"**, Akamai reference `errors.edgesuite.net/18.bdbd7768…`, on `/robots.txt`.
- **robots.txt, sitemaps, platform, endpoints and ToS: UNVERIFIED.** We made no bypass attempt and saved no fixtures.

### From public sources (UNVERIFIED)
- Several commercial scrapers (Apify "BIG W Australia Product Scraper", "BIG W Marketplace Scraper") advertise JSON output with price and stock. That suggests structured product data exists in the frontend, but we have not observed any endpoint.
- BIG W runs a third-party marketplace (the same marketplace-noise issue as JB).
- BIG W is part of Woolworths Group. **Open question:** retrieve and quote the automated-access clause of its ToS from an AU browser.

### Recommended approach
- **Not feasible from cloud infrastructure.** Akamai Bot Manager-style denial happens at the edge before robots.txt.
- Next step: a manual AU residential check of robots.txt, the Pokémon TCG category page network log and the ToS.
- If it's reachable only from residential IPs, the options are (a) no automated monitoring, or (b) a user-contributed signal. **Do not use residential proxies to evade Akamai.**
- Interval: n/a.

---

## 5. Kmart: `https://www.kmart.com.au`

### What we observed (cloud IP)
- `GET /robots.txt` gave **403 "Access Denied"** from `server: AkamaiGHost` (`akamai-grn: 0.16a4c017…`), to curl and to headless Chromium.
- The 403 still set these cookies: `__country_code_=AU`, `mnm_rollout=TARGET_MARKETPLACE`, `new_search_enabled=true`, `__adv_opt_ko_=true`. They suggest a marketplace rollout (Kmart/Target integration) and a new search backend.
- **robots.txt, sitemaps, platform, endpoints and ToS: UNVERIFIED.** We made no bypass attempt and saved no fixtures.

### From public sources (UNVERIFIED)
- Category URL: `https://www.kmart.com.au/category/toys/pokemon-trading-cards/`.
- A third-party GitHub PR (Youdaox/stock-alert #2) claims that "Kmart's search runs on **Constructor.io**, which has no bot protection, so the whole Pokémon catalogue can be read… with the storefront's own key".
  - **We did not test this.** The key was not observed by us because the frontend was blocked.
  - Calling a vendor API directly to avoid the retailer's Akamai block is arguably circumvention.
- cardtracker.au advertises "live" AU store inventory tracking including Kmart. How it gets the data is unknown.

### Recommended approach
- **Not feasible from cloud infrastructure** without circumventing Akamai.
- Next step: an AU residential check of robots.txt, the ToS and the category page network log. If the frontend's own Constructor.io call (`ac.cnstrc.com`-style) is visible from a normal browser session, decide with Jamie whether calling it from the cloud is acceptable. **Recommendation: not without Kmart's consent.**
- Interval: n/a.

---

## ToS / compliance risk flags for Jamie

1. **Premium Bandai: explicit prohibition.** "You may not use spiders, robots, data mining techniques or other automated devices or programs to catalog, download or otherwise reproduce, store or distribute content…" plus "personal use… commercial use… strictly prohibited". Any polling is a ToS breach risk, even notify-only. Options: seek Bandai Namco's permission; limit to sitemap/news diffs; or rely on manual curation of announced `saleStartExpectedDt` windows.
2. **EB Games: explicit prohibition** (per search snippet, UNVERIFIED): "must not … scrape, data-mine, or otherwise … extract content… by any means". There is also an active Cloudflare challenge. High risk.
3. **JB Hi-Fi: no anti-automation clause**, but there is a copyright/"personal, non-commercial use" clause. Store facts (SKU, price, status), not copies of content or images. Use low volume, since Algolia usage is billed to JB.
4. **BIG W / Kmart:** ToS not read (blocked). Akamai denial at the edge is itself a strong signal that automated access from datacenters is unwelcome.
5. **General:** never add cart or checkout automation (every retailer's ToS forbids automating purchases, and it would make us a bot service rather than an alert service). Never use residential proxies or CAPTCHA solvers. Identify the bot with a contactable User-Agent (e.g. `TCGDropAlertBot/0.1 (+https://…; contact@…)`) if polling goes ahead. Honour robots.txt, including Premium Bandai's `limit=` rule.
6. **Australian law context (not legal advice):** ToS breach is mainly contract risk. Copyright attaches to images and descriptions, not to facts like price and stock. Take legal advice before charging users for alerts derived from Premium Bandai or EB data.

## Open questions

1. From an **AU residential IP**: do EB Games, BIG W and Kmart serve robots.txt and category pages without a challenge? Capture robots, sitemaps, ToS text and the XHR network log for each.
2. Does F5 on Premium Bandai start challenging `/api/search` under a regular 10–15 min poll from one IP? Does the AU store ever use lottery/raffle `productType`/flags? (Capture one during a live drop.)
3. What are the Premium Bandai `saleStatus` values beyond `End`, i.e. confirm the `Waiting` and `On` payloads in a live window. What is the correct `/api/search` param for series (`_f_series`?)?
4. JB: why did multi-index `/1/indexes/*/queries` return 404 through our proxy? What `overallStatus` value marks "sold out" (`OutOfStock`?) versus a product being delisted (`displayProduct:false`)?
5. Does Jamie want marketplace listings (JB, BIG W, Kmart/Target) at all, or only first-party stock?
6. Does Jamie want to approach retailers (JB, Premium Bandai) for permission or an affiliate or data feed? JB and BIG W affiliate programmes may provide product feeds (UNVERIFIED), which would be the most compliant data source.

## Sources
- Premium Bandai ToS: https://p-bandai.com/au/terms/termsofuse (fetched)
- JB Hi-Fi ToU: https://www.jbhifi.com.au/pages/help-and-support/terms-of-use (fetched)
- EB Games T&Cs (search snippet): https://www.ebgames.com.au/terms
- EB featured / product URLs (search results): https://www.ebgames.com.au/featured/pokemon-trading-card-game, https://www.ebgames.com.au/product/toys-and-collectibles/340997-pokemon-tcg-mega-evolution-chaos-rising-booster
- EB pre-order coverage: https://press-start.com.au/news/2026/05/01/eb-games-has-pokemon-mega-evolution-pitch-black-preorders-live-now/
- Kmart Constructor.io claim: https://github.com/Youdaox/stock-alert/pull/2 ; Kmart category: https://www.kmart.com.au/category/toys/pokemon-trading-cards/
- BIG W commercial scrapers: https://apify.com/dromb/big-w-au-product-scraper
- Premium Bandai drop mechanics commentary: https://autoqueue.app/drops/premium-bandai
