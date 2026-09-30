# Target Australia fixtures (from Wayback Machine snapshots)

Attempted 2026-09-28 from a cloud container (US egress, not AU or residential).
- The live site returned **HTTP 403 "Access Denied"** (`server: AkamaiGHost`, `errors.edgesuite.net/18.d41c2117...`) on `/robots.txt` for curl and on `/` for headless Chromium. We made no bypass attempt.
- The files below come from **public Internet Archive snapshots** (`https://web.archive.org/web/<ts>id_/<url>`). They show the page shape but **not current data**. Re-capture from an AU-hosted worker before relying on them.

| File | Source | What it shows |
|---|---|---|
| `robots-wayback-20260501.txt` | `https://www.target.com.au/robots.txt` (snapshot 2026-05-01) | Full robots.txt. `Disallow: /search/*`, `*sortBy=`, `*sortOrder=`, `*?newarrivals`, `*viewAs=grid`, `/checkout/`, `/my-account/`, `/~/`, `/spc/`. Sitemap: `/sitemap-index.xml`. |
| `plp-pokemon-cards-nextdata.json` | The `__NEXT_DATA__` JSON in `https://www.target.com.au/c/toys/trading-card-games/pokemon-cards/W1852642` (snapshot 2026-02-07), path `props.pageProps.metadata.productList`. Trimmed to 3 of 11 products. | Category listing. The Next.js app sits under `/uir-plp`, and the listing is served by **Constructor.io** browse (`group_id=W1852642`). Per product: `price.offerPrice` (AUD dollars, a float), `wasPrice`, `onePassPrice`, `variations[].{productDisplayType, comingSoon, inStock, price}` (`AVAILABLE_FOR_SALE` or `COMING_SOON` were seen), `labelProps.{onlineDate (epoch s), pTypeCode, onlineExclusive, targetExclusive}`, plus `onePassEarlyAccess`/`onepassexclusive` with dates. The filters include `deliverymodes` (Home Delivery / Click & Collect) and `newarrivals`. The file also includes the runtimeConfig subset (Constructor key, BFF URL). |
| `pdp-pokemon-blister-nextdata.json` | The `__NEXT_DATA__` JSON in `https://www.target.com.au/p/pokemon-tcg-mega-evolution-perfect-order-blister-assorted/72554982` (snapshot 2026-04-20), path `props.pageProps.product` | Product page shape: `code`, `baseProduct` (`P` + code), `productAvailability` (`NORMAL`), `productTypeCode`, `price.{value,currencyIso}`, `deliveryModes.{homeDelivery,expressDelivery,clickAndCollect}.available`, `onlineOnly`, `comingSoon`, `displayOnly`, `cncIstAllowed`, `purchasableVariantCodes`. |

No personal data. The descriptions are truncated.
