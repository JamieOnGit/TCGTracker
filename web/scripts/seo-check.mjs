#!/usr/bin/env node
/**
 * SEO checks for CI (brief 15). Crawls a running build and fails on:
 *  - broken internal links (non-200) or internal links that redirect
 *  - indexable pages without a unique <title>, a meta description, a
 *    self-referencing canonical, BreadcrumbList JSON-LD, or with invalid JSON-LD
 *  - filtered (query-string) pages that are indexable
 *  - a sitemap that doesn't build, or lists a URL that isn't a 200,
 *    indexable, self-canonical page
 *  - URL normalisation that isn't a 301 (trailing slash, uppercase)
 *  - key routes (releases, guides, drops by state, scouts, in stock now,
 *    store coverage, products) missing, not indexable or without their
 *    structured data (product pages need Product JSON-LD); .ics feeds with the wrong
 *    content type or a trailing-slash redirect; unknown slugs that aren't 404
 * Warns (doesn't fail) on titles over 70 characters and descriptions outside
 * 70–170 characters, since Google truncates them in results.
 *
 * Usage: BASE_URL=http://localhost:3000 node scripts/seo-check.mjs
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 400)
const errors = []
const warnings = []
const fail = (msg) => errors.push(msg)
const warn = (msg) => warnings.push(msg)

// Always crawled, even if nothing links to them yet.
const PRIVATE = ['/account/', '/messages/', '/admin/', '/login/', '/report/']
const SEEDS = ['/', '/releases/', '/releases/pokemon/', '/releases/one-piece/', '/guides/', '/drops/', '/drops/vic/', '/drops/scouts/', '/drops/in-stock/', '/drops/stores/', '/products/']

async function get(path) {
  const res = await fetch(BASE + path, { redirect: 'manual' })
  const type = res.headers.get('content-type') ?? ''
  const body = type.includes('text') || type.includes('xml') ? await res.text() : ''
  return { status: res.status, location: res.headers.get('location'), body, type, headers: res.headers }
}

const attr = (tag, name) => new RegExp(`${name}="([^"]*)"`, 'i').exec(tag)?.[1]
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function parse(html) {
  const title = decode(/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
  const metas = [...html.matchAll(/<meta\s[^>]*>/gi)].map((m) => m[0])
  const description = metas.map((m) => (attr(m, 'name') === 'description' ? attr(m, 'content') : null)).find(Boolean)
  const robots = metas.map((m) => (attr(m, 'name') === 'robots' ? attr(m, 'content') : null)).find(Boolean) ?? ''
  const canonical = [...html.matchAll(/<link\s[^>]*rel="canonical"[^>]*>/gi)].map((m) => attr(m[0], 'href'))[0]
  const jsonld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1])
  const links = [...html.matchAll(/<a\s[^>]*href="([^"#]*)[^"]*"[^>]*>/gi)].map((m) => ({ href: decode(m[1]), rel: attr(m[0], 'rel') ?? '' }))
  return { title, description: description ? decode(description) : undefined, robots, canonical: canonical ? decode(canonical) : undefined, jsonld, links }
}

function internalPath(href) {
  if (!href) return null
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (href.startsWith(BASE)) return href.slice(BASE.length) || '/'
  return null
}

const seenTitles = new Map()
const seenDescriptions = new Map()
const pageInfo = new Map()

async function checkPage(path) {
  const { status, location, body, type } = await get(path)
  if (status >= 300 && status < 400) return { redirect: location, status }
  if (status !== 200) return { status }
  if (!type.includes('text/html')) return { status, links: [], file: true } // feeds, text files
  const p = parse(body)
  const indexable = !/noindex/i.test(p.robots)
  const hasQuery = path.includes('?')
  const onlyPage = hasQuery && /^\?page=\d+$/.test(path.slice(path.indexOf('?')))
  if (hasQuery && !onlyPage && indexable) fail(`${path}: filtered page is indexable (needs noindex,follow)`)
  for (const raw of p.jsonld) {
    try {
      const data = JSON.parse(raw)
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item['@context'] !== 'https://schema.org' || !item['@type']) fail(`${path}: JSON-LD missing @context/@type`)
      }
    } catch {
      fail(`${path}: invalid JSON-LD`)
    }
  }
  if (indexable) {
    if (!p.title) fail(`${path}: missing <title>`)
    if (!p.description) fail(`${path}: missing meta description`)
    const canonicalPath = p.canonical?.replace(/^https?:\/\/[^/]+/, '')
    if (canonicalPath !== path) fail(`${path}: canonical is ${p.canonical ?? 'missing'} (expected self)`)
    if (!p.jsonld.some((j) => j.includes('"BreadcrumbList"'))) fail(`${path}: no BreadcrumbList JSON-LD`)
    if (p.title.length > 70) warn(`${path}: title is ${p.title.length} chars (may be truncated): "${p.title}"`)
    if (p.description && (p.description.length < 70 || p.description.length > 170)) warn(`${path}: description is ${p.description.length} chars`)
    if (p.title) {
      if (seenTitles.has(p.title)) fail(`${path}: duplicate title with ${seenTitles.get(p.title)}: "${p.title}"`)
      else seenTitles.set(p.title, path)
    }
    if (p.description) {
      if (seenDescriptions.has(p.description)) fail(`${path}: duplicate description with ${seenDescriptions.get(p.description)}`)
      else seenDescriptions.set(p.description, path)
    }
  }
  pageInfo.set(path, { indexable, canonical: p.canonical, jsonld: p.jsonld.join('\n') })
  return { status, links: p.links }
}

async function crawl() {
  const queue = [...SEEDS]
  const done = new Set()
  while (queue.length && done.size < MAX_PAGES) {
    const path = queue.shift()
    if (done.has(path)) continue
    done.add(path)
    const res = await checkPage(path)
    if (res.redirect) {
      fail(`${path}: internal link redirects (${res.status} -> ${res.redirect}); link to the canonical URL instead`)
      continue
    }
    if (res.status !== 200) {
      fail(`${path}: HTTP ${res.status} (broken internal link)`)
      continue
    }
    for (const { href } of res.links) {
      const p = internalPath(href)
      // Private areas are robots-disallowed and linked rel=nofollow; they redirect to /login/ by design.
      if (p && PRIVATE.some((x) => p.startsWith(x))) continue
      if (p && !done.has(p) && !queue.includes(p)) queue.push(p)
    }
  }
  return done.size
}

async function checkSitemaps() {
  const index = await get('/sitemap.xml')
  if (index.status !== 200 || !index.body.includes('<sitemapindex')) return fail('/sitemap.xml: not a sitemap index')
  const files = [...index.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ''))
  let urls = 0
  for (const f of files) {
    const s = await get(f)
    if (s.status !== 200 || !s.body.includes('<urlset')) {
      fail(`${f}: sitemap did not build (HTTP ${s.status})`)
      continue
    }
    for (const loc of [...s.body.matchAll(/<url><loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]).replace(/^https?:\/\/[^/]+/, ''))) {
      urls++
      const info = pageInfo.get(loc) ?? (await checkPage(loc), pageInfo.get(loc))
      if (!info) fail(`${f}: lists ${loc}, which is not a 200 page`)
      else if (!info.indexable) fail(`${f}: lists ${loc}, which is noindex`)
    }
  }
  return urls
}

async function checkNormalisation() {
  const cases = [
    ['/cards', '/cards/'],
    ['/Cards/', '/cards/'],
    ['/releases', '/releases/'],
    ['/guides/Buy-Pokemon-Cards-At-RRP-Australia/', '/guides/buy-pokemon-cards-at-rrp-australia/'],
    ['/market-cap/', '/'],
    ['/releases/calendar.ics/', '/releases/calendar.ics'],
    // Demo-data fixtures (a renamed card slug, a listing with a short slug); set DEMO_FIXTURES=0 for a live-data crawl.
    ...(process.env.DEMO_FIXTURES === '0'
      ? []
      : [
          ['/marketplace/listing/100001/', '/marketplace/listing/100001-charizard-ex-199-en-psa-10/'],
          ['/cards/pokemon/en/151/199-charizard/', '/cards/pokemon/en/151/199-charizard-ex/'],
        ]),
  ]
  for (const [from, to] of cases) {
    const r = await get(from)
    const loc = r.location?.replace(/^https?:\/\/[^/]+/, '')
    if (r.status !== 301 || loc !== to) fail(`${from}: expected 301 -> ${to}, got ${r.status} -> ${loc}`)
  }
  const robots = await get('/robots.txt')
  if (robots.status !== 200 || !/Disallow: \/account\//.test(robots.body) || !/Sitemap:/.test(robots.body)) fail('/robots.txt: missing disallow rules or sitemap')
  const llms = await get('/llms.txt')
  if (llms.status !== 200 || !llms.body.includes('/methodology/')) fail('/llms.txt: missing')
  for (const section of ['/releases/', '/guides/', '/deals/', '/drops/in-stock/', '/products/']) if (!llms.body.includes(section)) fail(`/llms.txt: no ${section} section`)
}

async function checkNewRoutes() {
  // Hubs and state/scout pages must be indexable pages in their own right.
  for (const path of SEEDS) {
    const info = pageInfo.get(path)
    if (!info) fail(`${path}: not a 200 page`)
    else if (!info.indexable) fail(`${path}: expected indexable`)
  }
  // Release detail pages carry Event JSON-LD; guides carry Article JSON-LD.
  const crawledPaths = [...pageInfo.keys()]
  const releases = crawledPaths.filter((p) => /^\/releases\/[a-z-]+\/[a-z0-9-]+\/$/.test(p))
  if (!releases.length) warn('no release detail pages found to check (empty calendar?)')
  for (const p of releases) if (!pageInfo.get(p).jsonld.includes('"Event"')) fail(`${p}: release page without Event JSON-LD`)
  // Indexable product pages carry Product JSON-LD with an AggregateOffer when a store has a price.
  const products = crawledPaths.filter((p) => /^\/products\/[a-z-]+\/(en|jp)\/[a-z0-9-]+\/$/.test(p))
  if (!products.length) warn('no product pages found to check (no sealed products yet?)')
  for (const p of products) {
    const info = pageInfo.get(p)
    if (info.indexable && !info.jsonld.includes('"Product"')) fail(`${p}: product page without Product JSON-LD`)
  }
  const guides = crawledPaths.filter((p) => /^\/guides\/[a-z0-9-]+\/$/.test(p))
  if (!guides.length) fail('no guide pages reachable from /guides/')
  for (const p of guides) if (!pageInfo.get(p).jsonld.includes('"Article"')) fail(`${p}: guide without Article JSON-LD`)
  // Calendar feeds: files, so no trailing slash and no redirect.
  for (const path of ['/releases/calendar.ics', '/releases/pokemon/calendar.ics', '/releases/one-piece/calendar.ics']) {
    const r = await get(path)
    if (r.status !== 200) fail(`${path}: HTTP ${r.status} (expected 200 without a redirect)`)
    else {
      if (!r.type.startsWith('text/calendar')) fail(`${path}: content-type ${r.type} (expected text/calendar)`)
      if (!r.body.startsWith('BEGIN:VCALENDAR\r\n')) fail(`${path}: not an iCalendar body with CRLF line endings`)
      if (!/noindex/i.test(r.headers.get('x-robots-tag') ?? '')) fail(`${path}: missing X-Robots-Tag: noindex`)
    }
  }
  // A file URL with a trailing slash is a duplicate; it should 301 to the file (or 404).
  const slashed = await get('/releases/calendar.ics/')
  if (slashed.status === 200) warn('/releases/calendar.ics/: served as 200; should 301 to /releases/calendar.ics (middleware)')
  // Unknown slugs are real 404s, not soft 404s.
  for (const path of ['/releases/pokemon/no-such-release-xyz/', '/guides/no-such-guide-xyz/', '/releases/not-a-game/', '/products/pokemon/en/no-such-product-xyz/', '/products/not-a-game/']) {
    const r = await get(path)
    if (r.status !== 404) fail(`${path}: expected 404, got ${r.status}`)
  }
}

const crawled = await crawl()
const listed = await checkSitemaps()
await checkNormalisation()
await checkNewRoutes()
console.log(`Crawled ${crawled} pages; ${listed} sitemap URLs; ${seenTitles.size} indexable pages.`)
if (warnings.length) console.warn(`\n${warnings.length} warning(s):\n - ${warnings.join('\n - ')}`)
if (errors.length) {
  console.error(`\n${errors.length} SEO problem(s):\n - ${errors.join('\n - ')}`)
  process.exit(1)
}
console.log('SEO checks passed')
