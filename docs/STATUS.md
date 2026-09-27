# Brief status: every instruction checked

Legend: ✅ done and tested · 🟡 built, but gated on a decision or account from Jamie · ⏳ not started (the brief's own ordering puts it after an approval) · ❌ blocked

The brief sets two gates. **Section 14 must be reported back before the data pipelines are built**, and **the wireframes must be approved before any real UI is built** (§15). This PR therefore delivers the §14 report, the wireframes and the Phase 0 foundations, plus all the business logic that doesn't depend on either gate. Pages are unstyled skeletons with working data flow and SEO; the visual build waits for wireframe sign-off.

## §1–2 Vision, tiers, billing
| Item | Status | Where |
|---|---|---|
| Free 5 / Premium 30 listings per calendar month, in the user's timezone (default Australia/Melbourne) | ✅ enforced in the DB, mirrored in TS | `marketplace.sql` `quota_used()`, `web/src/lib/domain/quota.ts` |
| A listing counts on submission, rejected included; both rules configurable (`quota.period`, `quota.count_rejected`) | ✅ | tests in `rls.test.sql`, `domain.test.ts` |
| No roll-over; downgrades keep live listings and block new ones | ✅ tested | `rls.test.sql` |
| Stripe Billing, webhooks as the source of truth, grace period then downgrade | 🟡 reducer and route done and unit tested; needs a Stripe account | `web/src/lib/domain/billing.ts`, `app/webhooks/stripe/route.ts` |
| Checkout and customer portal pages | ⏳ UI after wireframes | |
| Price and quotas in config/DB; annual and founder prices planned | ✅ `site_settings` | `foundations.sql` |

## §3 Site structure & design
| Item | Status | Where |
|---|---|---|
| Nav: Home, Marketplace, Drops, News, Cards, Premium, account menu | ✅ skeleton | `components/SiteChrome.tsx` |
| Homepage market cap table: game/lang/grade toggles, all columns, sorting, crawlable `?page=N`, search, summary tiles | ✅ server-rendered (e2e confirms rows are in the initial HTML) | `components/MarketCapTable.tsx`, `app/page.tsx` |
| Buy button: listings → marketplace card page sorted cheapest first; none → "No listings yet" + Set alert + Sell yours; external fallback behind a flag, off by default | ✅ unit tested and e2e tested | `lib/domain/buyButton.ts` |
| Design reference review of cardscentral.com | ❌ the site blocks automated browsers; **Jamie to send screenshots** | `research/05-design-review.md` |
| Design system (tokens, table, card tile, badge, button, chip), dark mode | ⏳ after wireframe approval. Proposed tokens are in 05; the skeleton already supports dark mode. | |

## §4 Market cap system
| Item | Status | Where |
|---|---|---|
| Formula, per grade, total across grades, AUD with the FX rate stored | ✅ | `workers/tcgworkers/market/*.py` |
| Floor price: marketplace first, then external; outlier guard (configurable); last-sale fallback; no data → "—" and unranked; source, timestamp and sample size | ✅ 17 unit tests + DB pipeline test | `market/floor.py`, `test_market.py`, `test_jobs_db.py` |
| `card_external_ids` unique (source, external_id); JP↔EN can never cross (DB trigger) | ✅ | `catalogue.sql` |
| Auto-matcher with confidence → auto-link or admin queue; nothing dropped | ✅ tested, including the 20-card sample | `matching/matcher.py` |
| Chain test: price → card → market cap row → Buy button → listings, all four game/language combos | ✅ in SQL, plus TS Buy button tests | `rls.test.sql` (last section) |
| Pricing source chosen and approved | 🟡 recommendation made; **Jamie to approve and license** | `research/02` |
| PSA population via API | ❌ commercial terms and quota rule it out; **Jamie to contact PSA / GemRate** | `research/01` |
| `PopulationSource` interface; PSA client (cert + pop) disabled until licensed | ✅ | `sources/population/` |
| Population snapshots over time; daily market cap snapshots; 7d/30d changes | ✅ schema + jobs | `market_data.sql`, `jobs/registry.py` |
| Refresh cadence configurable (floors 4h, pop daily, FX daily) | ✅ | `site_settings`, `main.py` |
| FX daily from RBA | ✅ live-capable (fixture tested) | `sources/fx/rba.py` |
| Methodology page | ✅ | `app/methodology/page.tsx` |
| Card catalogue ingestion | 🟡 source choice needs approval | `research/03` |
| Admin tools: merge duplicates, map PSA specs | ⏳ UI after wireframes (schema ready) | |

## §5 Marketplace
| Item | Status | Where |
|---|---|---|
| Listing types, required fields, at least 2 photos (front/back) | ✅ DB-enforced | `marketplace.sql` |
| PSA cert validation, autofill, mismatch flag | 🟡 logic done and tested; the PSA quota and terms block live use | `psa.py` `check_listing_against_cert` |
| Lifecycle draft → pending → active → sold/expired/removed, plus rejected with reason; request changes | ✅ DB trigger + tests | |
| Admin approval by default; auto-approve for trusted sellers (off) | ✅ config flag | |
| Expiry after N days and a renewal function | ✅ expiry job + `renew_listing()`; ⏳ renewal email | |
| Filters, full-text search, per-card pages | ✅ skeleton | `app/marketplace/**` |
| Saved searches and wishlist tables | ✅ schema; ⏳ alert emails (Phase 2) | |
| Seller profiles | ✅ skeleton; response rate ⏳ | |
| Report, block, anti-scam guidance, rate limits, banned words | ✅ DB-enforced + tested; image moderation hook ⏳ | |

## §6 Messaging & email
| Item | Status |
|---|---|
| Threads tied to a listing; only participants can read (RLS tested); unread counts; block stops messages; rate limit; attachment size limit | ✅ DB |
| Admins can read **only reported** threads, and every read is audit-logged | ✅ tested |
| Contact details never exposed | ✅ private profile table |
| Messaging UI and Supabase Realtime | ⏳ after wireframes |
| Email provider, templates, batching, Spam Act unsubscribe | 🟡 schema ready (`email_log`, `unsubscribe_tokens`, preferences with marketing off by default); **Jamie to choose a provider** |
| Notification preference centre and bell | ✅ schema; ⏳ UI |

## §7 SEO
| Item | Status |
|---|---|
| Every URL in §7.1, lowercase, trailing slash, other form 301s | ✅ checked in CI |
| Redirects table; slug changes write 301s without chains; wrong listing slug 301s | ✅ DB + proxy, tested |
| Self-canonicals; filters `noindex,follow` canonicalised to the clean page; pagination self-canonical with unique titles | ✅ unit + crawl tested |
| No hreflang between JP and EN | ✅ |
| `en-AU`, AUD | ✅ |
| Title/description templates; dynamic OG images for card pages | ✅ |
| JSON-LD: Organization, WebSite+SearchAction, BreadcrumbList everywhere, Product+AggregateOffer, Product+Offer, Dataset, NewsArticle, Event | ✅ (FAQPage only when real FAQs exist) |
| Sitemap index split by type with lastmod; Google News sitemap | ✅ |
| Search Console submission and IndexNow | ⏳ needs the domain |
| robots.txt | ✅ |
| Listing lifecycle SEO: active indexed; sold/expired live then 301; rejected/removed 410; pending never public | ✅ tested |
| Core Web Vitals / Lighthouse ≥ 90 | ✅ skeleton scored 100/100 locally; budgets enforced in CI. Re-check after the design build. |
| WCAG 2.1 AA basics: semantic tables, labels, skip link, arrows plus colour | ✅ skeleton; a full audit after design |
| News CMS, guides, set copy | ⏳ Phase 4 (schema ready) |

## §8 Data authority
| Item | Status |
|---|---|
| llms.txt | ✅ |
| "Last updated", sources and methodology link on data pages; charts backed by HTML tables | ✅ |
| Stable `card_id` shown, mapped to external IDs | ✅ |
| Public API `/api/v1/` with keys and OpenAPI | ⏳ Phase 4 (`api_keys` table ready) |
| CSV/JSON datasets with licence | ⏳ Phase 4; only redistributable sources included (`Licence.redistribute`) |

## §9 Drop alerts
| Item | Status |
|---|---|
| Plug-in adapters, polite client (robots, jitter, back-off on 429/403, ETag caching, honest UA) | ✅ tested |
| TCG-only filter plus editable watchlist | ✅ tested |
| Transition-only, deduplicated events (NEW_LISTING, PREORDER_OPEN, IN_STOCK, PRICE_CHANGE, QUEUE_LIVE); state history | ✅ tested |
| RRP table and tags; suppress third-party sellers far above RRP | ✅ tested |
| Adapter health alerts after N empty or failed cycles | ✅ tested |
| Public delayed history; Premium-only instant events enforced by RLS | ✅ tested |
| JB Hi-Fi adapter | 🟡 fixture-tested, **disabled** until sign-off |
| P-Bandai, EB Games, BIG W, Kmart adapters | ❌ terms risk or blocked; see `research/04` |
| Email, on-site and Discord delivery; member filters | 🟡 filter table done; ⏳ delivery (Phase 3) |
| Auto-checkout, queue bypass, CAPTCHA solving | Out of scope by design |

## §10 Admin console
Roles admin, moderator and editor; server-side route check; RLS per role; **every staff write audit-logged by trigger**. Queues exist as data: `mapping_queue`, `reports`, pending listings, `pipeline_runs`, `retailers` health. ⏳ The screens come after wireframes. The route is gated today.

## §11–13 Stack, data model, legal
- Stack as suggested: Next.js/Vercel, Supabase with RLS on **every** table (CI fails otherwise), Python workers on an always-on host, Stripe, Sentry (inert until a DSN is set), Postgres full-text search. ✅
- Data model: every table in §12 exists, plus the Buy button index and trigger-maintained `card_listing_stats`. ✅
- Terms, privacy and marketplace rules: 🟡 outline pages, marked draft and `noindex`. **They need an Australian lawyer.** The non-affiliation footer is in place. ✅

## §15 Quality bar
| Item | Status |
|---|---|
| Unit tests: market cap and floor maths, outliers, quota counting, tier gating, RRP tagging, drop transitions | ✅ (72 Python + 27 TS) |
| Integration tests: listing lifecycle, messaging RLS, pipeline | ✅ (about 60 SQL + 1 pipeline) |
| Stripe webhook integration test in test mode | ⏳ needs Stripe keys (reducer unit tested) |
| Playwright e2e: Buy button routing, JP/EN pages, mobile overflow | ✅ 10 passing |
| E2E for signup, create listing, admin approve, message, subscribe | ⏳ written as skipped placeholders; need Supabase and Stripe test projects plus the UI |
| SEO checks in CI | ✅ `web/scripts/seo-check.mjs` |
| Lighthouse CI ≥ 90 | ✅ configured |
| Fixture-based scrapers, no live calls in CI | ✅ |
| Security: RLS, server-side admin check, validation, rate limits (listing and messaging in the DB), no secrets client-side, upload type and size limits | ✅; ⏳ rate limits on auth and API endpoints (Supabase Auth settings and Phase 4) |
| Error monitoring live | 🟡 wired; needs a Sentry DSN |
| README (setup, env vars, adding a retailer or data source, deployment) | ✅ `README.md` |

## What Jamie needs to do
See the numbered list in the pull request description. It's the same list as the session summary.
