#!/usr/bin/env node
/**
 * Browser scan of a running site (local build or production), for what the
 * HTML-only seo-check can't see. For each page it reports:
 *  - HTTP status >= 400 and slow responses (> 3 s to load)
 *  - JavaScript errors and console errors
 *  - failed requests: images, scripts, styles, fonts, API calls (4xx/5xx or network)
 *  - not exactly one <h1>, images without alt text, http:// (mixed content) resources
 *  - horizontal scroll at phone width (375 px)
 * Exits 1 when anything is found, so it can gate CI or a release.
 *
 * Usage:
 *   BASE_URL=https://tcgtracker.com.au PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/site-scan.mjs
 *   PAGES="/,/drops/" node scripts/site-scan.mjs     (just these pages)
 *   EXTRA_DISCOVER=1 ...                              (also the first link of each section from the home page)
 */
import { chromium } from '@playwright/test'

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const DEFAULT_PAGES = [
  '/', '/market-cap/', '/market-cap/pokemon/', '/market-cap/one-piece/', '/marketplace/', '/drops/', '/drops/in-stock/',
  '/drops/stores/', '/drops/scouts/', '/drops/vic/', '/stock/', '/stock/jb-hi-fi/', '/products/', '/releases/',
  '/releases/pokemon/', '/releases/one-piece/', '/guides/', '/news/', '/deals/', '/premium/', '/about/',
  '/about/bot/', '/login/', '/search/?q=charizard', '/cards/', '/cards/pokemon/', '/cards/one-piece/',
]
const pages = process.env.PAGES ? process.env.PAGES.split(',') : DEFAULT_PAGES
const SLOW_MS = Number(process.env.SLOW_MS ?? 3000)
const problems = []
const note = (path, kind, detail) => problems.push({ path, kind, detail })

/** Follow the first link under a path prefix found on a page (to reach real set, card, product and release pages). */
async function discover(page) {
  const found = new Set()
  const prefixes = ['/cards/pokemon/en/', '/cards/one-piece/en/', '/cards/pokemon/jp/', '/market-cap/pokemon/en/', '/products/pokemon/', '/releases/pokemon/', '/releases/one-piece/', '/marketplace/pokemon/', '/news/', '/guides/', '/sellers/', '/drops/']
  for (const start of ['/', '/cards/pokemon/', '/market-cap/pokemon/', '/products/', '/releases/', '/marketplace/', '/guides/']) {
    try {
      await page.goto(BASE + start, { waitUntil: 'domcontentloaded', timeout: 30000 })
      const hrefs = await page.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute('href')))
      for (const p of prefixes) {
        const deep = hrefs.find((h) => h && h.startsWith(p) && h.length > p.length + 1 && !h.includes('?'))
        if (deep) found.add(deep)
      }
    } catch {
      /* reported when the page itself is scanned */
    }
  }
  return [...found]
}

async function scan(context, path, { phone = false } = {}) {
  const page = await context.newPage()
  const failed = []
  const errs = []
  page.on('pageerror', (e) => errs.push(`JS error: ${e.message.split('\n')[0]}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`console: ${m.text().slice(0, 200)}`)
  })
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? ''
    if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(why)) failed.push(`${r.resourceType()} ${r.url().slice(0, 160)} (${why})`)
  })
  page.on('response', (r) => {
    const t = r.request().resourceType()
    if (r.status() >= 400 && r.url() !== BASE + path && t !== 'document') failed.push(`${t} ${r.url().slice(0, 160)} (HTTP ${r.status()})`)
  })
  const started = Date.now()
  let res
  try {
    res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 45000 })
  } catch (e) {
    note(path, 'load', String(e).split('\n')[0])
    await page.close()
    return
  }
  const ms = Date.now() - started
  await page.waitForTimeout(800) // late client errors (hydration, effects)
  const status = res?.status() ?? 0
  if (status >= 400) note(path, 'status', `HTTP ${status}`)
  if (ms > SLOW_MS && !phone) note(path, 'slow', `${ms} ms to load`)
  for (const e of new Set(errs)) note(path, 'js', e)
  for (const f of new Set(failed)) note(path, 'request', f)
  if (!phone && status < 400) {
    const facts = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).map((i) => i.currentSrc || i.src).slice(0, 5),
      broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').map((i) => i.currentSrc || i.src).slice(0, 5),
      mixed: [...document.querySelectorAll('img[src^="http:"],script[src^="http:"],link[href^="http:"][rel="stylesheet"]')].map((e) => e.getAttribute('src') || e.getAttribute('href')),
    }))
    if (facts.h1 !== 1) note(path, 'h1', `${facts.h1} <h1> elements`)
    for (const s of facts.noAlt) note(path, 'alt', `image without alt: ${s.slice(0, 120)}`)
    for (const s of facts.broken) note(path, 'image', `image failed to render: ${s.slice(0, 120)}`)
    for (const s of facts.mixed) note(path, 'mixed', `http:// resource: ${s}`)
  }
  if (phone && status < 400) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflow > 1) note(path, 'mobile', `scrolls sideways by ${overflow}px at 375px wide`)
  }
  await page.close()
}

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {})
const ua = 'TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/) site-scan'
const desktop = await browser.newContext({ userAgent: ua, viewport: { width: 1280, height: 900 } })
const phone = await browser.newContext({ userAgent: ua, viewport: { width: 375, height: 800 }, isMobile: true })
const extra = process.env.PAGES ? [] : await discover(await desktop.newPage())
const all = [...new Set([...pages, ...extra])]
for (const path of all) {
  await scan(desktop, path)
  await scan(phone, path, { phone: true })
}
await browser.close()

console.log(`Scanned ${all.length} pages on ${BASE} (desktop + phone).`)
const byPath = new Map()
for (const p of problems) byPath.set(p.path, [...(byPath.get(p.path) ?? []), p])
for (const [path, list] of byPath) {
  console.log(`\n${path}`)
  for (const p of list) console.log(`  [${p.kind}] ${p.detail}`)
}
console.log(problems.length ? `\n${problems.length} problems` : '\nNo problems found')
process.exit(problems.length ? 1 : 0)
