# TCGTracker: status against the brief

Legend: ✅ done and tested · 🟡 built, waiting on an account, licence or decision from Jamie · ⏳ later phase · ❌ blocked by a third party

Owner decisions applied (2026-09-28): brand **TCGTracker**, domain **tcgtracker.com.au**, Premium **A$12.99/month incl. GST**, free drop alerts **delayed 1 day**, **eBay fallback ON** with affiliate details set in the admin console, PriceCharting US$49/mo plan, JB Hi-Fi approved, all prices in **AUD**, "Midnight Holo" design (Aman-style type and whitespace on a dark gamer/holo palette, with a light theme toggle).

## Pillar 1: Market cap
| Item | Status | Where |
|---|---|---|
| Homepage rankings (game, JP/EN, grade toggles, sortable, crawlable pages, search, sparklines, summary tiles) | ✅ server-rendered, e2e tested | `components/MarketCapTable.tsx`, `app/page.tsx` |
| JP and EN are always separate cards (DB trigger blocks cross-matching) | ✅ | `catalogue.sql` |
| Market cap = PSA pop × floor, in AUD with stored FX (RBA F11) | ✅ | `workers/tcgworkers/market/` |
| **Price-only mode** until PSA population is licensed: ranks by value, labelled, and switches to market cap per card as soon as a population exists | ✅ | `20260928000200_price_rankings.sql` |
| PriceCharting ingestion (CSV bulk + API), USD cents → AUD, grade field mapping, matcher → admin mapping queue | ✅ fixture tested; 🟡 needs token + licence | `sources/pricing/pricecharting.py` |
| Card, set, game and language hubs with charts, history tables, JSON-LD | ✅ | `app/[game]/**` |
| Buy button: TCGTracker listings first, else **eBay AU** search for that exact card/lang/grade, plus Alert me / Sell | ✅ unit + e2e | `lib/domain/buyButton.ts`, `lib/domain/ebay.ts` |
| eBay Partner Network: campaign ID entered in Admin → Settings populates every link; "Ad" disclosure next to links; `rel="sponsored"` | ✅ | `app/admin/settings` |
| PSA population data | ❌ PSA API terms/quota; licence from PSA or GemRate needed | `research/01` |

## Pillar 2: Marketplace
| Item | Status |
|---|---|
| Sign-in by magic link (works across devices via token-hash template) | ✅ e2e against local Supabase |
| Create listing: card search, grade, price in AUD, ≥2 photos (resized to WebP in the browser), quota shown | ✅ e2e |
| Quotas Free 5 / Premium 30 per calendar month (Australia/Melbourne), rejected listings count, no roll-over | ✅ DB-enforced + tested |
| Admin approval queue, reject with reason, request changes; lifecycle and expiry | ✅ e2e (admin) |
| On-site messaging per listing, realtime, unread counts, block, report, rate limits, banned words, anti-scam panel | ✅ e2e |
| Email alerts: new message, listing approved/rejected, wishlist match, saved search — deduped, batched, unsubscribe links (Spam Act) | ✅ outbox tested; 🟡 needs Resend key |
| Seller profiles, marketplace filters, per-card marketplace pages | ✅ |
| Listing SEO: active indexed, sold/expired 301, removed 410, pending never public | ✅ |
| PSA cert verification on listings | 🟡 logic tested; blocked by PSA API terms |

## Pillar 3: Retailer drop alerts (24/7)
| Item | Status |
|---|---|
| 24/7 runner: one thread per retailer, jittered schedule, polite client (robots, back-off, honest UA), heartbeat to healthchecks.io, health alerts to admin | ✅ tested |
| Transition-only events (new, pre-order, in stock, price change), first scan is a silent baseline (no flood) | ✅ |
| Tier timing: **Premium instant**, **Free +24 h**; tier re-checked at send time so upgrades/downgrades apply | ✅ SQL tested |
| Delivery by email, on-site feed (Premium live panel via RLS) and Discord webhook, with retries | ✅ |
| JB Hi-Fi adapter (Algolia, key discovered at runtime) | ✅ enabled |
| Target AU adapter | ✅ live 2 Oct 2026 (category pages served to the honest bot); alerts link to the category page until Target consents to deep links |
| Kmart | ✅ live 2 Oct 2026: category ItemList + product pages (robots-allowed, HTTP 200 to TCGTrackerBot); new listings within one 2-min cycle, stock/price in rotation, marketplace sellers flagged |
| BIG W | ❌ refuses connections from cloud IPs; retest from Fly.io Sydney |
| Premium Bandai, EB Games | ❌ terms ban bots |
| `/account/drops/` preference page, Discord account linking | ⏳ (drop filters are in the schema; drops page has the live panel) |

## Community alerts (added 30 Sep 2026, from the Lowkey / PokéMafia / DropZone research in `research/08-alert-groups.md`)
| Item | Status | Where |
|---|---|---|
| Member sightings: report in store (retailer, state, suburb, store, product, price, quantity, purchase limit, photo, note) or online (retailer link required) | ✅ SQL + e2e | `/account/sightings/`, `report_sighting()` |
| Verification: 2 member confirmations (1 with a photo), merge duplicate reports, trusted scouts, staff instant, sold-out votes, fake flags, 6 h expiry, daily limit, banned words | ✅ SQL tested | `20260930000100_sightings_releases_push.sql` |
| A confirmed sighting is a normal drop event: Premium instant, Free +24 h, public history delayed, email / on-site / Discord / push | ✅ e2e (report → confirm → worker → alert) | dispatcher |
| Moderation queue: confirm, reject (withdraws the alert), mark sold out | ✅ | `/admin/sightings/` |
| Scout rewards (10 confirmed = 30 days Premium) and public leaderboard | ✅ SQL tested | `/drops/scouts/` |
| Alert setup wizard: games, retailers, states, keywords, follow sets, max price, RRP only, member reports, channels, test alert | ✅ e2e | `/account/alerts/drops/` |
| Web push (phone and desktop, no app; iPhone via Home Screen) | ✅; 🟡 needs VAPID keys | `sw.js`, `PushToggle`, `push.py` |
| State pages (`/drops/vic/` …) and sightings-only retailers (Toymate, Myer, Amazon, Costco, Officeworks, Zing, Woolworths, Coles, independent stores) | ✅ | `/drops/[slug]/` |
| Release calendar: hub, per game, per release, reminders, `.ics` feeds, admin editor | ✅; 🟡 Jamie to enter releases | `/releases/`, `/admin/releases/` |
| eBay deal finder (official Browse API): BIN under value, auctions ending soon, strict matching, wishlist alerts, EPN links | ✅ fixture-tested; 🟡 needs eBay developer keys | `/deals/`, `ebay_deals.py` |
| Guides: 8 Australian evergreen guides | ✅ | `/guides/` |
| Giveaways | Not built: chance-based giveaways are trade-promotion lotteries (ACT/SA permits) | |

## Live stock monitor (added 1 Oct 2026, CardWatch-style)
| Item | Status | Where |
|---|---|---|
| Store registry: 67 AU stores surveyed; **44 monitored** (39 Shopify + 2 WooCommerce open catalogue feeds + JB Hi-Fi + Kmart + Target) | ✅ | `docs/research/09-retailer-registry.*`, migration `20261001000200` |
| Generic Shopify and WooCommerce monitors, configured per store in admin (collections, categories, keywords) | ✅ fixture + live tested | `workers/tcgworkers/drops/adapters/{shopify,woocommerce,catalogue}.py` |
| Honest-bot rules: robots.txt and Crawl-delay, `TCGTrackerBot` user agent, back-off on 429/403, blocked stores recorded, never worked around | ✅ | `/about/bot/` |
| Shared, self-tuning request budget across all Shopify shops (Shopify's edge limits per IP) | ✅ tested | `http.SharedGate` |
| Product matching to sealed products (set + type + language, price tie-breaker, new sets after a series name), with orphan clean-up | ✅ 65+ real titles | `drops/products.py` |
| One alert per new product (in stock > pre-order > listed); price-drop alerts at ≥5% (editable) | ✅ | `drops/state.py` |
| "Notify me" product watches (beat filters, keep tier timing), public watch counts | ✅ SQL tested | `product_watches` |
| Activity feed chips with counts (back in stock / new / pre-order / price drop / sightings), sort, game filter, load more | ✅ e2e | `/drops/` |
| In stock now, product pages (Product + AggregateOffer JSON-LD), product indexes, store coverage, retailer in-stock lists | ✅ e2e | `/drops/in-stock/`, `/products/…`, `/drops/stores/` |
| Admin: add a store, edit platform/config/blocked reason, probe CLI | ✅ | `/admin/drops/`, `python -m tcgworkers.drops.probe` |
| Live run (1 Oct 2026, from a shared cloud IP) | 🟡 WooCommerce store: 211 products ✅. Toys"R"Us: products, matching and pages ✅. Other Shopify shops: Shopify allowed only a few requests from that shared IP, and the monitor backed off as designed. **To verify from the Sydney server (Step 7b).** | |
| Big chains that block automated access (BIG W, EB Games, ZiNG, Mr Toys, Toymate, Amazon) | ❌ covered by member sightings; retest from Sydney; outreach template | |

## SEO (Australia)
Canonical, lowercase, trailing-slash URLs with 301s in middleware; redirects table without chains; filter pages `noindex,follow`; self-canonical pagination; `en-AU` + AUD everywhere; titles say "in AUD"; JSON-LD (Organization, WebSite, Breadcrumbs, Product/Offer, Dataset, FAQPage on Premium); split sitemaps; robots.txt; llms.txt. ✅ Crawl check: 400 pages, 124 sitemap URLs, no errors. Plan in `docs/SEO-STRATEGY-AU.md`.

Lighthouse (local production build): home ~90, card 92, marketplace 91, drops 98; accessibility and SEO 100.

## Admin console
Dashboard, listing approval, reports (read only reported threads, audit-logged), users and roles, mapping queue, retailers and drop health, settings (quotas, prices, eBay affiliate, drop delay). ✅ e2e. ⏳ Phase 4: catalogue editing, outlier review, redirects screen, news CMS.

## Billing
Stripe Checkout + portal + webhooks (source of truth, 7-day grace). ✅ unit tested; 🟡 needs Stripe keys and GST answer.

## Hosting
Web on Cloudflare Workers (OpenNext, build verified with `wrangler dev`); workers on Fly.io `syd`; Supabase Sydney. Budget similar to beforeyoufly.

## Tests
30 Sep 2026: SQL/RLS suite (122 assertions) · Python 309 · TS 118 unit · Playwright: 18 public, 10 account, 6 admin against live local Supabase · SEO crawl 500 pages / 138 sitemap URLs (live data) and 143 (demo), 0 errors · Cloudflare build OK · Lighthouse: accessibility, best practices and SEO 100; performance 92–98 (homepage 81–92 across runs).

Earlier (28 Sep): SQL/RLS ~75 assertions · Python 236 (ruff + mypy strict clean) · TS 76 unit · Playwright: 9 public, 6 account, 6 admin (against live local Supabase) · SEO crawl · Cloudflare build. All green in `.github/workflows/ci.yml`.

## Legal
Terms, privacy, marketplace rules are drafts marked `noindex`; **need an Australian lawyer** before launch. Non-affiliation footer in place.

## What Jamie needs to do
Follow `docs/SETUP.md` in order.
