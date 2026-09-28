# TCG Trade SEO strategy (Australia)

Goal: rank on Google Australia for card, set, price, population and restock searches made by Australian collectors. We win through site structure (one canonical URL per entity, deep internal linking, data in the HTML) and by being the only site doing this **in AUD, for Australians**.

## 1. Why .com.au plus AUD is an advantage
- A `.com.au` domain is a country-code TLD. Google treats it as **targeted at Australia automatically**, and no Search Console setting is needed. It ranks better on google.com.au for local searches, and worse for searches from outside Australia. That's the trade we want.
- Every price is shown in AUD with the FX date. Competitors (PriceCharting, PokeWealth, TCGCharts, TCGplayer) show USD. "PSA 10 Charizard price **AUD**" / "**Australia**" searches have few good answers.
- The drop alerts are about **Australian retailers** (JB Hi-Fi, BIG W, Kmart, Target, EB Games, Premium Bandai AU). "Pokémon restock Australia", "ETB restock JB Hi-Fi" and "One Piece booster box Australia" are local queries global sites can't answer.

## 2. Canonical URL structure (implemented)
Everything is lowercase and hyphenated with a trailing slash. The other form 301-redirects, and each entity has one URL.

```
/                                           Market cap rankings (PSA 10, AUD)
/market-cap/{game}/{lang}/{set}/            Scoped rankings
/cards/{game}/{lang}/{set}/{number}-{name}/ Card hub (the page that should rank for the card)
/marketplace/{game}/{lang}/{set}/{card}/    Listings for that card, in Australia
/marketplace/listing/{id}-{slug}/           A listing
/drops/{retailer}/                          e.g. /drops/jb-hi-fi/, /drops/big-w/
/releases/{game}/                           Australian release calendar
/news/{yyyy}/{slug}/                        Articles
```
- JP and EN printings are **separate pages** with no hreflang between them (they are different products). They link to each other with a visible "Japanese version" link.
- Filters and sorts (`?grade=`, `?sort=`) are `noindex,follow`, with a canonical pointing to the clean page. Pagination (`?page=2`) is self-canonical and gets its own title.
- A renamed slug gets an automatic 301 from the `redirects` table, so links never break.
- The sitemap index is split by type (static, sets, cards, listings, news), plus a Google News sitemap.

## 3. On-page, per template
| Template | Title pattern | Australian angle |
|---|---|---|
| Card | `Charizard ex 199/165 (151) PSA 10 Price in AUD, Population & Market Cap \| TCG Trade` | AUD price, "for sale in Australia" block, Aussie listings count |
| Card marketplace | `Charizard ex 199/165 (151 EN) for Sale in Australia` | state filter, local pickup |
| Set | `151 (Pokémon EN) Card List, Prices in AUD & PSA Population` | AU release date |
| Drops/retailer | `JB Hi-Fi Pokémon & One Piece TCG Restocks & Pre-orders (Australia)` | Australian retailer, RRP in AUD |
| Home | `Pokémon & One Piece Card Market Cap Rankings in AUD \| TCG Trade` | |

- H1s match the search intent: "Charizard ex 199/165 · 151 · English".
- Every data page states "Prices in AUD (RBA exchange rate, {date})" and "Last updated". Charts have an HTML table underneath so crawlers and AI assistants can read the numbers.
- Spelling is Australian English (en-AU): "colour", "catalogue", "favourite". Dates are shown as 28 Sep 2026, and times as AEST/AEDT.

## 4. Structured data (implemented)
- **Organization** with `areaServed: AU`, `address.addressCountry: AU`, and a `sameAs` list once the social profiles exist.
- **WebSite** with SearchAction, and BreadcrumbList on every page.
- **Product + AggregateOffer (AUD)** on card pages, and **Product + Offer (AUD)** on listings. `shippingDetails` gets `addressCountry: AU` when shipping is set.
- **Dataset** on market-cap and data pages, **NewsArticle** on news, and **Event** for Australian release dates.

## 5. Content plan (Phase 4, gets us authority)
1. **Evergreen Australian guides:** "How to get cards PSA graded from Australia (2026)" (costs in AUD, shipping, turnaround), "Where to buy Pokémon cards in Australia", "JP vs EN: what Australians should collect", "How to spot fake Pokémon cards", and a checklist per set.
2. **Weekly "Market movers (AUD)"** posts, drafted from our data and reviewed by an editor.
3. **Restock recaps** per retailer: "JB Hi-Fi Pokémon restock history". The delayed public drop history is indexable content that updates daily.
4. **Release calendar** with Australian dates (these often differ from US dates).

## 6. Technical
- Server-rendered HTML: the ranking table's top rows are in the initial response. This is checked in CI.
- Core Web Vitals: fast pages served from Cloudflare's Sydney and Melbourne edge, AVIF/WebP images and minimal JS. Lighthouse budgets of 90+ are enforced in CI.
- `robots.txt` blocks account, messaging, admin and internal search. `llms.txt` describes the site for AI assistants.
- IndexNow pings Bing/Yandex on change. Google gets the sitemap through Search Console.

## 7. Off-page and local signals
- A Google Search Console property for `https://tcgtrade.com.au` (a Domain property via DNS TXT). Submit `/sitemap.xml`.
- Bing Webmaster Tools: import from GSC.
- Links from Australian communities: Reddit r/PokemonTCGAus, Facebook groups, Discord servers, local game stores and Aussie YouTubers. The public drop history and the AUD market cap are the linkable assets.
- A Google Business Profile isn't needed. We're an online service with no shopfront, so Organization schema covers it.

## 8. Measuring it
- Weekly: GSC coverage (indexed vs submitted, split by sitemap), top queries containing "australia" / "aud" / retailer names, and CWV.
- The CI crawl fails a build on duplicate titles, missing canonicals, indexable filter pages or broken links.
