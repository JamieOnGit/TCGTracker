/**
 * Pure helpers for the live stock pages (activity feed, in stock now, product
 * pages, store coverage): status badges, price drops, relative times, filter
 * parsing and data-derived copy. Client-safe: no data access here.
 */
import type { Availability, DropRow, OfferRow, RetailerRow, SealedProductRow } from '@/lib/data/types'
import { isInStock } from '@/lib/data/drops'
import { isGame, LANG_NAMES, type Game } from '@/lib/seo/urls'

// ------------------------------------------------------------ status badges

/** Activity feed filters, in chip order. `all` is the unfiltered feed. */
export const STATUS_KEYS = ['all', 'restock', 'new', 'preorder', 'price-drop', 'sighting'] as const
export type StatusKey = (typeof STATUS_KEYS)[number]
export type RowStatus = Exclude<StatusKey, 'all'> | 'other'

export const STATUS_CHIP_LABEL: Record<StatusKey, string> = {
  all: 'All',
  restock: 'Back in stock',
  new: 'New listing',
  preorder: 'Pre-order live',
  'price-drop': 'Price drop',
  sighting: 'Member sightings',
}

/** Badge tone → CSS class (globals.css). Never colour alone: the label always says it. */
export const STATUS_BADGE_CLASS: Record<RowStatus, string> = {
  restock: 'badge-live',
  new: 'badge-new',
  preorder: 'badge-pre',
  'price-drop': 'badge-drop',
  sighting: 'badge-lang',
  other: 'badge-lang',
}

/** Whole-percent drop from `before` to `now`, or null when it isn't a drop. 89.95 → 79 = 12. */
export function priceDropPct(before: number | null, now: number | null): number | null {
  if (before === null || now === null || !(before > now) || before <= 0) return null
  return Math.round(((before - now) / before) * 100)
}

/** Which chip a feed row belongs to, and the badge it shows. */
export function dropStatus(d: Pick<DropRow, 'eventType' | 'priceAud' | 'previousPriceAud' | 'sighting'>): { key: RowStatus; label: string } {
  if (d.sighting) return { key: 'sighting', label: d.sighting.channel === 'in_store' ? 'In store' : 'Seen online' }
  switch (d.eventType) {
    case 'IN_STOCK':
      return { key: 'restock', label: 'Back in stock' }
    case 'QUEUE_LIVE':
      return { key: 'restock', label: 'Queue live' }
    case 'NEW_LISTING':
      return { key: 'new', label: 'New listing' }
    case 'PREORDER_OPEN':
      return { key: 'preorder', label: 'Pre-order live' }
    case 'PRICE_CHANGE': {
      const pct = priceDropPct(d.previousPriceAud, d.priceAud)
      return pct !== null ? { key: 'price-drop', label: pct > 0 ? `Price drop −${pct}%` : 'Price drop' } : { key: 'other', label: 'Price change' }
    }
  }
}

export function countByStatus(rows: Parameters<typeof dropStatus>[0][]): Record<StatusKey, number> {
  const out = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0])) as Record<StatusKey, number>
  out.all = rows.length
  for (const r of rows) {
    const k = dropStatus(r).key
    if (k !== 'other') out[k]++
  }
  return out
}

// -------------------------------------------------------------- query params

const first = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw)

export function parseStatus(raw: string | string[] | undefined): StatusKey {
  const v = first(raw)
  return (STATUS_KEYS as readonly string[]).includes(v ?? '') ? (v as StatusKey) : 'all'
}
export function parseSort(raw: string | string[] | undefined): 'newest' | 'oldest' {
  return first(raw) === 'oldest' ? 'oldest' : 'newest'
}
export function parseGame(raw: string | string[] | undefined): Game | undefined {
  const v = first(raw)
  return v && isGame(v) ? v : undefined
}
/** Retailer slugs are lowercase, hyphenated. */
export function parseSlug(raw: string | string[] | undefined): string | undefined {
  const v = first(raw)
  return v && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? v : undefined
}

/**
 * A filtered /drops/ link. Defaults are left out so "All · Newest" is the
 * clean canonical /drops/; every other combination is a noindex,follow facet.
 */
export function feedHref(base: string, q: { status?: StatusKey; game?: Game; sort?: 'newest' | 'oldest'; page?: number; retailer?: string }): string {
  const p = new URLSearchParams()
  if (q.status && q.status !== 'all') p.set('status', q.status)
  if (q.game) p.set('game', q.game)
  if (q.retailer) p.set('retailer', q.retailer)
  if (q.sort === 'oldest') p.set('sort', 'oldest')
  if (q.page && q.page > 1) p.set('page', String(q.page))
  const s = p.toString()
  return s ? `${base}?${s}` : base
}

// ------------------------------------------------------------------ times

const shortDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })
const fullTime = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne', timeZoneName: 'short' })

/** "just now", "12m ago", "3h ago", "2d ago", then a date ("26 Sep") after a week. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return shortDate.format(new Date(iso))
}

/** Absolute Melbourne time for title attributes: "Sat 26 Sep 2026, 9:02 pm AEST". */
export const absoluteTime = (iso: string) => fullTime.format(new Date(iso))

// ----------------------------------------------------------- availability

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  in_stock_both: 'In stock',
  in_stock_online: 'In stock online',
  in_stock_cnc: 'Click & collect',
  preorder: 'Pre-order',
  out_of_stock: 'Sold out',
  unknown: 'Unknown',
}
export function availabilityBadgeClass(a: Availability): string {
  return isInStock(a) ? 'badge-live' : a === 'preorder' ? 'badge-pre' : 'badge-lang'
}

/** schema.org availability for an offer. */
export function schemaAvailability(a: Availability): string {
  if (isInStock(a)) return 'https://schema.org/InStock'
  if (a === 'preorder') return 'https://schema.org/PreOrder'
  return 'https://schema.org/OutOfStock'
}

/** "At RRP", "−12% vs RRP", "+5% vs RRP"; null when either price is unknown. */
export function rrpDeltaLabel(price: number | null, rrp: number | null): string | null {
  if (price === null || rrp === null || rrp <= 0) return null
  const pct = Math.round(((price - rrp) / rrp) * 100)
  if (pct === 0) return 'At RRP'
  return pct < 0 ? `−${-pct}% vs RRP` : `+${pct}% vs RRP`
}

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (v: number) => `A${aud.format(v)}`

export const PRODUCT_TYPE_LABEL: Record<string, string> = {
  'booster-box': 'Booster box',
  etb: 'Elite Trainer Box',
  'booster-bundle': 'Booster bundle',
  tin: 'Tin',
  blister: 'Blister',
  collection: 'Collection box',
  'booster-pack': 'Booster pack',
  'starter-deck': 'Starter deck',
}
export const productTypeLabel = (t: string) => PRODUCT_TYPE_LABEL[t] ?? t.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Product H1: "Prismatic Evolutions Elite Trainer Box (English)". */
export const productHeading = (p: Pick<SealedProductRow, 'name' | 'lang'>) => `${p.name} (${LANG_NAMES[p.lang]})`

const stores = (n: number) => `${n} ${n === 1 ? 'store' : 'stores'}`

/** Offers on pre-order, which the in-stock count leaves out. */
export const preorderOffers = (offers: OfferRow[]) => offers.filter((o) => o.availability === 'preorder')

/** Lowest price among in-stock offers, else among pre-orders. */
export function lowestLivePrice(p: Pick<SealedProductRow, 'offers'>): number | null {
  const prices = (xs: OfferRow[]) => xs.map((o) => o.priceAud).filter((x): x is number => x !== null)
  const inStock = prices(p.offers.filter((o) => isInStock(o.availability)))
  if (inStock.length) return Math.min(...inStock)
  const pre = prices(preorderOffers(p.offers))
  return pre.length ? Math.min(...pre) : null
}

/** "In stock at 3 stores from A$79.00 (RRP A$89.95)" — only facts we have. */
export function productSummary(p: Pick<SealedProductRow, 'offers' | 'rrpAud'>): string {
  const inStock = p.offers.filter((o) => isInStock(o.availability)).length
  const pre = preorderOffers(p.offers).length
  const low = lowestLivePrice(p)
  const rrp = p.rrpAud !== null ? ` (RRP ${fmt(p.rrpAud)})` : ''
  const from = low !== null ? ` from ${fmt(low)}` : ''
  if (inStock > 0) return `In stock at ${stores(inStock)}${from}${rrp}`
  if (pre > 0) return `On pre-order at ${stores(pre)}${from}${rrp}`
  if (p.offers.length > 0) return `Out of stock at the ${stores(p.offers.length)} we watch${rrp}`
  return `Not listed at any store we watch yet${rrp}`
}

/** "In stock at 3 stores" for product cards (pre-orders counted separately). */
export function stockLine(p: Pick<SealedProductRow, 'offers'>): string {
  const inStock = p.offers.filter((o) => isInStock(o.availability)).length
  const pre = preorderOffers(p.offers).length
  const parts = [inStock ? `In stock at ${stores(inStock)}` : null, pre ? `Pre-order at ${stores(pre)}` : null].filter(Boolean)
  return parts.join(' · ') || 'Out of stock'
}

/** FAQ answered from the data only; a question is left out when we don't know the answer. */
export function productFaqs(p: Pick<SealedProductRow, 'name' | 'lang' | 'offers' | 'rrpAud'>): { q: string; a: string }[] {
  const name = productHeading(p)
  const out: { q: string; a: string }[] = []
  const live = p.offers.filter((o) => isInStock(o.availability) || o.availability === 'preorder')
  if (p.offers.length > 0) {
    const listed = p.offers.map((o) => o.retailerName)
    const where = live.length
      ? `Right now it is ${live.some((o) => isInStock(o.availability)) ? 'in stock' : 'on pre-order'} at ${listFmt(live.map((o) => `${o.retailerName}${o.priceAud !== null ? ` (${fmt(o.priceAud)})` : ''}`))}.`
      : 'None of them has it in stock right now; tap Notify me to hear the moment it is back.'
    out.push({ q: `Where can I buy ${name} in Australia?`, a: `We watch ${stores(listed.length)} that list it: ${listFmt(listed)}. ${where}` })
  }
  if (p.rrpAud !== null) {
    const low = lowestLivePrice(p)
    const vs = low !== null ? ` The lowest current price we see is ${fmt(low)} (${rrpDeltaLabel(low, p.rrpAud)?.replace('vs RRP', 'against RRP') ?? 'at RRP'}).` : ''
    out.push({ q: `What is the RRP of ${name} in Australia?`, a: `The Australian recommended retail price is ${fmt(p.rrpAud)}.${vs} Stores set their own prices.` })
  }
  return out
}

const listFmtter = new Intl.ListFormat('en-AU', { style: 'long', type: 'conjunction' })
const listFmt = (xs: string[]) => listFmtter.format(xs)

// ---------------------------------------------------------------- stores

/** Two-letter monogram for a store badge (no logos): "JB Hi-Fi" → "JB", "BIG W" → "BW", "Kmart" → "K". */
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const w0 = words[0] ?? '?'
  if (w0.length <= 2 && w0 === w0.toUpperCase()) return w0
  if (words.length === 1) return w0.charAt(0).toUpperCase()
  return (w0.charAt(0) + (words[1] ?? '').charAt(0)).toUpperCase()
}

export type CoverageStatus = 'live' | 'setup' | 'sightings' | 'blocked'

/** What a reader needs to know about how we cover a store. */
export function storeCoverage(r: Pick<RetailerRow, 'monitored' | 'enabled' | 'blockedReason' | 'lastCheckedAt'>, now: Date = new Date()): { status: CoverageStatus; label: string } {
  if (r.blockedReason) return { status: 'blocked', label: 'Not reachable (blocked by the store) · member sightings' }
  if (!r.monitored) return { status: 'sightings', label: 'Member sightings only' }
  if (!r.enabled) return { status: 'setup', label: 'Monitor being set up · member sightings' }
  return { status: 'live', label: r.lastCheckedAt ? `Live · checked ${relativeTime(r.lastCheckedAt, now)}` : 'Live' }
}

/** 120 → "every 2 minutes", 45 → "every 45 seconds", 3600 → "every hour". */
export function intervalLabel(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null
  if (seconds < 60) return `every ${seconds} seconds`
  const m = Math.round(seconds / 60)
  if (m < 60) return m === 1 ? 'every minute' : `every ${m} minutes`
  const h = Math.round(m / 60)
  return h === 1 ? 'every hour' : `every ${h} hours`
}

export const STORE_KIND_LABEL: Record<NonNullable<RetailerRow['kind']>, string> = {
  specialist: 'Specialist TCG store',
  'big-box': 'Big-box retailer',
  toy: 'Toy store',
  department: 'Department store',
  marketplace: 'Marketplace',
  official: 'Official store',
  other: 'Store',
}

/** Product page <title>: the longest pattern that fits in 60 characters. */
export function productTitle(p: Pick<SealedProductRow, 'name' | 'lang'>): string {
  const n = p.lang === 'jp' ? `${p.name} (Japanese)` : p.name
  return [`${n} Stock & Price in Australia`, `${n} Stock in Australia`, `${n} Australia`].find((t) => t.length <= 60) ?? n
}

/** Product meta description from the data (≤155 characters once clamped). */
export function productDescription(p: Pick<SealedProductRow, 'name' | 'lang' | 'offers' | 'rrpAud'>): string {
  return `${productSummary(p)}. ${productHeading(p)}: compare Australian stores, see restock history and get alerted when it is back in stock.`
}
