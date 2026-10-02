# 02 — Graded-card pricing sources (brief §14.2)

Research date: 2026-09-27. Everything below was re-checked on this date against the live docs, pricing and terms pages. It is not from memory. Where a page could not be read (HTTP 403 / bot wall), the claim is marked **UNVERIFIED** and the secondary source is named.
No accounts were created and nothing was bought. Product pages were read one at a time, spaced about 6 s apart, and only for the 20-card evaluation sample.

Requirements we score against: **R1** legitimate API/licensed feed + commercial display (+ ideally redistribution) + documented limits; **R2** Pokémon EN, Pokémon JP, One Piece EN, One Piece JP as separate records; **R3** per-grade (PSA 10 and PSA 9 minimum); **R4** stable IDs; **R5** at least daily, timestamped.

---

## 1. Comparison table

Legend: ✅ verified yes · ⚠️ partial / with caveat · ❌ no · ❓ UNVERIFIED

| Source | Legit / API? | Pkmn EN | Pkmn JP | OP EN | OP JP | Graded per grade (PSA10 / PSA9) | ID quality | Update freq + timestamps | Cost (USD) | Commercial display allowed? | Redistribution (our API/CSV)? | Rate limits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **PriceCharting API/CSV** | ✅ official REST + daily CSV | ✅ | ✅ separate "Pokemon Japanese …" consoles | ✅ | ✅ separate "One Piece Japanese …" consoles | ⚠️ PSA 10 ✅ (`manual-only-price`); "Grade 9" = PSA **or** BGS 9 blended (`graded-price`); also 7, 8, 9.5, BGS10, CGC10, SGC10, TAG10, ACE10 | ⚠️ numeric product `id` (persistent), `tcg-id`, `epid`; **no set-code / card-number / variant fields**: parse `product-name` + `console-name` | ✅ CSV regenerated every 24 h; ❌ no per-price timestamp in API (only our fetch time) | Legendary $49/mo for API/CSV (internal use only). **Commercial licence: price on request** | ❌ not on Legendary. Needs a **separate commercial licence + written permission** | ❌ not without written permission; data must be purged when the subscription ends | 1 call/s; CSV 1 per 10 min |
| SportsCardsPro | same company as PriceCharting | ❌ sports only | ❌ | ❌ | ❌ | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Scrydex** (took over pokemontcg.io) | ✅ official REST | ✅ | ✅ (JP raw in JPY) | ✅ (game in Beta) | ❓ likely ❌: only EN expansions seen | ✅ per company + grade (PSA/CGC/BGS/TAG/SGC); Pokémon ✅, One Piece graded "In Beta"; JP graded ❓ | ✅ `id` like `OP13-118`, `printed_number`, expansion `code`, `language_code`, named `variants` (e.g. `mangaAltArt`) | ✅ "changes at most once per day"; trends 1–180 d; ❓ explicit timestamp field | $29 / $99 / $399 per mo (5k / 50k / 250k credits) | ❓ ToS forbids "commercially exploit the Services without prior written authorization"; plans are sold for projects, so **get written confirmation** | ❌ "Resell, sublicense, redistribute, mirror" prohibited | 100 req/s; credit-metered |
| **JustTCG** | ✅ official REST, no approval step | ✅ | ✅ ("Pokemon Japan" game) | ✅ | ❓ no separate game; `language=Japanese` variant filter (added 2026-09-01) may cover it | ⚠️ **v2 beta** (since 2026-07-09): PSA/BGS/CGC/SGC… each grade its own variant | ✅ UUID (stable) + legacy slug | ✅ `updated_at` unix ts per market; "real-time" | $19 / $49 / $149 per mo; graded+raw together costs extra | ✅ **explicit in ToS §7.1 on any paid plan** | ❌ §7.2/7.3: no bulk export, no dataset, no feed | Free 10/min; Pro 100/min, 5k/day; Ent 500/min, 50k/day |
| PokemonPriceTracker | ✅ REST (sourcing undisclosed) | ✅ | ✅ | ❌ | ❌ | ✅ PSA 8/9/10, CGC, BGS, SGC from eBay sales | ⚠️ keyed on `tcgPlayerId` + set/number | ✅ daily, `lastUpdated` | Business $99/mo required for commercial use | ✅ Business/Enterprise only | ❌ | 500 req/min, 200k credits/day (Business) |
| eBay Browse API | ✅ official | active listings only | | | | ❌ asking prices only, no sold data | eBay item ids | live | free | ❓ licence restricts deriving average selling price (UNVERIFIED: developer.ebay.com returns 403 here) | ❌ | per-app quotas |
| eBay Marketplace Insights (sold) | ✅ official but **Limited Release** | | | | | would give sold comps | | 90-day sold | n/a | n/a | n/a | "restricted and not open to new users" (secondary source) |
| TCGplayer API | ✅ official | ✅ | ✅ | ✅ | ❌ | ❌ raw only | productId | daily | n/a | n/a | n/a | **"We are no longer granting new API access at this time."** |
| Cardmarket API | ✅ official | raw only, EUR | | | | ❌ | idProduct | daily | n/a | n/a | n/a | **"Currently, we are not accepting applications"** |
| TCGdex | ✅ open API | ✅ | ✅ | ❌ | ❌ | ❌ raw (Cardmarket EUR + TCGplayer USD) | ✅ `SV2a-201`, `sv03.5-199` | ✅ `updated` ISO ts | free | ⚠️ raw only, not graded | ⚠️ | n/a |
| Pokémon TCG API (pokemontcg.io) | now "part of Scrydex"; API returned HTTP 500 during the test | raw only | | | | ❌ | | | | | | |
| Card Ladder | ❌ no public API (site 403) | | | | | graded sales exist | | | | ❌ | ❌ | third-party "Parse" scrapers only |
| Collectr | ❌ no public API | | | | | | | | | ❌ | ❌ | scrapers only |
| GemRate | ✅ API, but **population** only, not prices | | | | | ❌ prices | gemrate_id | daily pop | ❓ | | | |
| PSA Public API (swagger in repo) | ✅ official | | | | | ❌ cert, pop and orders only, no prices | spec/cert ids | | | | | |
| Alt, 130point | ❌ no public API; 130point 403; eBay sold pages behind login since late Aug 2026 | | | | | | | | | ❌ | ❌ | |
| pokemon-api.com / one-piece-api.com (tcggo, RapidAPI) | ⚠️ API, but data taken from Cardmarket/TCGplayer/eBay with no stated licence (site advertises scraping tools) | ✅ | ❓ | ✅ | ❓ | PSA10/PSA9 fields | | | $0–49.50 | ❌ fails R1 provenance | ❌ | |
| API TCG (apitcg.com), BerryWallet/PokéWallet, tcgfast, OPTCG API | ⚠️ catalogue / raw TCGplayer+Cardmarket; not graded; provenance unclear | | | | | ❌ | | | | ❌ | | |
| Yuyu-tei, Card Rush (JP retailers) | ❌ no API; Yuyu-tei rules: "如何なる場合であっても無断での転載を禁止" (no reproduction without permission) | | raw JP shop prices | | raw JP shop prices | ❌ | | | | ❌ | ❌ | Card Rush site 403 |
| SNKRDUNK | ❌ no public API; ToS bans "クローリング、スクレイピング…により…情報を取得する行為" (getting data by crawling or scraping) | | has PSA-graded JP sales | | has PSA-graded JP sales | (would be ✅) | | | | ❌ | ❌ | licence only by negotiation |
| Mercari JP | ❌ no buyer/data API; robots disallows /v1/ /v2/ | | | | | | | | | ❌ | ❌ | |

---

## 2. Notes per source (quoted terms + URLs)

### 2.1 PriceCharting (pricecharting.com), recommended primary source
- API docs: https://www.pricecharting.com/api-documentation
  - Access: "API's are a premium tool. You must have a paid subscription to access the API."
  - Limits: "The API is limited to 1 call every second… CSV calls are limited to one every 10 minutes." "The CSV files are generated once every 24 hours." "CSV download feature is only available to Legendary subscribers."
  - **Licence:** "The API and CSV data are licensed for internal use only. Sharing our price data with a third party, or making it available within an application or service used by others, requires a commercial license and express written permission from us." With a Commercial Agreement they "prefer attribution of either a logo or text linkback to our specific product page `https://www.pricecharting.com/game/{id}`". "Data can and should be cached/stored on your servers." "All data gathered from the API or CSV must be purged after your subscription has ended."
  - "The API and CSV only support current item values… Historic prices and historic sales are not supported." We therefore have to build our own history from daily snapshots.
  - Card field mapping (from "Key Descriptions"): `loose-price` = Ungraded; `cib-price` = Grade 7/7.5; `new-price` = Grade 8/8.5; **`graded-price` = Grade 9**; `box-only-price` = Grade 9.5; **`manual-only-price` = PSA 10**; `bgs-10-price`; `condition-17-price` = CGC 10; `condition-18-price` = SGC 10; `condition-19-price` = CGC 10 Pristine; `condition-20-price` = BGS 10 Black; `condition-21-price` = TAG 10; `condition-22-price` = ACE 10; grades 1–6 in `condition-9/10/13/14/15/16-price`. Also `sales-volume`, `tcg-id`, `epid`, `release-date`. Prices are integer US cents.
- Methodology https://www.pricecharting.com/page/methodology: "We collect sold listing data from eBay and our own… Marketplace". "Grade 9: Graded by PSA or BGS as 9"; "PSA 10: Graded by PSA as a 10". **So the PSA 9 column is not PSA-only.** This is a known limitation against R3, to be disclosed on our site or corrected with a second source.
- ToS https://www.pricecharting.com/page/terms-of-service, "Price Data Acceptable Use": "Price Data can be used for your Internal Business Purposes if you maintain a valid and current Legendary subscription… not for external display or redistribution. Price Data cannot be used in any software, application, or system that is accessible to third parties… without express written permission. To request permission, contact brady@vgpc.com." It also says "Price data may be referenced on external websites provided that PriceCharting is clearly cited as the source, and a visible hyperlink… is included". This covers citing, not systematic display.
- Pricing https://www.pricecharting.com/pricecharting-pro: Collector $6/mo (no API), **Legendary $49/mo** ("API Access to Price Data", "Download Price Lists"). No commercial-licence price is published. **Commercial licence cost: UNVERIFIED (contact required).**
- Coverage verified on https://www.pricecharting.com/category/pokemon-cards (435 set "consoles", including `pokemon-japanese-*`, `pokemon-chinese-*`, `pokemon-korean-*`) and /category/one-piece-cards (274 consoles, including `one-piece-japanese-*`). JP and EN are separate products with separate IDs (see sample).
- Freshness: sold listings on the Charizard page were dated as late as 2026-09-26, so the data is live. The API has no "as-of" timestamp, so we stamp the fetch time and CSV date ourselves.
- Uptime/SLA: **none documented** (a gap against R1).
- Data-sourcing risk: public eBay sold search has been behind a login since late Aug 2026, and Marketplace Insights is closed. PriceCharting's pages still show fresh sales, so they appear to have their own feed. Whether PriceCharting holds an eBay data licence is UNVERIFIED. Ask during licence negotiation.

### 2.2 Scrydex (scrydex.com), strongest alternative for Pokémon
- pokemontcg.io homepage: "The Pokémon TCG API is now part of Scrydex". The old v2 endpoint returned HTTP 500 during testing.
- Pricing https://scrydex.com/pricing: Starter $29/mo (5,000 credits), Growth $99/mo (50,000), Professional $399/mo (250,000), Enterprise custom. All plans include "Raw Prices, Graded Prices, Population Reports, Price Trends, Price History".
- Graded https://scrydex.com/docs/getting-started/prices: "PSA… CGC… BGS… TAG, SGC, and others". Each record has `grade`, `company`, `low/mid/high/market`, `currency`, and trends. Support table: Pokémon graded "✅ Supported", One Piece graded "✅ In Beta", MTG/Gundam/Riftbound "Coming Soon". "Raw prices for Japanese cards are currently all reported in JPY".
- One Piece card object: `id` "OP13-118", `printed_number`, `expansion.code`, `language_code` "EN", variants such as `mangaAltArt` / `redMangaAltArt`. The One Piece expansions page showed only EN sets, so **One Piece JP coverage is UNVERIFIED (probably absent)**.
- Rate limits: "100 requests per second… same for all plans". Caching: "Cache pricing data for at least 24 hours. This data only changes at most once per day."
- ToS https://scrydex.com/terms §4: users must not "Resell, sublicense, redistribute, mirror, or commercially exploit the Services without prior written authorization from Scrydex" or "Use the Services primarily as a substitute backend, proxy, or wholesale data source for a competing commercial…". §10: no uptime guarantee "unless expressly stated in a separate written agreement". **Display on a commercial site is not explicitly granted, so get written authorisation.**

### 2.3 JustTCG (justtcg.com)
- Pricing https://justtcg.com/pricing: Free (personal only), Starter $19, Professional $49, Enterprise $149 per month. "Every paid plan includes a commercial license." It also says "The one boundary: you can't resell the raw data as a feed or stand up a competing pricing API."
- ToS https://justtcg.com/terms (last updated 7/27/2026) §7.1: "End-user display: Display current prices, historical trends, and percentage changes to end users within a consumer-facing application or website." §7.2: stored data "may not be exported, published, sold, or otherwise made available to third parties as a dataset, whether in whole or in part." §7.3 prohibits redistributing "as a standalone data feed or bulk dataset".
- Graded https://justtcg.com/docs/api/cards-v2/graded: **Beta**. Companies are "PSA, BGS, CGC, BCCG, BVG, or SGC", and each company/grade/qualifier is its own variant with its own `markets[].price` and `updated_at`. Asking for raw and graded together (`graded=include`) costs extra.
- Regions https://justtcg.com/docs/api/cards-v2/regions: "Right now NA is the only region with data". JP market prices are not live yet.
- Games https://justtcg.com/supported-games: "Pokemon", "Pokemon Japan" (30K+ cards), "One Piece Card Game" (7K+ cards). There is no separate One Piece Japan game. The changelog (2026-09-01) added a `language=Japanese` variant filter; whether JP One Piece cards exist as variants is UNVERIFIED.
- Identifiers https://justtcg.com/docs/identifiers: "UUIDs are content-addressed and never change". Slugs "are not stable".

### 2.4 PokemonPriceTracker (pokemonpricetracker.com)
- Pokémon only (EN + JP). PSA/CGC/BGS/SGC graded from eBay sales, daily refresh. Pricing: Free / API $9.99 / **Business $99** / Enterprise $300.
- Terms (last updated August 19, 2026) §6: "Using PokePriceTracker Data for any commercial purpose requires an active Business or Enterprise subscription", which includes "Displaying card prices… within a commercial product". Also: "you may not… Create and sell bulk datasets, data feeds, or database exports".
- R1 risk: "PokePriceTracker… does not disclose its collection methods, sourcing arrangements… claims no partnership with or authorization from" TCGplayer, eBay or PSA, and "provides no indemnification against third-party claims". Provenance is weak.

### 2.5 eBay APIs
- developer.ebay.com returned **HTTP 403** to both curl and WebFetch from this environment, so the primary pages are UNVERIFIED. Secondary source (Scavio blog, 2026-08-30, https://scavio.dev/blog/ebay-sold-listings-api-login-wall-2026) quotes eBay's docs: Marketplace Insights "This is a Limited Release" and the support matrix says it is "restricted and not open to new users at this time". It also reports that logged-out sold search redirects to sign-in since late August 2026.
- API License Agreement (per search summary of https://developer.ebay.com/join/api-license-agreement, UNVERIFIED verbatim): it prohibits deriving average selling price for any category without express written permission, and requires deleting eBay data within 30 days of it no longer being needed. Browse API (active listings) is therefore unsuitable as a price-guide source.

### 2.6 TCGplayer: closed
https://docs.tcgplayer.com/docs/getting-started: "We are no longer granting new API access at this time." Raw only in any case.

### 2.7 Cardmarket: closed
https://help.cardmarket.com/en/cardmarket-api: "Currently, we are not accepting applications for access to the Cardmarket API." The old endpoint api.cardmarket.com returns 410. Raw only.

### 2.8 TCGdex (api.tcgdex.net)
A live public call worked: `/v2/en/cards/sv03.5-199` returns `pricing.cardmarket` (EUR, `updated` 2026-09-26T22:54Z) and `pricing.tcgplayer` (USD). `/v2/ja/cards/SV2a-201` returns Cardmarket only. **Raw only, so it fails R3.** It is still useful as a free Pokémon EN/JP catalogue ID source (`SV2a-201`).

### 2.9 Others
- **Card Ladder**: no public API (site 403 here). Data is only available through third-party scrapers (parse.bot), so it fails R1.
- **Collectr**: no public API; scrapers only. Fails R1.
- **GemRate** (https://docs.gemrate.com/introduction): API for population, certs and specs. No prices. Useful later for pop-report columns.
- **PSA Public API** (docs/research/psa-swagger.json): cert, orders and population only. No prices.
- **Alt / 130point**: no API. 130point relied on eBay sold pages, which are now behind a login.
- **pokemon-api.com / one-piece-api.com (tcggo on RapidAPI)**: response includes `graded.psa.psa10/psa9` and eBay medians, but the site promotes scraping Cardmarket/TCGplayer and states no licence. Fails R1.
- **JP sources**: Yuyu-tei rules page ("当サイトに掲載されている画像及び文章、コンテンツの権利は当店に帰属します。如何なる場合であっても無断での転載を禁止", i.e. the shop owns its content and forbids reproduction without permission), https://yuyu-tei.jp/info/rule. SNKRDUNK terms (https://snkrdunk.com/terms) prohibit "クローリング、スクレイピング又はこれらと類似する手段により本サービスにアクセスし、又は本サービスに関する情報を取得する行為" (accessing the service or collecting its information by crawling, scraping or similar means). Card Rush and the Mercari ToS URL returned 403/404. **No JP source is usable without a negotiated licence.** SNKRDUNK is the most valuable one to approach, because it has PSA-graded JP sales for both games.

---

## 3. Recommendation

**Primary: PriceCharting with a commercial licence (Legendary $49/mo for API/CSV, plus a negotiated commercial agreement).**
It is the only source verified to cover all four segments (Pokémon EN, Pokémon JP, One Piece EN, One Piece JP) as separate records with PSA 10 prices. It also has the most grade columns and a daily CSV, which suits a market-cap site.

Trade-offs and mitigations:
1. **Licence gate (R1).** The standard terms forbid public display, so a signed commercial agreement is a hard prerequisite. Redistribution in our own data API/CSV has to be asked for explicitly. Expect no or a separately priced answer. Until then, keep public data exports limited to our own derived data (e.g. our market-cap indices), subject to licence wording.
2. **"PSA 9" is PSA+BGS 9 blended (R3).** Label it "Grade 9" on the site, or cross-check Pokémon cards against Scrydex/JustTCG PSA-9 values.
3. **No set-code/number/variant fields (R4).** Map once through our own catalogue table: `console-name` → (game, lang, set_code) and `product-name` bracket text + `#number` → (number, variant). Store PriceCharting `id` as the foreign key, with `tcg-id` as a second key for EN. The 20-card sample shows this is feasible, with the gotchas listed in §5.
4. **No history in the API (R5).** Snapshot the daily CSV ourselves and stamp `observed_at`.
5. **USD only.** Convert to AUD with a daily FX rate and store both values.
6. No SLA is documented. Ask for one in the agreement.

**Secondary / fallback (Pokémon only, optionally One Piece EN): Scrydex Growth ($99/mo)** gives true PSA-specific per-grade prices, clean IDs and JP JPY prices. It needs written confirmation that commercial display is allowed. **Or JustTCG Professional ($49/mo)**, whose commercial display right is explicit in the ToS but whose graded data is still beta and which has no JP-market prices yet. Either can serve as a PSA-9 cross-check and a failover if PriceCharting negotiations fail. **Neither covers One Piece JP (UNVERIFIED), so without PriceCharting there is currently no legitimate One Piece JP graded source.** SNKRDUNK would have to be licensed.

Avoid: anything scraper-derived (Card Ladder/Collectr via Parse, tcggo/pokemon-api.com, 130point) and eBay Browse-derived "price guides". All of them conflict with R1.

---

## 4. What Jamie must approve or buy

1. **Email PriceCharting (brady@vgpc.com) for a commercial licence** covering (a) public display on the site, (b) our own public data API/CSV (redistribution), (c) attribution form, (d) SLA/uptime, (e) confirmation of eBay-data provenance. Budget: unknown until quoted.
2. **PriceCharting Legendary subscription, $49/mo** (needed for API/CSV even under a commercial agreement; UNVERIFIED whether the commercial licence bundles it).
3. Optional: **Scrydex Growth $99/mo** (after written OK for commercial display) **or JustTCG Professional $49/mo** as the PSA-9 cross-check and fallback for Pokémon.
4. Decide on the site's wording for PriceCharting's "Grade 9" (PSA or BGS 9) versus "PSA 9".
5. Choose an FX source for USD→AUD (separate research item).
6. Optional outreach: SNKRDUNK licensing for JP graded data (long lead time).

## 5. 20-card mapping sample (source = PriceCharting)

Full data: `docs/research/sample-20-cards.json`. Prices were read from public product pages at human pace on 2026-09-27 for evaluation only. **They are withheld from this repo** because PriceCharting data can't be republished without a licence; the mapping columns are what this sample proves. "PSA 9" is PriceCharting's "Grade 9" (PSA or BGS 9).

| # | Catalogue key (game+lang+set_code+number+variant) | PriceCharting id | PC console / slug | PSA10 | "9" | Ambiguity |
|---|---|---|---|---|---|---|
| 1 | pokemon·en·sv3pt5·199/165·SIR | 5809582 | pokemon-scarlet-&-violet-151/charizard-ex-199 | withheld | withheld | number stored as "#199" (no denominator) |
| 2 | pokemon·en·swsh7·215/203·alt-art | 2513024 | pokemon-evolving-skies/umbreon-vmax-215 | withheld | withheld | name lacks "alt art"; the number disambiguates |
| 3 | pokemon·en·sv8pt5·161/131·SIR | 8244604 | pokemon-prismatic-evolutions/umbreon-ex-161 | withheld | withheld | none |
| 4 | pokemon·en·svp·SVP085·promo | 5834844 | pokemon-promo/pikachu-with-grey-felt-hat-85 | withheld | withheld | **all EN promo eras merged into one console; "SVP" prefix dropped** (use tcg-id 518861) |
| 5 | pokemon·en·base1·4/102·holo-unlimited | 630417 | pokemon-base-set/charizard-4 | withheld | withheld | 1st-ed, shadowless, 1999-2000, black-dot are separate products, all "#4" |
| 6 | pokemon·jp·SV2a·201/165·SAR | 5326231 | pokemon-japanese-scarlet-&-violet-151/charizard-ex-201 | withheld | withheld | JP set named with the EN name; needs a set map |
| 7 | pokemon·jp·s6a·095/069·SA | 3472731 | pokemon-japanese-eevee-heroes/umbreon-vmax-95 | withheld | withheld | leading zero dropped ("#95") |
| 8 | pokemon·jp·SV8·132/106·SAR | 7641281 | pokemon-japanese-super-electric-breaker/pikachu-ex-132 | withheld | withheld | none |
| 9 | pokemon·jp·SV8a·217/187·SAR | 7980834 | pokemon-japanese-terastal-festival/umbreon-ex-217 | withheld | withheld | set name drops "ex" |
| 10 | pokemon·jp·PMCG1·(none, No.006)·holo | 3453295 | pokemon-japanese-expansion-pack/charizard-6 | withheld | withheld | no printed number; PC uses Pokédex #6; separate "no-rarity" product; our set_code is a convention |
| 11 | one-piece·en·OP05·OP05-119·manga-alt-art | 6235917 | one-piece-awakening-of-the-new-era/monkeydluffy-alternate-art-manga-op05-119 | withheld | withheld | 5+ products share OP05-119 (base, AA, manga, wanted, PRB01 reprint, SP gold/silver filed under OP06 set) |
| 12 | one-piece·jp·OP-05·OP05-119·manga-alt-art | 8506781 | one-piece-japanese-awakening-of-the-new-era/…-alternate-art-manga-op05-119 | withheld | withheld | no tcg-id for JP OP; thin volume (Grade 8 < raw) |
| 13 | one-piece·en·OP01·OP01-120·manga-alt-art | 6235389 | one-piece-romance-dawn/shanks-manga-alternate-art-op01-120 | withheld | withheld | slug word order differs ("manga-alternate-art" vs "alternate-art-manga"): normalise from the name bracket |
| 14 | one-piece·jp·OP-01·OP01-120·manga-alt-art | 8508451 | one-piece-japanese-romance-dawn/shanks-manga-alternate-art-op01-120 | withheld | withheld | none |
| 15 | one-piece·en·OP06·OP06-118·manga-alt-art | 6578585 | one-piece-wings-of-the-captain/roronoa-zoro-alternate-art-manga-op06-118 | withheld | withheld | same number also under Premium Booster 2 and "2nd anniversary" |
| 16 | one-piece·jp·OP-06·OP06-118·manga-alt-art | 8509384 | one-piece-japanese-wings-of-the-captain/roronoa-zoro-alternate-art-manga-op06-118 | withheld | withheld | none |
| 17 | one-piece·en·OP09·OP09-118·manga-alt-art | 8091682 | one-piece-emperors-in-the-new-world/goldroger-manga-op09-118 | withheld | withheld | labelled "[Manga]" only; "wanted" OP09-118 filed under the OP13 console |
| 18 | one-piece·jp·OP-09·OP09-118·manga-alt-art | 8506940 | one-piece-japanese-emperors-in-the-new-world/goldroger-manga-op09-118 | withheld | withheld | none |
| 19 | one-piece·en·OP02·OP02-013·manga-alt-art | 6235454 | one-piece-paramount-war/portgasdace-manga-op02-013 | withheld | withheld | also AA, SP, 2nd-anniv and PRB01 products |
| 20 | one-piece·jp·OP-02·OP02-013·manga-alt-art | 8507613 | one-piece-japanese-paramount-war/portgasdace-manga-op02-013 | withheld | withheld | none |

**Conclusion.** All 20 cards resolved to exactly one PriceCharting product, with JP and EN as distinct IDs. Mapping has to be keyed on (console → set) plus a normalised variant taken from the product-name bracket text. Printed card number alone is ambiguous: reprints and SP/wanted versions are filed under other sets' consoles. The JP One Piece product IDs (850xxxx) are much newer than EN (62xxxxx), which suggests PriceCharting split JP One Piece into its own consoles recently. Watch for ID churn (UNVERIFIED).

## 6. Open questions

1. PriceCharting commercial licence: price, whether redistribution through our own API/CSV is possible, attribution format, SLA, and the eBay-data provenance (given eBay's Aug-2026 sold-data login wall and the closed Marketplace Insights API).
2. Can PriceCharting provide a PSA-only 9 column (instead of PSA/BGS 9 blended)?
3. Are PriceCharting product IDs guaranteed stable across set re-organisations (e.g. the recent JP One Piece split)? UNVERIFIED.
4. Scrydex: written confirmation that displaying prices on a public commercial site is permitted; does it cover One Piece JP and JP graded? UNVERIFIED.
5. JustTCG: do JP One Piece cards exist as `language=Japanese` variants, and when do graded (v2) and the JP region leave beta? UNVERIFIED.
6. eBay developer docs could not be read from this environment (403). Should Jamie read the API License Agreement directly to confirm the "average selling price" prohibition?
7. Is a licensed JP-market graded source (SNKRDUNK / Yuyu-tei) worth pursuing, or are USD eBay-derived prices acceptable for JP cards on an AUD site?

---

## 6. Decision update (2 Oct 2026): JustTCG replaces PriceCharting

PriceCharting's Legendary plan is licensed for internal use only, and public display needs a separately negotiated commercial licence. The owner chose not to wait on that. JustTCG was re-checked live on 2 Oct 2026:
- **Licence.** Pricing page: "Ship it commercially. No permission needed." ToS (last updated 7/27/2026) §7.1 allows, on any paid plan, end-user display of current prices, historical trends and percentage changes. It also allows "Derived analytics: Calculate and display derived metrics, market observations, and aggregate valuations", which covers market cap. §7.2/7.3 forbid exporting the raw data as a feed, dataset or proxy API.
- **Graded data.** `/v2/cards` (beta) has graded variants per company (PSA, BGS, CGC, SGC, BCCG, BVG) and grade. Special labels and qualifiers are separate variants. Each comes with `markets[].price`, `updated_at` and `price_history`. Only the NA (USD) region has data so far.
- **Plans.** Professional is US$49/mo: 50,000 requests a month, 5,000 a day, 100 a minute, and 100 cards per request.

Implementation: `workers/tcgworkers/sources/pricing/justtcg.py` and `justtcg_ingest.py`; migration `20261002000400_justtcg.sql`. PSA grades drive market cap; BGS, CGC and SGC values are shown on card pages for comparison. Population is still not licensed (§1).
