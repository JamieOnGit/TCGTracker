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
 *
 * Usage: BASE_URL=http://localhost:3000 node scripts/seo-check.mjs
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 400)
const errors = []
const fail = (msg) => errors.push(msg)

async function get(path) {
  const res = await fetch(BASE + path, { redirect: 'manual' })
  const body = res.headers.get('content-type')?.includes('text') || res.headers.get('content-type')?.includes('xml') ? await res.text() : ''
  return { status: res.status, location: res.headers.get('location'), body }
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
  const { status, location, body } = await get(path)
  if (status >= 300 && status < 400) return { redirect: location, status }
  if (status !== 200) return { status }
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
    if (p.title) {
      if (seenTitles.has(p.title)) fail(`${path}: duplicate title with ${seenTitles.get(p.title)}: "${p.title}"`)
      else seenTitles.set(p.title, path)
    }
    if (p.description) {
      if (seenDescriptions.has(p.description)) fail(`${path}: duplicate description with ${seenDescriptions.get(p.description)}`)
      else seenDescriptions.set(p.description, path)
    }
  }
  pageInfo.set(path, { indexable, canonical: p.canonical })
  return { status, links: p.links }
}

async function crawl() {
  const queue = ['/']
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
    ['/marketplace/listing/100001/', '/marketplace/listing/100001-charizard-ex-199-en-psa-10/'],
    ['/cards/pokemon/en/151/199-charizard/', '/cards/pokemon/en/151/199-charizard-ex/'],
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
}

const crawled = await crawl()
const listed = await checkSitemaps()
await checkNormalisation()
console.log(`Crawled ${crawled} pages; ${listed} sitemap URLs; ${seenTitles.size} indexable pages.`)
if (errors.length) {
  console.error(`\n${errors.length} SEO problem(s):\n - ${errors.join('\n - ')}`)
  process.exit(1)
}
console.log('SEO checks passed')
