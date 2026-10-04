# TCGTracker: rules for every change

TCGTracker (tcgtracker.com.au) is an Australian Pokémon and One Piece TCG market, marketplace, drops and stock site.
- `web/`: Next.js 16 on Cloudflare Workers (OpenNext). It deploys itself when a PR merges to `main`.
- `supabase/`: Postgres migrations, RLS and SQL tests. Deployed by hand: **Actions → Deploy database**.
- `workers/`: Python jobs and the 24/7 drop monitor on Fly.io. Deployed by hand: `fly deploy`.
- `docs/YOUR-NEXT-STEPS.md`: the owner's step-by-step guide. Keep it current. Every PR that needs an action from the owner adds a numbered step (what, why, exact clicks and commands, in order).

The owner is not a developer. Explanations are plain English, commands are copy-paste ready, and nothing secret ever goes in chat or code (secrets live only in Cloudflare, Fly.io, Supabase or GitHub secrets).

## SEO: non-negotiable (details in `docs/SEO-STRATEGY-AU.md`)
1. **One canonical URL per thing.** Lowercase, hyphenated, trailing slash; build every link with `web/src/lib/seo/urls.ts`. Never link to a URL that redirects.
2. **Metadata through `buildMetadata()`.** It gives a unique title (≤ 60 chars before " | TCGTracker"), a 120–160 char description and a self-canonical. Filtered or sorted views (`?q=`, `?sort=` …) are `noindex,follow`, canonical to the clean page. `?page=N` is self-canonical, with "Page N" in the title and description.
3. **Lists page at about ten** (`TABLE_PAGE_SIZE` 10, `GRID_PAGE_SIZE` 12) with `<Pagination>` (real `<a href>` links). No infinite scroll or "load more". A page past the end is a 404.
4. **Content is in the server HTML.** Prices, dates and tables render on the server. Charts get an HTML table. Client components only add live updates.
5. **Structured data matches what's visible:**
   - BreadcrumbList everywhere;
   - Product/Offer (AUD) on cards, listings and products;
   - Event on releases;
   - Article/FAQPage on guides;
   - ItemList on hubs.
6. **Real status codes:** unknown slug → 404 (`notFound()`), removed listing → 410, renamed slug → 301 via the `redirects` table. No soft 404s.
7. **Sitemaps list only indexable 200 pages,** with an honest `lastmod`. A new page type needs a sitemap entry and robots/indexation rules in the same PR.
8. **Australian first:** AUD with the FX date, en-AU spelling, dates in Australian time (`Australia/Sydney`), AEST/AEDT. Release dates come from Australian sources only (Bandai Oceania, AU retailers, editors), never overseas dates.
9. **Internal links:** every page links up (breadcrumbs) and across (siblings). New pages are never orphans. Anchor text describes the destination.
10. **Performance:**
    - Lighthouse performance and accessibility ≥ 90 (CI);
    - images have `alt`, explicit sizes and lazy loading;
    - no new client JavaScript on a page that doesn't need it;
    - Supabase stays lazy-loaded.

## Production gotchas (each one has bitten us)
- **Cloudflare is not `next start`:**
  - Never use `export const dynamicParams = false`. There's no OpenNext page cache, so build-time-only pages are 404 in production.
  - Don't rely on `revalidate` (ISR) caching for correctness. Every request renders today.
  - CI runs the real worker (`wrangler dev`). Its SEO crawl and browser scan must pass.
- **Store stock is live for members only:** visitors (and Google) read each listing's delayed copy (`public_*`, `stock.public_delay_minutes`), members `current_*`. Stock pages call `isSignedIn()` (it's free for visitors without a session cookie) and pass `{ live }` to the repo. New stock UI must do the same, and show `<StockFreshness>` where stock is the page's main content.
- **Realtime connections are scarce** (~200 on the free plan). Only signed-in members subscribe, with their own token (`sb.realtime.setAuth`). Never subscribe on a page view for an anonymous visitor.
- **Deploy order:**
  1. The web app deploys on merge, *before* the owner runs Deploy database. So web code must keep working until a new migration lands; fall back when an RPC or column is missing.
  2. Workers need their migrations first. Tell the owner: Deploy database, then `fly deploy`.
- **Workers run on 512 MB:**
  - Stream big tables (server-side cursors, batches); never `fetchall()` a whole table.
  - Big batch jobs set `Job(isolated=True)`, so they run in their own process.
  - The drop monitor and alert dispatcher must never wait on batch work.
- **Drop alerts are the product:** never add latency to the detect → dispatch → push path. Measure before and after.

## Scraping and data sources
Use the honest user agent `TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/)` and obey robots.txt and crawl delays. Never use proxies, fingerprint spoofing, fake user agents or CAPTCHA solving, and never scrape competitors. A source behind a bot wall (pokemon.com, EB Games) is off-limits: use another source or an editor.

## Before every PR
Run whatever the change touches, and say what you ran:
```
# web (in web/)
npm run lint -- --max-warnings 0 && npm run typecheck && npm test && npm run build
npx next start -p 3100 &  BASE_URL=http://localhost:3100 npm run seo:check && BASE_URL=http://localhost:3100 npm run site:scan
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e
# Cloudflare runtime (what production serves)
npx opennextjs-cloudflare build && npx wrangler dev --port 8788 --local &
BASE_URL=http://localhost:8788 npm run seo:check && BASE_URL=http://localhost:8788 npm run site:scan
# database (repo root, local Postgres)
PGHOST=localhost PGPASSWORD=postgres PGUSER=postgres bash supabase/tests/run.sh
# workers (in workers/)
uv run ruff check . && uv run ruff format --check . && uv run mypy tcgworkers
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tcg_test uv run pytest -q
```
A new DB test file must also be added to the list in `.github/workflows/ci.yml`. A PR that adds a migration says, in the PR and in `docs/YOUR-NEXT-STEPS.md`, that the owner must run **Deploy database**, and in which order relative to `fly deploy`.

Check the live site after a deploy:
```
BASE_URL=https://tcgtracker.com.au npm run site:scan
BASE_URL=https://tcgtracker.com.au DEMO_FIXTURES=0 SITEMAP_SAMPLE=25 MAX_PAGES=250 npm run seo:check
```
