# Project Brief: TCG Market Cap, Marketplace & Drop Alerts (AU)

> **For Claude Code:** Read this whole brief before writing any code. Section 14 lists open questions and data-source risks that must be investigated and reported back **before** the relevant component is built. Section 15 defines "done", including the testing and QA bar. Where this brief conflicts with a platform's terms of service or Australian law, stop and flag it. Don't work around it.

---

## 1. Vision
We're building a **website** (plus background services) for Australian Pokémon TCG and One Piece Card Game collectors, with four pillars:

1. **Market Cap view (the homepage):** a live, data-rich ranking of graded cards across **Pokémon and One Piece, in both Japanese (JP) and English (EN)**. Each card's market cap is *graded population in circulation × floor price*.
2. **Marketplace:** users list trading cards, and buyers contact sellers through on-site messaging. It uses a listing-quota system tied to membership tier, and an admin approves listings.
3. **Drop Alerts (Premium):** premium members get notified the moment One Piece or Pokémon TCG products drop, restock or open for pre-order **at retail price** at Premium Bandai AU, JB Hi-Fi, EB Games, BIG W and Kmart.
4. **Data authority:** the site should become the go-to source of TCG market data for collectors, search engines, AI systems and other businesses. It needs to be structured, crawlable, citable and machine-readable.

The business model is membership. **Premium starts at $12.99/month.**

---

## 2. Membership tiers

| Feature | Free | Premium ($12.99/mo) |
|---|---|---|
| Browse market cap, cards, marketplace, news | ✅ | ✅ |
| Marketplace listings | **5 per calendar month** | **Up to 30 per calendar month** |
| Contact sellers / on-site messaging | ✅ | ✅ |
| Email alerts: messages, listing status, saved searches/wishlist | ✅ | ✅ |
| **Retail drop alerts** (email + on-site; Discord optional) | ❌ | ✅ Instant |
| Premium badge on profile and listings | ❌ | ✅ |

Implementation rules:
- Quotas count **listings created per calendar month** in the user's timezone (default Australia/Melbourne). A listing counts when it is submitted, including if it's rejected. Unused quota does not roll over. Make "per calendar month" and the "rejected listings count" rule config values so they can be changed.
- **Downgrades:** existing active listings stay live, and new listings are blocked once the Free quota is exhausted.
- **Payments:** Stripe Billing subscriptions with GST-inclusive AUD pricing, the Stripe customer portal for cancel and update, and webhooks as the single source of truth for tier status. Handle failed payments with a grace period, then a downgrade.
- Price and quotas live in config/DB, not hard-coded. Plan for annual pricing and a founder price later.

---

## 3. Site structure & navigation

### 3.1 Primary navigation tabs
**Home** (Market Cap) · **Marketplace** · **Drops** · **News** · **Cards** (browse by game → language → set) · **Premium** (pricing) · account menu (Dashboard, My Listings, Messages, Alerts, Settings).

### 3.2 Homepage = Market Cap view
- The default view is a ranked table of cards by market cap, with toggles for **Game** (All / Pokémon / One Piece), **Language** (All / EN / JP) and **Grade** (PSA 10 default; PSA 9, and "All grades" if the data supports it).
- Columns: rank, card image thumbnail, card name, set, card number, language, PSA pop (for the selected grade), floor price (AUD), **market cap**, 7d/30d change, listings count on our marketplace, and a **Buy** button.
- Summary tiles above the table: total tracked market cap, biggest 24h/7d movers, newest listings, and the next retail drop.
- Sorting by any numeric column, pagination via real crawlable URLs, and search.
- **Buy button logic:**
  1. If there are one or more **active, approved** listings on our marketplace for that exact card (and grade, where the grade is selected), the button goes to our marketplace listings for that card, sorted by lowest price.
  2. If there are none, show "No listings yet" with **Set alert** (notify me when listed) and **Sell yours** (prefilled new-listing form).
  3. An *optional* external fallback (e.g. eBay Partner Network affiliate link) can be enabled behind a feature flag. It is off by default.
- The homepage must be server-rendered so the table's top rows are present in the initial HTML, for SEO and AI crawlers.

### 3.3 Visual design
- **Aesthetic reference: https://cardscentral.com.** Our bot-based fetch of that site was blocked, so review it in a real browser (or ask Jamie for screenshots). Capture its colour palette, typography, spacing, card grid treatment and how it presents prices.
- Build something with a *similar feel*, but with our own brand, name, logo, copy and assets. Do not copy their code, images or trademarks.
- The design must be mobile-first (most collectors browse on phones), with dark mode, fast data tables and card imagery that loads quickly.
- Build a small design system (tokens, table, card tile, badge, button, price-change chip) so every page stays consistent.

---

## 4. Market Cap system

### 4.1 Formula
```
market_cap(card, grade) = graded_population(card, grade) × floor_price(card, grade)
```
- The primary view is **PSA 10**: PSA 10 population × PSA 10 floor price.
- Also compute a per-grade market cap for other grades we have data for, plus an optional **total** (the sum across grades) shown as a secondary metric.
- All values are displayed in **AUD**. Store the original currency and the FX rate used, updated daily.

### 4.2 Pricing source & "floor price" (must be explicit and published)
PSA is used for **population data only**. **Pricing must come from a separate, reliable pricing source** chosen by Claude Code and approved by Jamie.

**Pricing source requirements (all mandatory):**
1. **Reliable and legitimate:**
   - An official API or licensed data feed, not fragile scraping
   - Terms that allow commercial display on our site (and, ideally, inclusion in our data API/datasets)
   - Documented rate limits and uptime
2. **Covers both JP and EN versions of each specific card** for **Pokémon and One Piece**, and returns them as **separate, distinguishable records**.
   - Example: the JP and EN versions of the same Charizard are two different price records.
   - A source that only covers EN, or merges JP and EN, **does not qualify** on its own. A combination of sources is acceptable if together they cover all four (Pokémon EN, Pokémon JP, One Piece EN, One Piece JP).
3. **Graded pricing:** prices are given per grade (at minimum PSA 10 and PSA 9), not only raw/ungraded.
4. **Stable card identifiers:** each card has a persistent ID (plus set code/number, language and variant) that we can map reliably to our catalogue.
5. **Freshness:** at least daily updates, with timestamps.

**Linking to our marketplace (the most important requirement):**
- Every price record from the external source must map to **exactly one card in our catalogue** (`cards.id`), which is the same entity our marketplace listings reference. This makes pricing, market cap, the Buy button and marketplace listings all line up on the same card and grade.
- Store the mapping in a `card_external_ids` table (card_id, source, external_id, lang, variant), with a unique constraint on (source, external_id).
- Build an **auto-matcher**:
  - Matches on game + language + set code + card number + variant
  - Produces a confidence score
  - Sends low-confidence or unmatched records to an **admin mapping queue** (Section 10). They are never silently dropped or mis-linked.
- The **JP and EN versions** of a card are separate catalogue cards, each with its own external IDs, price history, market cap, listings and URL. They must never be merged.
- When a seller creates a listing, they select the catalogue card (with language shown clearly), so the listing automatically ties to the same card that the pricing and market cap use.
- Add a test suite proving that, for sample cards in all four game/language combinations, price → catalogue card → market cap row → Buy button → marketplace listings all resolve to the same `card_id` and grade.

**Floor price definition:**
Floor price = the **lowest current asking price for that exact card, language and grade**. Each value carries metadata: source, timestamp and sample size.
- Source priority:
  1. Active approved listings on **our marketplace**, where they exist
  2. The approved external pricing source(s) above
- Guardrails:
  - Ignore obvious outliers, such as listings far below the recent-sales median (likely scams or errors). This must be configurable.
  - If no valid ask exists, fall back to the most recent sold price and mark it as "last sale".
  - If there is no data at all, show "—" and exclude the card from ranking.
- Also store **last sold price** and **30-day median sold** where available, since these are useful data points.
- Publish a **Methodology page** that explains exactly how the numbers are calculated. This builds trust and makes the site citable.

### 4.3 Population data (PSA)
- **Jamie's requirement is to source population data from PSA using the public API.**
- ⚠️ **This must be verified first.** Research indicates the PSA Public API (`https://api.psacard.com/publicapi/`, OAuth token via PSA account) is mainly **cert verification**, and population fields may not be populated. It does **not** provide pricing.
- Claude Code must:
  1. Register or test with the PSA API and document exactly which endpoints and fields are available (cert lookup, any population endpoint, rate limits).
  2. Read the **PSA API End User Agreement**. Confirm that commercial display and redistribution of the data on our site and data API is allowed.
  3. Report back **before** building the market cap pipeline. If population data isn't available via the API, propose compliant options for Jamie to choose from, such as a PSA data licence or partnership, or another licensed data provider. **Do not scrape PSA's population report pages without Jamie's explicit sign-off after a ToS review.**
- Build population ingestion behind a `PopulationSource` interface so the provider can be swapped without touching the rest of the system.
- Store **population snapshots over time**, so we can show pop growth charts and gem rates. This is valuable, unique data.

### 4.4 Card catalogue
- A single canonical **card entity** that the market cap, listings, alerts, news tags and URLs all reference. Scope: Pokémon EN, Pokémon JP, One Piece EN, One Piece JP.
- Card fields: game, language, set, set code, card number, name, variant/rarity (holo, alt art, SAR, manga, parallel, promo, etc.), release date, image, and PSA spec/identifiers for matching.
- **JP and EN versions are different cards with different pages**, not translations of each other.
- Catalogue sources must be investigated (Section 14), for example the Pokémon TCG API for EN and official card databases. Check the image usage rights for each source.
- An admin tool is needed to merge duplicates, fix card mappings and map PSA specs to catalogue cards.

### 4.5 Refresh cadence
- Floor prices: every few hours (configurable).
- Population data: daily or weekly, depending on the source's limits.
- FX: daily.
- Market cap snapshots are stored daily for charts and 7d/30d changes.

---

## 5. Marketplace

### 5.1 Model
- Classifieds-style: users list cards, and buyers **contact the seller via on-site messaging**. There is no on-site payment or escrow in v1. Design the schema so escrow or checkout can be added later.
- Listing types: **graded single** (company, grade, cert number), **raw single** (condition), and **sealed product** (booster box, ETB, etc.).
- Required fields: linked catalogue card (or sealed product), language, grade/condition, price (AUD), quantity, location (state/postcode, for local pickup and shipping), shipping options, description, and **at least 2 real photos** (front and back; slab photos for graded cards).
- For graded listings, validate the **PSA cert number via the PSA cert API** where permitted. Auto-fill the card and grade, and flag any mismatch for admin review.

### 5.2 Lifecycle
`draft → pending_review → approved/active → sold | expired | removed`, plus `rejected` (with a reason).
- All new listings go to the **admin approval queue** by default. There is a config option to auto-approve trusted sellers later.
- Listings expire after N days (configurable), with a renewal email.
- Sold and expired listings stay as **historical price data points**, and are handled for SEO per Section 7.4.

### 5.3 Discovery
- Marketplace home, per-card listing pages, filters (game, language, set, grade, price, location, listing type) and full-text search.
- **Saved searches and wishlist** trigger email alerts when a matching listing is approved.
- Seller profiles: listings, member since, and response rate. Design for ratings and reviews later.

### 5.4 Trust & safety
- Report listing or user, block user, and prominent anti-scam guidance (e.g. warn about off-platform payment methods with no buyer protection).
- Rate limits on listing creation and messaging.
- Image moderation hooks, and banned-words checks on titles and descriptions.
- Everything is surfaced in the admin console.

---

## 6. Messaging & email alerts

### 6.1 On-site messaging
- Conversation threads between buyer and seller, each tied to a listing.
- Features: unread counts, read receipts (optional), image attachments (size-limited), and near-real-time updates (e.g. Supabase Realtime).
- Block and report from inside a thread. Admins can view **reported** threads only, and every admin access is audit-logged.
- Protect contact details. Emails and phone numbers are never exposed by default; users choose what to share.

### 6.2 Email system
- Transactional email provider (e.g. Resend, Postmark or AWS SES) with SPF, DKIM and DMARC configured.
- Emails:
  - Welcome/verify
  - New message (batched/throttled, not one email per message)
  - Listing approved, rejected or expiring
  - Saved-search and wishlist match
  - **Retail drop alerts (Premium)**
  - Subscription receipts and payment failure
  - Weekly market digest (optional, opt-in)
- A **notification preferences centre** that controls each alert type per channel (email, on-site, Discord).
- Comply with the **Australian Spam Act 2003**: consent for marketing emails, identify the sender, and include a functional one-click unsubscribe.
- An on-site notification bell mirrors the email alerts.

---

## 7. SEO & URL architecture (critical)

The goal is to rank for card names, set names, "PSA 10 [card] price", "[card] population", "Pokémon/One Piece restock Australia" and similar queries. We take inspiration from the best marketplaces and data sites: eBay, TCGplayer, Cardmarket, PriceCharting, Zillow and CoinMarketCap (whose market-cap ranking model is the closest analogue to our homepage).

### 7.1 Canonical URL structure
Use lowercase, hyphenated, stable slugs. One canonical URL per entity. No trailing-slash ambiguity (pick one convention and 301 redirect the other).

```
/                                                     Home (market cap)
/market-cap/{game}/                                   e.g. /market-cap/pokemon/
/market-cap/{game}/{lang}/                            e.g. /market-cap/one-piece/jp/
/market-cap/{game}/{lang}/{set-slug}/                 set-level ranking

/cards/{game}/                                        game hub
/cards/{game}/{lang}/                                 language hub (list of sets)
/cards/{game}/{lang}/{set-slug}/                      set page (all cards in set)
/cards/{game}/{lang}/{set-slug}/{number}-{card-slug}/ CARD PAGE (canonical entity page)
    e.g. /cards/pokemon/en/151/199-charizard-ex/
         /cards/one-piece/jp/op-05/op05-119-monkey-d-luffy-manga/

/marketplace/                                         marketplace home
/marketplace/{game}/                                  game-level listings
/marketplace/{game}/{lang}/{set-slug}/{number}-{card-slug}/  all listings for a card (Buy button target)
/marketplace/listing/{listing-id}-{short-slug}/       individual listing
/sellers/{username}/                                  seller profile

/drops/                                               live & recent retail drops
/drops/{retailer}/                                    e.g. /drops/jb-hi-fi/
/releases/{game}/                                     release calendar

/news/                                                news hub
/news/{category}/                                     e.g. /news/pokemon/
/news/{yyyy}/{article-slug}/                          article

/premium/  /methodology/  /data/  /api/  /about/  /contact/  /terms/  /privacy/
```
Rules:
- `{game}` ∈ `pokemon`, `one-piece`. `{lang}` ∈ `en`, `jp`.
- The card page is the **hub** for each card. It holds market cap by grade, pop history, price history, active listings, sold history and related news. Marketplace card pages link to it and vice versa.
- A slug change (e.g. a renamed card) must create a **301 redirect**, stored in a `redirects` table. URLs never break.
- IDs in listing URLs keep them unique. The slug part is cosmetic, and a wrong slug 301s to the correct one.

### 7.2 Canonicals, facets & duplicates
- Every page gets a self-referencing `rel=canonical`.
- **Faceted/filter URLs** (price range, grade filter, sort) use query parameters, carry a canonical to the unfiltered page and are `noindex, follow`. The exception is a curated allowlist of high-value combinations, which are promoted to clean indexable paths (e.g. `/market-cap/pokemon/en/?grade=psa-9` stays noindex, but a curated "PSA 10 Charizards" landing page can be indexable).
- Pagination: use crawlable `?page=N` links, self-canonical on each page (don't canonical everything to page 1), and unique titles ("… – Page 2").
- JP and EN pages are different entities, so **no hreflang between them**. Use hreflang only if the UI is later localised into other languages.
- Set `en-AU` as the site language, and prices in AUD.

### 7.3 On-page & technical SEO
- **Rendering:** Next.js App Router with SSR/ISR, so all key content and data is in the initial HTML. No client-only data tables for primary content.
- **Metadata:** unique `<title>` and meta description templates per page type, e.g. "Charizard ex 199/165 (151) PSA 10 Price, Population & Market Cap | {Brand}". Add Open Graph/Twitter cards, with dynamic OG images for card pages showing the card image and market cap.
- **Structured data (JSON-LD):**
  - `Organization` + `WebSite` (with `SearchAction` sitelinks search box) site-wide
  - `BreadcrumbList` on every page
  - `Product` + `AggregateOffer` (lowPrice/highPrice/offerCount in AUD) on card pages
  - `Product` + `Offer` (price, availability, seller) on listing pages
  - `Dataset` on market cap pages, the methodology page and the data download pages
  - `NewsArticle` on news articles, `Event` for release dates where appropriate, and `FAQPage` only where real FAQs exist
- **Internal linking:** breadcrumbs everywhere. Game → language → set → card hierarchy. "Related cards" (same set, same character) links. News articles auto-link to tagged card and set pages.
- **Sitemaps:** a sitemap index split by type (cards, sets, listings, news, static), with accurate `lastmod`. A Google News sitemap for news. Submit sitemaps via Search Console and support IndexNow.
- **robots.txt:** allow content, and disallow account, messaging, admin, API write endpoints and internal search result pages.
- **Performance:** meet Core Web Vitals "good" thresholds. Optimised responsive images (next/image, AVIF/WebP, sized placeholders), edge caching and minimal client JS.
- **Accessibility:** WCAG 2.1 AA. Semantic tables with headers, alt text on card images and keyboard-navigable filters.
- **Monitoring:** Google Search Console and GA4 (or privacy-friendly analytics), plus a weekly crawl check for 404s, redirect chains and noindex mistakes.

### 7.4 Listing lifecycle SEO
- **Active** listings are indexable.
- **Sold/expired** listings stay live for a set period with a clear "Sold" state and price (a useful data point) and links to current listings for the same card. After that period, they 301 to the card's marketplace page.
- **Rejected/removed** listings return 410 or 404 and are never indexed.
- **Pending** listings are never publicly visible.

### 7.5 Content SEO
- **News** section: set releases, drop recaps, market movers and pop report updates. Market-mover and drop-recap articles should be partly auto-generated from our data, with editorial review before publishing.
- **Evergreen guides:** how to spot fakes, PSA grading in Australia, JP vs EN collecting, and a set checklist per set.
- **Set pages** carry unique intro copy plus data (set market cap, top cards, pull rates if known).

---

## 8. Data authority: machine-readable & AI-friendly
The goal is for AI systems, journalists and businesses to cite and use our data.
- A **public data API** (read-only, versioned `/api/v1/`) with endpoints for cards, sets, market cap rankings, price history and population history.
  - An API key is required, with free and paid rate-limit tiers. Premium API access is a future revenue line.
  - Document it with OpenAPI.
- **Downloadable datasets** (CSV/JSON) on `/data/`: daily market cap snapshots and set summaries. Include a clear licence and attribution requirement (e.g. CC BY 4.0 with a link back), **subject to the upstream data licences in Section 4.3**. Third-party data must not be redistributed beyond what its terms allow.
- An **`llms.txt`** file at the root describing the site, key pages, the methodology and the API.
- Every data page gets a visible "Last updated" timestamp, stated sources and a methodology link. Charts are accompanied by the underlying numbers in HTML tables, so crawlers can read them.
- Stable permanent IDs for cards and sets are exposed in the API and pages (e.g. `card_id`), and map to external IDs such as PSA spec.
- A **consistent units and currency** convention (AUD, with the date of the FX rate), labelled everywhere.

---

## 9. Retail drop alerts (Premium feature)

### 9.1 Retailers (Phase 1)
| Retailer | URL | Notes |
|---|---|---|
| Premium Bandai AU | https://p-bandai.com/au | One Piece drops, pre-orders; often uses queues/lotteries |
| JB Hi-Fi | https://www.jbhifi.com.au | Pokémon + One Piece; category + search pages |
| EB Games | https://www.ebgames.com.au | Pre-orders are key; frequent restocks |
| BIG W | https://www.bigw.com.au | Pokémon heavy; online + click & collect |
| Kmart | https://www.kmart.com.au | Pokémon; stock often store-dependent |

Each retailer is a **plug-in adapter**, so more can be added later (Target AU, Amazon AU, Toys"R"Us AU, Zing, etc.).

### 9.2 Discovery & filtering
- Source preference, in order:
  1. The public JSON endpoints that the site's own frontend uses
  2. Sitemaps and feeds
  3. Category and search HTML
  4. Playwright, only if required
- Filter to **TCG only**. Include: "One Piece Card Game", OP-/EB-/PRB- set codes, "Pokémon TCG", Elite Trainer Box, Booster Box/Bundle and set names. Exclude plush, video games, figures and apparel.
- An editable watchlist config holds keywords, set codes and priority SKUs/URLs.
- Link detected products to our **sealed product catalogue** where possible, so drop pages connect to the marketplace and news.

### 9.3 Events (transition-only, deduplicated)
- `NEW_LISTING`
- `PREORDER_OPEN`
- `IN_STOCK` (online and/or click & collect)
- `PRICE_CHANGE`
- `QUEUE_LIVE` (P-Bandai, if detectable)

Product state history is stored, and an alert fires only on a state change.

### 9.4 Retail-price logic
- An editable **RRP reference table** per product type/set.
- Each alert is tagged `AT RRP`, `BELOW RRP` or `ABOVE RRP (+x%)`.
- A config option suppresses marketplace-seller listings on retailer sites that are well above RRP.

### 9.5 Delivery
- To Premium members: email, an on-site notification and the live `/drops/` feed.
- Optional **Discord** delivery: a webhook/bot posting to premium channels, with Discord role sync for paid members.
- Members can choose which games and retailers they want alerts for.
- Public, **delayed** drop history on `/drops/` (e.g. 30+ minutes after the event) for SEO and to show proof of value. Instant alerts are premium-only.

### 9.6 Polling & reliability
- Polling interval is configurable per retailer: roughly 60–120 seconds for the watchlist, slower for broad discovery.
- Crawl politely:
  - Respect robots.txt
  - Add random jitter between requests
  - Back off on 429/403 responses
  - Cache responses
- Admin health alerts fire when an adapter errors or returns zero products for N cycles.
- **Out of scope:** auto-checkout bots, queue bypassing and CAPTCHA solving. The service only notifies humans.

---

## 10. Admin console (`/admin`, role-protected)
- **Listings approval queue:** approve, reject (with a reason template), edit or request changes. Bulk actions, a flag for cert-mismatch issues, and a view of the seller's history.
- **Listing control:** feature/pin listings, remove, extend or expire them, and reassign the card mapping.
- **Users:** search, view, suspend or ban, override tier or quota, and see a user's reports and listings.
- **Reports & moderation:** reported listings, users and message threads, with resolution workflow.
- **Catalogue:** add or edit cards, sets and sealed products. Merge duplicates, map PSA specs, and override or exclude bad price data points.
- **Card-mapping queue:** review unmatched or low-confidence price records from the external source. Approve the suggested match, pick the right card (with JP/EN clearly labelled) or create a new card. Every change is audit-logged.
- **Market data:** pipeline status, last refresh times, source errors, outlier review and manual recalculation.
- **Drops:** adapter health, RRP table editor, watchlist editor, alert log and manual "send alert".
- **News CMS:** draft, schedule and publish articles; tag cards, sets and games; SEO fields (title, description, canonical override, OG image).
- **Redirects manager** and an SEO overview (pages indexed vs noindexed, broken links).
- **Subscriptions:** a read-only view of Stripe status, and revenue metrics (MRR, churn).
- **Site settings:** tier prices and quotas, feature flags (external buy fallback, auto-approve) and announcement banners.
- **Audit log** of every admin action, recording who, what and when.
- Roles: `admin`, `moderator` (listings, reports), and `editor` (news).

---

## 11. Suggested tech stack
- **Web:** Next.js (App Router, SSR/ISR, TypeScript) + Tailwind, deployed on Vercel.
- **Database, auth & storage:** Supabase (Postgres, Auth, Storage for listing images, Realtime for messaging), with **Row Level Security on every table**.
- **Workers:** Python services for the drop monitors, price and population ingestion, and snapshots, running on an always-on host (Railway, Fly.io or a VPS). A queue or scheduler handles jobs. Vercel and GitHub Actions are not used for sub-5-minute polling.
- **Payments:** Stripe Billing.
- **Email:** Resend, Postmark or SES.
- **Search:** Postgres full-text search to start, with the option to move to Meilisearch or Typesense later.
- **Charts:** Chart.js (or similar), always paired with HTML data tables.
- **Observability:** Sentry for errors, uptime monitoring, and structured logs.
- **CI:** GitHub Actions runs lint, typecheck, tests and a preview deploy on every PR.

---

## 12. Data model (starting point; refine as needed)
**Catalogue**
- `games`, `languages`
- `sets` (id, game, lang, name, slug, code, release_date)
- `cards` (id, set_id, number, name, slug, variant, rarity, image_url, psa_spec_id, counterpart_card_id [the JP↔EN equivalent, if any], …)
- `card_external_ids` (card_id, source, external_id, lang, variant, match_confidence, verified_by) — unique on (source, external_id)
- `sealed_products` (id, game, lang, set_id, type, name, slug, rrp_aud)
- `redirects` (from_path, to_path, code)

**Market data**
- `population_snapshots` (card_id, grader, grade, population, source, captured_at)
- `price_points` (card_id, grade, type ask|sold, price, currency, price_aud, source, url, observed_at)
- `floor_prices` (card_id, grade, floor_aud, basis, source, computed_at)
- `market_cap_snapshots` (card_id, grade, population, floor_aud, market_cap_aud, date)
- `fx_rates` (currency, rate_to_aud, date)

**Marketplace**
- `listings` (id, seller_id, card_id | sealed_product_id, listing_type, grader, grade, cert_number, condition, price_aud, qty, location, shipping, status, rejection_reason, approved_by, approved_at, expires_at, sold_at, slug)
- `listing_images`, `saved_searches`, `wishlist_items`
- `reports`, `blocks`

**Users & billing**
- `users` (profile, username, location, role)
- `subscriptions` (user_id, tier, stripe ids, status, current_period_end)
- `listing_quota_usage` (user_id, period, count)

**Messaging & notifications**
- `conversations` (listing_id, buyer_id, seller_id)
- `messages`
- `notifications`, `notification_preferences`, `email_log`

**Drops**
- `retailers`
- `retail_products` (retailer_id, sku, url, sealed_product_id nullable, …)
- `retail_product_states`, `drop_events`, `rrp_reference`, `watchlist`

**Content & admin**
- `articles`, `article_tags` (to cards, sets, games)
- `admin_audit_log`, `site_settings`

Two database requirements:
- **The Buy button query** needs an index on `listings(card_id, grade, status)`, returning an active count and lowest price, cached on the card row or a materialised view for fast homepage rendering.
- All URL slugs are unique within their scope and generated from the data, with a redirect written whenever one changes.

---

## 13. Legal, privacy & compliance
- **Terms of Service**, Marketplace Rules (prohibited items, fakes/proxies banned, accurate grading claims) and a **Privacy Policy** compliant with the Australian Privacy Act.
- **Australian Consumer Law:** the subscription terms must be clear and cancellation must be easy.
- **Spam Act:** as covered in Section 6.2.
- **Data licensing:** display and redistribute PSA and other third-party data only as their terms allow. Attribute sources.
- Pokémon and One Piece are third-party trademarks. Use them descriptively only, with a non-affiliation disclaimer in the footer. Check the image usage rights for card imagery.
- Retail monitoring must stay within fair, polite crawling practices (Section 9.6).

---

## 14. Investigate & report back BEFORE building these parts
1. **PSA API:** actual endpoints, whether population data is available, rate limits, and the commercial-use and redistribution terms (Section 4.3).
2. **Pricing source (Section 4.2):**
   - Evaluate the candidate providers against every requirement in Section 4.2 (legitimacy/terms, JP and EN coverage for both games, graded prices, stable IDs, freshness).
   - Candidates include price-guide APIs, TCG marketplace APIs and eBay APIs. Verify the current availability of each; don't assume it.
   - Report a comparison table covering coverage (Pokémon EN/JP, One Piece EN/JP), graded vs raw, ID quality, update frequency, cost and terms.
   - Pull a sample of 20 cards (5 per game/language) to prove the mapping to our catalogue works.
   - Recommend one source (or a combination) and wait for Jamie's approval.
3. **Card catalogue sources** for Pokémon EN/JP and One Piece EN/JP, including image rights.
4. **Each retailer:** network calls, page structure, bot protection and a feasible monitoring approach (Section 9).
5. **cardscentral.com design review:** screenshots and notes on the design patterns to emulate (Section 3.3).
6. Confirm with Jamie:
   - Brand name and domain
   - That $12.99 is AUD, GST-inclusive
   - The quota rules (calendar month; whether rejected listings count)
   - Whether free users get any delayed drop alerts
   - Whether the external buy fallback should be enabled
   - Hosting and paid services

Ask Jamie before committing to any paid service.

---

## 15. Build phases & definition of done

**Wireframes — before any UI code (Jamie must approve)**
Build clickable, low-fidelity wireframes and share them with Jamie for sign-off before building the real UI.
- **Format:** a small static HTML/Tailwind prototype in `/wireframes`. It should be greyscale and use placeholder data, but have realistic content lengths and real navigation links between pages.
- **Views:** both mobile (≈390px) and desktop layouts for every page.
- **Pages:**
  1. **Home / Market Cap:** tabs, summary tiles, ranked table, Game/Language/Grade toggles, Buy button states (listed / not listed)
  2. **Card page:** market cap by grade, pop history, price history, JP/EN version switch linking to the other language's card page, active listings, sold history, related news
  3. **Set page** and **game/language hub**
  4. **Marketplace home** with filters, plus **marketplace card page** (Buy button target) and **individual listing page**
  5. **Create listing flow:** card search/select with language, cert number lookup, photos, price, and a quota indicator ("3 of 5 listings used this month")
  6. **Messages:** inbox and thread
  7. **Drops:** live feed (Premium) and public delayed history
  8. **News:** hub and article
  9. **Premium pricing page** and the upgrade prompt shown when a quota is hit
  10. **User dashboard:** my listings, saved searches/wishlist, notification preferences
  11. **Admin console:** listing approval queue, card-mapping queue, users, reports, drops health
  12. **Methodology** and **Data/API** pages
- **Annotations:** note the URL path, H1, title pattern, main JSON-LD type and key internal links on each wireframe, so the SEO structure is reviewed at the same time as the layout.
- **Delivery:** send screenshots and the run instructions, then iterate until Jamie approves. The approved wireframes become the reference for the design system build.

**Phase 0 — Foundations**
- Repo and CI
- Supabase schema, migrations and RLS
- Auth
- Design system
- URL routing skeleton with canonical, breadcrumb and metadata templates
- Sitemaps and robots.txt

**Phase 1 — Catalogue + Market Cap homepage**
- Card and set pages
- Data pipelines (once Section 14 is approved)
- Market cap view
- Methodology page

**Phase 2 — Marketplace**
- Listings with quotas
- Admin approval queue
- Buy button integration
- Messaging
- Email alerts
- Saved searches and wishlist

**Phase 3 — Premium & Drops**
- Stripe subscriptions
- Drop monitors and alert delivery
- `/drops/` pages
- Optional Discord

**Phase 4 — Data authority & content**
- News CMS
- Public API
- Datasets
- `llms.txt`
- Guides

**Quality bar (applies to every phase):**
- **Automated tests:**
  - Unit tests for market cap and floor-price maths, outlier rules, quota counting, tier gating, RRP tagging and drop state transitions
  - Integration tests for listing lifecycle, messaging permissions (RLS: users can only read their own threads) and Stripe webhooks, using Stripe test mode
  - End-to-end tests (Playwright) for signup, create listing, admin approve, the Buy button routing to a listing, messaging a seller, and subscribing to Premium
- **SEO checks in CI:**
  - Every indexable page has a unique title, meta description, self-canonical, breadcrumb JSON-LD and valid structured data
  - Filter pages are noindex
  - No broken internal links
  - The sitemap builds
- **Performance and accessibility:** Lighthouse CI budgets (performance and accessibility ≥ 90 on key templates).
- **Security:**
  - RLS on all tables
  - Admin routes checked on the server
  - Input validation everywhere
  - Rate limits on auth, listing, messaging and API endpoints
  - No secrets in client code
  - Uploads restricted by type and size
- Fixture-based tests for scrapers and ingesters. No live-site calls in CI.
- **A phase is done only when:**
  - All tests pass
  - There are no TypeScript or lint errors
  - Error monitoring is live
  - The README is updated covering setup, env vars, how to add a retailer or data source, and deployment
  - A short demo checklist has been walked through

## 16. How to work
- Work phase by phase, and open a PR per feature.
- Explain the trade-offs behind any major decision.
- Keep all business rules (prices, quotas, intervals, thresholds) in config or the DB.
- When unsure, ask. Don't guess on anything involving data licensing, legal matters or money.
