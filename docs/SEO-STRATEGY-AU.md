# TCG Trade SEO strategy (Australia)

Goal: rank on Google Australia for card, set, price, population, restock, release-date and "how to" searches made by Australian collectors. We win through site structure (one canonical URL per entity, deep internal linking, data in the HTML), genuinely useful Australian content, and by being the only site doing this **in AUD, for Australians**.

## 1. Why .com.au plus AUD is an advantage
- A `.com.au` domain is a country-code TLD. Google treats it as **targeted at Australia automatically**, and no Search Console setting is needed. It ranks better on google.com.au for local searches, and worse for searches from outside Australia. That's the trade we want.
- Every price is shown in AUD with the FX date. Competitors (PriceCharting, PokeWealth, TCGCharts, TCGplayer) show USD. "PSA 10 Charizard price **AUD**" / "**Australia**" searches have few good answers.
- Drop alerts, sightings, release dates and guides are about **Australian retailers, states and dates**. "Pokémon restock Australia", "Kmart Pokémon cards", "ETB restock JB Hi-Fi", "[set] release date Australia" and "One Piece booster box Australia" are local queries global sites can't answer well.

## 2. URL map (every public route)
Everything is lowercase and hyphenated with a trailing slash; the other form 301-redirects (middleware). Files (`.xml`, `.txt`, `.ics`) have no trailing slash. Build every link with `web/src/lib/seo/urls.ts`.

| Pattern | What it is | Index? | Sitemap |
|---|---|---|---|
| `/` | Market cap rankings (PSA 10, AUD) | yes | static |
| `/market-cap/`, `/market-cap/{game}/`, `/market-cap/{game}/{lang}/`, `/market-cap/{game}/{lang}/{set}/` | Scoped rankings | yes | static / sets |
| `/cards/`, `/cards/{game}/`, `/cards/{game}/{lang}/` | Catalogue hubs | yes | static |
| `/cards/{game}/{lang}/{set}/` | Set: card list, AUD prices, population | yes | sets |
| `/cards/{game}/{lang}/{set}/{number}-{name}/` | **Card hub** (the page that should rank for the card) | yes | cards |
| `/marketplace/`, `/marketplace/{game}/` | Marketplace hubs | yes | static |
| `/marketplace/{game}/{lang}/{set}/{card}/` | Listings for one card in Australia | yes | cards |
| `/marketplace/listing/{id}-{slug}/` | A listing (wrong slug → 301; sold → 301 to the card after the visible window; removed → 410) | yes | listings |
| `/sellers/{username}/` | Seller profile | yes (see audit) | no |
| `/drops/` | Restock & pre-order feed (public, delayed) | yes | drops |
| `/drops/{retailer}/` | Per retailer, e.g. `/drops/kmart/` | yes if events in the last 90 days **or** evergreen copy; otherwise noindex,follow | drops (same rule) |
| `/drops/{state}/` | Per state, e.g. `/drops/vic/` (state codes never collide with retailer slugs) | same rule | drops |
| `/drops/scouts/` | Scout leaderboard | yes | drops |
| `/deals/` | eBay deals under market value | yes | static |
| `/releases/` | Release calendar, all games | yes | releases |
| `/releases/{game}/` | Release calendar per game (EN & JP), incl. "Earlier releases" | yes | releases |
| `/releases/{game}/{slug}/` | One release. **Past releases stay indexable** (people search "X release date" for months) | yes | releases (lastmod = `updated_at`) |
| `/releases/calendar.ics`, `/releases/{game}/calendar.ics` | iCalendar feeds (`text/calendar`, `X-Robots-Tag: noindex`, day-precision releases only) | no | no |
| `/guides/`, `/guides/{slug}/` | Evergreen guides | yes | guides (lastmod = `updated`) |
| `/news/`, `/news/{category}/` | News hubs | yes | static |
| `/news/{yyyy}/{slug}/` | Article | yes | news + Google News sitemap (last 2 days) |
| `/premium/`, `/methodology/`, `/data/`, `/api/`, `/about/`, `/contact/` | Static | yes | static |
| `/terms/`, `/privacy/` | Legal | yes | no |
| `/search/`, `/login/` | Utility | noindex; robots-disallowed | no |
| `/account/*`, `/messages/*`, `/admin/*`, `/report/` | Private | noindex (meta + `X-Robots-Tag`); robots-disallowed | no |
| `/sitemap.xml`, `/sitemaps/{type}.xml`, `/robots.txt`, `/llms.txt`, `/manifest.webmanifest` | Machine files | n/a | n/a |

Sitemap types (`web/src/lib/seo/sitemap.ts`): `static`, `drops`, `releases`, `guides`, `sets`, `cards`, `listings`, `news`, plus `news-google.xml`.

### Canonical rules
- Every indexable page is **self-canonical** via `buildMetadata({ path })`, using the absolute `NEXT_PUBLIC_SITE_URL`.
- Filters and sorts (`?grade=`, `?sort=`, `?state=`, `?q=` … anything except `page`) are `noindex,follow` with a canonical to the clean page.
- Pagination (`?page=2`) is self-canonical, indexable and gets " – Page 2" in the title and description.
- JP and EN printings are **separate pages with no hreflang** between them. They are different products, not translations, and link to each other with a visible "Japanese version" link.
- Renamed slugs get a 301 from the `redirects` table (cards, sets, marketplace, market cap; add releases, see audit).

### Indexation rules
- Index: pages with unique, useful content for an Australian searcher.
- Noindex,follow: filtered views; drops retailer/state pages with no events in 90 days and no evergreen copy; private and utility pages.
- 404 (real, not soft): unknown game/set/card/release/guide slugs.
- 410: removed listings.
- Don't robots-block a page whose noindex Google needs to see (only private areas are both).

## 3. On-page, per template
| Template | Title pattern | Australian angle |
|---|---|---|
| Card | `Charizard ex 199/165 (151) PSA 10 Price in AUD, Population & Market Cap` | AUD price, "for sale in Australia" block |
| Card marketplace | `Charizard ex 199/165 (151 EN) for Sale in Australia` | state filter, local pickup |
| Set | `151 (Pokémon EN) Card List, Prices in AUD & PSA Population` | AU release date |
| Drops/retailer | `JB Hi-Fi Pokémon & One Piece TCG Restocks & Pre-orders (Australia)` | Australian retailer, RRP in AUD, FAQ |
| Drops/state | `Pokémon & One Piece TCG Restocks in Victoria (VIC)` | member sightings in the state, time-zone notes |
| Release hub | `Pokémon & One Piece TCG Release Dates in Australia` | AEST dates |
| Release | `{Title} Release Date in Australia (EN)` / `Pre-order Date` / `Prerelease Date` | date precision + confidence, RRP A$, stockists |
| Guide | `{seoTitle}` (question/intent phrasing, "Australia") | AU retailers, AU official sources |
| Home | `Pokémon & One Piece Card Market Cap Rankings in AUD (Australia)` | |

- The brand suffix " | TCG Trade" is added automatically. Aim for ≤ 60 characters before the suffix and descriptions of 120–160 characters; the CI crawl warns above 70/170.
- H1s match search intent ("{Title} release date", "Kmart restocks & pre-orders").
- Every data page states "Prices in AUD" and "Last updated". Charts have an HTML table underneath.
- Australian English (en-AU): "colour", "catalogue", "favourite". Dates as "6 November 2026" / "6 Nov 2026"; times as AEST/AEDT. `<html lang="en-AU">`, `og:locale en_AU`.

## 4. Structured data
- **Organization** (`areaServed: AU`, logo) and **WebSite** + SearchAction on every page; **BreadcrumbList** on every page.
- **Product + AggregateOffer (AUD)** on card pages; **Product + Offer (AUD)** on listings.
- **Dataset** on market-cap and data pages; **NewsArticle** on news.
- **Event** on release pages: `startDate` only when the day is known, `eventStatus` EventScheduled, `location` Place/AU. Google's event rich results target real-world events, so treat this as descriptive markup rather than a rich-result play.
- **Article** (author/publisher = Organization, `dateModified`) and **FAQPage** on guides; **FAQPage** on drops retailer/state pages that show FAQs. Only mark up what is visible. FAQ rich results are now limited to authoritative government/health sites, but the markup is harmless and helps other consumers.
- **ItemList** on the release calendars and the guides hub.

## 5. Content plan: pillars and clusters
Three pillars, each a hub with clusters that link up, across and down.

1. **Market data**: hubs `/` and `/market-cap/`. Clusters: `/market-cap/{game}/{lang}/{set}/` ⇄ `/cards/{…}/{set}/` ⇄ card pages ⇄ card marketplace pages. Supporting guides: grading, JP vs EN, spotting fakes.
2. **Buying at retail**: hubs `/drops/` and `/releases/`. Clusters: retailers (`/drops/kmart/` …) ⇄ states (`/drops/vic/` …) ⇄ release pages (`/releases/pokemon/{slug}/`) ⇄ scouts. Supporting guides: buying at RRP, retailer restocks, One Piece in Australia, how alerts work.
3. **Buying and selling between collectors**: hubs `/marketplace/` and `/deals/`. Clusters: card marketplace pages, listings, sellers. Supporting guides: selling safely, spotting fakes, grading.

`/guides/` is the cross-pillar hub: every guide links down into at least two data pages and across to one to three other guides.

## 6. Internal-linking rules
1. **Build every href with `urls.ts`** (canonical, trailing slash). Never link to a URL that redirects; the CI crawl fails on it.
2. **Every page links up** (breadcrumbs) **and across** (siblings: other releases of the game, other guides, other retailers/states).
3. **Release page →** its set's card page and market-cap page (when the set exists), each stockist's `/drops/{retailer}/`, `/releases/{game}/`, the buying-at-RRP guide, drop alerts.
4. **Set and card pages →** the release page for that set (see audit: needs a small change on the set page).
5. **Drops retailer/state pages →** the relevant guide (restocks explained, alerts explained) and the release calendar.
6. **Guides →** 2+ data pages in the body, a "Related" list, and official sources for anything that changes (psacard.com, pokemon.com/au, en.onepiece-cardgame.com, auspost.com.au, scamwatch.gov.au, accc.gov.au, abf.gov.au, ato.gov.au).
7. **Anchor text** describes the destination ("Kmart restocks", "Pokémon release dates in Australia"), never "click here".
8. **No orphans:** the game release calendar lists "Earlier releases" so old release pages stay linked; the footer links `/releases/`, `/guides/` and `/deals/`.
9. Outbound retailer/product links and source attributions: `rel="nofollow noopener"`. Affiliate links (if any): `rel="sponsored nofollow"`.

## 7. 90-day content calendar (October–December 2026)
Every week: publish or update **release pages as soon as a date is announced** (day, month or quarter; mark confidence honestly and cite the source); review drops copy on any retailer/state page whose events change pattern; one "Market movers (AUD)" news post drafted from our data and edited.

| Week of | Publish / update | Target intent |
|---|---|---|
| 5 Oct | Launch `/releases/` with every announced EN and JP Pokémon and One Piece release through Q1 2027; submit the releases, guides and drops sitemaps in GSC | "{set} release date australia" |
| 12 Oct | Guide: "Elite Trainer Box vs booster bundle vs booster box: what to buy" (no prices; link RRP on release pages) | product comparison |
| 19 Oct | Guide: "Storing and protecting cards in Australian heat and humidity" (sleeves, top loaders, storage) | care / storage |
| 26 Oct | Update the restock guide with anything learned from sightings data (patterns only if verified across many reports) | "pokemon restock australia" |
| 2 Nov | Guide: "Pokémon prerelease events in Australia: what to expect" (link publisher event locators) | prerelease |
| 9 Nov | Gift guide: "Buying Pokémon or One Piece cards as a gift" (RRP, where to buy, avoiding fakes) | seasonal |
| 16 Nov | Add intros to the top 10 set pages (`sets.intro`) and link each to its release page | set list queries |
| 23 Nov | Guide: "One Piece Card Game for beginners in Australia" (starter decks, local stores, events) | OP beginner |
| 30 Nov | Recap post: "Biggest movers of 2026 (AUD)" from our data | year in review |
| 7 Dec | Guide: "How graded card prices work: PSA 10 vs PSA 9 in AUD" (link methodology) | grading value |
| 14 Dec | Bump guides' `updated` only where content changed; check every official link still resolves | freshness |
| 21 Dec | Guide: "Post-Christmas sales and TCG: what to watch for" (general; no invented discounts) | seasonal |
| 28 Dec | Plan Q1 2027 release pages; review GSC queries containing "australia", "release date" and retailer names; add FAQ answers for real queries | iteration |

## 8. Technical
- Server-rendered HTML: tables, dates and prices are in the initial response. Checked in CI.
- Core Web Vitals: Cloudflare's Australian edge, minimal client JS (Supabase is lazy-loaded), `next/font` (no font layout shift), lazy images with explicit sizes.
- `robots.txt` blocks account, messaging, admin, login and internal search. `llms.txt` describes the site (market data, drops, deals, releases, guides) for AI assistants.
- The CI crawl (`BASE_URL=… npm run seo:check`) fails on duplicate titles/descriptions, missing canonicals or breadcrumbs, indexable filter pages, broken or redirecting internal links, sitemap URLs that aren't indexable 200s, wrong `.ics` content type or redirects, missing Event/Article JSON-LD on releases/guides, and soft 404s. It warns on long titles/descriptions.

## 9. Off-page and local signals
- Google Search Console Domain property for `tcgtrade.com.au` (DNS TXT); submit `/sitemap.xml`. Bing Webmaster Tools: import from GSC.
- Links from Australian communities: Reddit r/PokemonTCGAus, Facebook groups, Discord servers, local game stores and Aussie YouTubers. The linkable assets: AUD market cap, the public drop history, the release calendar (and its `.ics` feed) and the guides.
- No Google Business Profile: we're online-only, and Organization schema covers it.

## 10. Measuring it
- Weekly: GSC coverage by sitemap (indexed vs submitted), queries containing "australia" / "aud" / "release date" / retailer names, CTR on guides and release pages, CWV.
- Monthly: guides and release pages with impressions but low CTR get title/description rewrites; pages with no impressions after 90 days get merged or improved.
