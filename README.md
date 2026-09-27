# TCG Market Cap, Marketplace & Drop Alerts (AU)

A website and background services for Australian Pokémon TCG and One Piece Card Game collectors. It has four parts: the Market Cap homepage, the Marketplace, Premium drop alerts and a public data API. The brief is in [`docs/BRIEF.md`](docs/BRIEF.md).

**Start with [`docs/STATUS.md`](docs/STATUS.md).** It goes through the brief section by section and marks each item done, gated (built but waiting on a decision) or pending. It also lists what Jamie needs to do. Research findings for §14 are in [`docs/research/`](docs/research/), starting with [`00-summary.md`](docs/research/00-summary.md).

## Layout

| Path | What |
|---|---|
| `wireframes/` | Low-fidelity clickable prototype: static HTML with greyscale Tailwind, 38 pages, each annotated with its SEO details. **Needs Jamie's sign-off before any real UI is built.** |
| `supabase/migrations/` | Postgres schema with RLS on every table. Business rules are enforced in the database: listing lifecycle, quotas, rate limits, banned words, the drop paywall, JP/EN guards, slug redirects and the audit log. |
| `supabase/tests/` | `run.sh` applies every migration to a fresh DB and runs about 60 SQL assertions. |
| `web/` | Next.js 16 (App Router, TypeScript) with every URL from brief §7.1: SSR/ISR, metadata, canonicals, JSON-LD, sitemaps, robots, llms.txt, proxy redirects and the Stripe webhook. The pages are unstyled skeletons until the wireframes are approved. |
| `workers/` | Python services: floor price and market cap maths, auto-matcher, FX (RBA), PSA client, drop-monitor engine, polite HTTP client, JB Hi-Fi adapter (fixture-tested, disabled) and the scheduler. |
| `docs/` | The brief, status, decisions and research. |

## Running it locally

Requirements: Node 22+, Python 3.11+ with [uv](https://docs.astral.sh/uv/), Postgres 16 (only for the DB tests).

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
TEST_DATABASE_URL=postgresql://postgres@localhost/tcg_test uv run pytest tests/test_jobs_db.py
uv run python -m tcgworkers.main --once fx   # needs DATABASE_URL
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
| `SENTRY_DSN` | workers | Error monitoring |
| `WORKER_USER_AGENT` | workers | Honest bot UA with a contact URL |
| `PSA_API_TOKEN`, `PSA_POPULATION_ENABLED` | workers | PSA API. The population flag stays `false` until a licence is signed. |
| `JB_ALGOLIA_APP_ID`, `JB_ALGOLIA_SEARCH_KEY` | workers | JB Hi-Fi adapter. Only set these once the retailer is approved. |

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

## Deployment (planned)

- **Web:** Vercel project with the root directory set to `web`, env vars as above, preview deploys on PRs.
- **Database:** a Supabase project in the Sydney region. Push the migrations with `supabase db push`, or paste them in order. Don't run `supabase/tests/supabase_stub.sql` against Supabase.
- **Workers:** an always-on host (Railway, Fly.io or a VPS) running `python -m tcgworkers.main`. It can't run on Vercel or GitHub Actions, because drop polling is under 5 minutes.
- **Stripe:** AUD price, GST-inclusive, with the customer portal enabled. Webhook: `https://<domain>/webhooks/stripe/`.
- **Email:** Resend, Postmark or SES, with SPF, DKIM and DMARC on the domain.
- **Monitoring:** Sentry DSNs, an uptime monitor on `/`, and Search Console with the sitemap submitted.
