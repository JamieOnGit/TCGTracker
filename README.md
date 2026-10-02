# TCGTracker · tcgtracker.com.au

Australia's graded Pokémon and One Piece card market, in AUD. It has three equal pillars:
- **Market cap rankings:** graded values, population and market cap, with JP and EN printings as separate cards.
- **Marketplace:** reviewed listings, on-site messaging and email alerts.
- **24/7 retail drop alerts:** JB Hi-Fi, BIG W, Kmart, Target and more. Premium members get them instantly and Free members 5 minutes later.

The original brief is in [`docs/BRIEF.md`](docs/BRIEF.md). **Setup steps for the owner (repo, domain, hosting, accounts) are in [`docs/SETUP.md`](docs/SETUP.md)**, and the SEO strategy is in [`docs/SEO-STRATEGY-AU.md`](docs/SEO-STRATEGY-AU.md).

**Start with [`docs/STATUS.md`](docs/STATUS.md).** It goes through the brief section by section and marks each item done, gated (built but waiting on a decision) or pending. It also lists what Jamie needs to do. Research findings for §14 are in [`docs/research/`](docs/research/), starting with [`00-summary.md`](docs/research/00-summary.md).

## Layout

| Path | What |
|---|---|
| `wireframes/` | The original low-fidelity prototype (38 annotated pages), kept for reference. The real design is built in `web/`. |
| `supabase/migrations/` | Postgres schema with RLS on every table. Business rules are enforced in the database: listing lifecycle, quotas, rate limits, banned words, the drop paywall, JP/EN guards, slug redirects and the audit log. |
| `supabase/tests/` | `run.sh` applies every migration to a fresh DB and runs about 60 SQL assertions. |
| `web/` | Next.js 16 (App Router, TypeScript), deployed to **Cloudflare Workers** via OpenNext. It has every URL from brief §7.1 and the "Midnight Holo" design system (`docs/research/06-design-direction.md`). The public pages, account, sell flow, messaging with realtime, alerts, billing and admin console are all server-rendered with SEO metadata, JSON-LD, sitemaps and redirects. |
| `workers/` | Python services in one process: the scheduler (FX, floors, snapshots, listing expiry and renewal reminders), the email outbox sender (Resend or SMTP), the drop-alert dispatcher (email, on-site, Discord), and the 24/7 drop monitor runner (one thread per enabled retailer). Also floor price and market cap maths, the auto-matcher, PSA client, polite HTTP client and retailer adapters. |
| `docs/` | The brief, status, decisions and research. |

## Running it locally

Requirements: Node 22+, Python 3.11+ with [uv](https://docs.astral.sh/uv/), Docker (for the local Supabase stack), and Postgres 16 (only for the plain SQL tests).

```bash
# Full local stack: Postgres, Auth, Storage, Realtime and Mailpit (http://127.0.0.1:54324),
# with every migration and supabase/seed.sql applied
npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta
npx supabase status -o env        # copy API_URL / ANON_KEY / SERVICE_ROLE_KEY into web/.env.local
```

```bash
# Web app. With no Supabase env vars it runs on clearly labelled DEMO data.
cd web
npm install
cp .env.example .env.local        # optional
npm run dev                       # http://localhost:3000
npm test && npm run lint && npm run typecheck
npm run build && npx next start -p 3100 &
BASE_URL=http://localhost:3100 npm run seo:check
npm run e2e                       # Playwright; set PW_CHROMIUM_PATH to use a local Chromium

# Database: schema, RLS and rules tests against a throwaway database
PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh

# Workers
cd workers
uv sync
uv run pytest                     # fixture-based; no live sites are called
uv run ruff check . && uv run ruff format --check . && uv run mypy tcgworkers
TEST_DATABASE_URL=postgresql://postgres@localhost/tcg_test uv run pytest tests/test_jobs_db.py
# Alert pipeline against `supabase start` (drop event -> dispatcher -> outbox -> SMTP -> Mailpit).
# Needs `smtp_port = 54325` under [local_smtp] in supabase/config.toml.
TEST_SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres uv run pytest tests/test_alerts_supabase.py

# Run everything locally, with emails landing in Mailpit (http://127.0.0.1:54324)
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export EMAIL_PROVIDER=smtp SMTP_HOST=127.0.0.1 SMTP_PORT=54325 SMTP_STARTTLS=false SITE_URL=http://localhost:3000
uv run python -m tcgworkers.main                    # scheduler + drop monitors + heartbeat
uv run python -m tcgworkers.main --once email       # or: fx, population, prices, floors, snapshots, expiry,
                                                    #     listing_expiring, drops_dispatch, drops_runner
```

Wireframes: open `wireframes/index.html` in a browser. See `wireframes/README.md` for rebuilding the CSS and screenshots.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | web | Canonical origin, e.g. `https://example.com.au` |
| `NEXT_PUBLIC_SITE_NAME` | web | Brand name (placeholder `BRAND` until chosen) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Public Supabase client. RLS protects the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | web (server only) | Webhooks and admin mutations. Never expose it to the client. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PREMIUM_MONTHLY` | web (server) | Billing |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | web | Error monitoring. Inert when unset. |
| `DATABASE_URL` | workers | Postgres connection string (service role) |
| `SENTRY_DSN` | workers | Error monitoring. Every ERROR log (failed job, retailer cycle, email) is reported. |
| `SITE_URL` | workers | Origin used in email links. Default `https://tcgtracker.com.au` |
| `EMAIL_PROVIDER` | workers | `resend` (production) or `smtp` (Mailpit locally, or AWS SES SMTP) |
| `RESEND_API_KEY` | workers | Resend API key, when `EMAIL_PROVIDER=resend` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS`, `SMTP_SSL` | workers | When `EMAIL_PROVIDER=smtp`. Local Mailpit: `127.0.0.1`, `54325`, `SMTP_STARTTLS=false`. SES: `email-smtp.ap-southeast-2.amazonaws.com`, `587`, SMTP credentials, STARTTLS on (the default). |
| `EMAIL_FROM` | workers | Optional override for the sender. The default is the `email.from` site setting (`TCGTracker <alerts@tcgtracker.com.au>`). |
| `ADMIN_ALERT_EMAIL` | workers | Receives admin alerts: a retailer monitor failing or returning nothing, emails or drop deliveries that exhausted their retries. Each alert is deduplicated per cause for 6 hours. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | web (build variable) | Web push public key (`npx web-push generate-vapid-keys`). Without it the push toggle shows "being set up". |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | workers | Web push signing key and contact (`mailto:hello@tcgtracker.com.au`). Without them push deliveries are skipped, never retried forever. |
| `SUPABASE_URL` | workers | Public Supabase URL, used to build sighting photo links in alerts. |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | workers | eBay Browse API keys for the deal finder (`deals.enabled` must also be on). Budget-capped under eBay's 5,000 calls a day. |
| `DISCORD_DROPS_WEBHOOK_URL` | workers | Premium Discord channel webhook. The bot posts once per drop event. |
| `HEALTHCHECK_URL` | workers | Dead man's switch, e.g. `https://hc-ping.com/<uuid>`. Pinged every minute while every job and retailer monitor is healthy. When something isn't, it pings `/fail` with the reasons. |
| `WORKER_USER_AGENT` | workers | Honest bot UA with a contact URL |
| `PSA_API_TOKEN`, `PSA_POPULATION_ENABLED` | workers | PSA API. The population flag stays `false` until a licence is signed. |
| `JB_ALGOLIA_APP_ID`, `JB_ALGOLIA_SEARCH_KEY` | workers | Optional. The JB Hi-Fi adapter reads these from JB's storefront theme bundle at runtime, caches them for 24h and re-reads them on a 401/403. Setting them only seeds that cache. |
| `PRICECHARTING_TOKEN` | workers | PriceCharting Legendary API/CSV token (secret, never logged). Without it the `prices` job skips. |
| `PRICECHARTING_CSV_URL_TEMPLATE` | workers | The CSV download URL from the PriceCharting Subscription page, with `{token}` and `{category}` placeholders. The default is the expected shape; see `docs/research/07` §D.5. |
| `PRICECHARTING_DISPLAY_OK` | workers | Licence metadata only. Set it to `true` once PriceCharting grants a commercial licence for public display. Ingestion runs either way. |
| `TARGET_DEEP_LINKS_OK` | workers | Target AU's terms forbid deep-linking without consent, so alerts link to the category page. Set this to `true` only once Target consents. |

Business rules (prices, quotas, intervals, thresholds, feature flags) are **not** environment variables. They live in the `site_settings` table, seeded in `supabase/migrations/20260927000100_foundations.sql`, and will be editable in the admin console.

## Adding a retailer

1. Review its robots.txt and terms first, and record the findings in `docs/research/04-retailers.md`. Don't build around bot protection.
2. Save a few trimmed responses under `workers/tests/fixtures/retailers/<slug>/`.
3. Write `workers/tcgworkers/drops/adapters/<slug>.py`. Subclass `RetailerAdapter`, decorate it with `@register`, fetch only through `PoliteClient`, and map availability to `Availability`. Copy `jb_hi_fi.py`.
4. Add fixture tests in `workers/tests/`.
5. Insert a `retailers` row (`enabled = false`), then enable it from the admin console once it's signed off.

## Adding a data source

- **Population:** implement `PopulationSource` (`workers/tcgworkers/sources/population/base.py`) and declare its `Licence`. Only sources with `redistribute=True` go into the public API and datasets.
- **Pricing:** implement `PricingSource` (`sources/pricing/base.py`). It must return JP and EN as separate records, per-grade prices, stable IDs and timestamps. Records pass through the `Matcher`: auto-links go to `card_external_ids`, anything else goes to `mapping_queue` for an admin.

## Deployment

The step-by-step owner guide is in [`docs/SETUP.md`](docs/SETUP.md).

- **Web:** Cloudflare Workers via OpenNext (`cd web && npm run deploy`, or Cloudflare's GitHub integration with root `web`). Tested locally with `wrangler dev`. `wrangler.jsonc` holds the public vars; secrets go in the Cloudflare dashboard.
- **Database:** a Supabase project in the Sydney region. Push the migrations with `supabase db push`, or paste them in order. Don't run `supabase/tests/supabase_stub.sql` against Supabase.
- **Workers:** one always-on Fly.io machine in `syd`, using `workers/Dockerfile` and `workers/fly.toml`. The deploy steps and secrets are in the comments at the top of `fly.toml`. Run exactly one machine (`fly scale count 1`) so the scheduler never runs twice. The workers can't run on Vercel or GitHub Actions, because drop polling is under 5 minutes. Point a healthchecks.io check (1 minute period, 3–5 minute grace) at `HEALTHCHECK_URL`.
- **Stripe:** AUD price, GST-inclusive, with the customer portal enabled. Webhook: `https://<domain>/webhooks/stripe/`.
- **Email:** Resend (`EMAIL_PROVIDER=resend`) or SES over SMTP, with SPF, DKIM and DMARC on `tcgtracker.com.au`. Every email has a one-click unsubscribe: `List-Unsubscribe` and `List-Unsubscribe-Post` headers pointing at `/unsubscribe/?t=<token>`, backed by `unsubscribe_tokens`. That page and its POST handler live in `web/`.
- **Monitoring:** Sentry DSNs, an uptime monitor on `/`, and Search Console with the sitemap submitted.
