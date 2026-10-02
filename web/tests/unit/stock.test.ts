import { describe, expect, it } from 'vitest'
import { adapterFor, buildStoreConfig, commaList, configList, newStoreSchema, storeSettingsSchema, storeSlug } from '@/lib/admin/stores'
import { sortOffers } from '@/lib/data/drops'
import type { DropRow, OfferRow, SealedProductRow } from '@/lib/data/types'
import { rulesFromSettings } from '@/lib/domain/rules'
import {
  countByStatus,
  dropStatus,
  feedHref,
  intervalLabel,
  lowestLivePrice,
  monogram,
  parseGame,
  parseSlug,
  parseSort,
  parseStatus,
  priceDropPct,
  productDescription,
  productFaqs,
  productHeading,
  productSummary,
  productTitle,
  relativeTime,
  rrpDeltaLabel,
  schemaAvailability,
  stockLine,
  storeCoverage,
} from '@/lib/domain/stock'
import { sealedProductLd } from '@/lib/seo/jsonld'
import { inStockPath, productPath, productsPath, storesPath } from '@/lib/seo/urls'

const ev = (over: Partial<DropRow>): Pick<DropRow, 'eventType' | 'priceAud' | 'previousPriceAud' | 'sighting'> => ({ eventType: 'IN_STOCK', priceAud: 89.95, previousPriceAud: null, sighting: null, ...over })
const offer = (over: Partial<OfferRow>): OfferRow => ({ retailerSlug: 'a', retailerName: 'A', title: 't', url: 'https://example.com/a', availability: 'in_stock_online', priceAud: 90, lastChangeAt: null, imageUrl: null, ...over })
const product = (over: Partial<SealedProductRow> = {}): SealedProductRow => ({
  id: 'sp1', game: 'pokemon', lang: 'en', slug: 'demo-etb', name: 'Demo Elite Trainer Box', type: 'etb', rrpAud: 89.95, releaseDate: null, set: null,
  offers: [], inStockCount: 0, lowestInStockAud: null, updatedAt: null, ...over,
})

describe('status badges', () => {
  it('maps events to chips and labels', () => {
    expect(dropStatus(ev({}))).toEqual({ key: 'restock', label: 'Back in stock' })
    expect(dropStatus(ev({ eventType: 'NEW_LISTING' })).label).toBe('New listing')
    expect(dropStatus(ev({ eventType: 'PREORDER_OPEN' })).label).toBe('Pre-order live')
    expect(dropStatus(ev({ eventType: 'QUEUE_LIVE' })).key).toBe('restock')
  })
  it('calls a price change a drop only when the price went down', () => {
    expect(priceDropPct(89.95, 79)).toBe(12)
    expect(priceDropPct(79, 89.95)).toBeNull()
    expect(priceDropPct(null, 79)).toBeNull()
    expect(priceDropPct(80, 80)).toBeNull()
    expect(dropStatus(ev({ eventType: 'PRICE_CHANGE', previousPriceAud: 89.95, priceAud: 79 }))).toEqual({ key: 'price-drop', label: 'Price drop −12%' })
    expect(dropStatus(ev({ eventType: 'PRICE_CHANGE', previousPriceAud: 79, priceAud: 89.95 }))).toEqual({ key: 'other', label: 'Price change' })
    expect(dropStatus(ev({ eventType: 'PRICE_CHANGE', previousPriceAud: 89.95, priceAud: 89.9 })).label).toBe('Price drop')
  })
  it('labels member sightings by channel', () => {
    const s = { id: 1, channel: 'in_store' as const, state: null, suburb: null, storeName: null, quantity: null, purchaseLimit: null, photoUrl: null, note: null, confirmations: 2, goneAt: null, reporter: null }
    expect(dropStatus(ev({ sighting: s }))).toEqual({ key: 'sighting', label: 'In store' })
    expect(dropStatus(ev({ sighting: { ...s, channel: 'online' } })).label).toBe('Seen online')
  })
  it('counts rows per chip', () => {
    const c = countByStatus([ev({}), ev({ eventType: 'NEW_LISTING' }), ev({ eventType: 'PRICE_CHANGE', previousPriceAud: 10, priceAud: 9 }), ev({ eventType: 'PRICE_CHANGE', previousPriceAud: 9, priceAud: 10 })])
    expect(c).toEqual({ all: 4, restock: 1, new: 1, preorder: 0, 'price-drop': 1, sighting: 0 })
  })
})

describe('feed query params', () => {
  it('parses and ignores junk', () => {
    expect(parseStatus('price-drop')).toBe('price-drop')
    expect(parseStatus('nope')).toBe('all')
    expect(parseStatus(undefined)).toBe('all')
    expect(parseSort('oldest')).toBe('oldest')
    expect(parseSort('x')).toBe('recommended')
    expect(parseGame('one-piece')).toBe('one-piece')
    expect(parseGame('magic')).toBeUndefined()
    expect(parseSlug('jb-hi-fi')).toBe('jb-hi-fi')
    expect(parseSlug('../x')).toBeUndefined()
  })
  it('builds crawlable links with defaults left out', () => {
    expect(feedHref('/drops/', { status: 'all', sort: 'recommended' })).toBe('/drops/')
    expect(feedHref('/drops/', { status: 'price-drop', game: 'pokemon', sort: 'oldest', page: 2 })).toBe('/drops/?status=price-drop&game=pokemon&sort=oldest&page=2')
    expect(feedHref('/drops/in-stock/', { retailer: 'kmart', page: 1 })).toBe('/drops/in-stock/?retailer=kmart')
  })
})

describe('relative time', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  it('is short and honest', () => {
    expect(relativeTime('2026-10-01T11:59:40Z', now)).toBe('just now')
    expect(relativeTime('2026-10-01T11:48:00Z', now)).toBe('12m ago')
    expect(relativeTime('2026-10-01T09:00:00Z', now)).toBe('3h ago')
    expect(relativeTime('2026-09-29T12:00:00Z', now)).toBe('2d ago')
    expect(relativeTime('2026-09-01T00:00:00Z', now)).toBe('1 Sept')
  })
})

describe('offers and product copy', () => {
  it('sorts in stock first, then pre-order, then cheapest', () => {
    const sorted = sortOffers([offer({ retailerName: 'Z', availability: 'out_of_stock', priceAud: 1 }), offer({ retailerName: 'P', availability: 'preorder', priceAud: 50 }), offer({ retailerName: 'B', priceAud: 95 }), offer({ retailerName: 'A', priceAud: 80 })])
    expect(sorted.map((o) => o.retailerName)).toEqual(['A', 'B', 'P', 'Z'])
  })
  it('summarises stock from the data only', () => {
    expect(productSummary(product({ offers: [offer({ priceAud: 79 }), offer({ priceAud: 95 }), offer({ availability: 'out_of_stock' })] }))).toBe('In stock at 2 stores from A$79.00 (RRP A$89.95)')
    expect(productSummary(product({ offers: [offer({ availability: 'preorder', priceAud: 99 })], rrpAud: null }))).toBe('On pre-order at 1 store from A$99.00')
    expect(productSummary(product({ offers: [offer({ availability: 'out_of_stock' })] }))).toBe('Out of stock at the 1 store we watch (RRP A$89.95)')
    expect(productSummary(product())).toBe('Not listed at any store we watch yet (RRP A$89.95)')
    expect(stockLine(product({ offers: [offer({}), offer({ availability: 'preorder' })] }))).toBe('In stock at 1 store · Pre-order at 1 store')
    expect(lowestLivePrice(product({ offers: [offer({ availability: 'out_of_stock', priceAud: 1 }), offer({ availability: 'preorder', priceAud: 99 })] }))).toBe(99)
  })
  it('labels price against RRP', () => {
    expect(rrpDeltaLabel(79, 89.95)).toBe('−12% vs RRP')
    expect(rrpDeltaLabel(89.95, 89.95)).toBe('At RRP')
    expect(rrpDeltaLabel(99, 89.95)).toBe('+10% vs RRP')
    expect(rrpDeltaLabel(null, 89.95)).toBeNull()
  })
  it('answers FAQs only when the data exists', () => {
    expect(productFaqs(product({ rrpAud: null }))).toEqual([])
    const faqs = productFaqs(product({ offers: [offer({ retailerName: 'JB Hi-Fi', priceAud: 79 }), offer({ retailerName: 'BIG W', availability: 'out_of_stock' })] }))
    expect(faqs.map((f) => f.q)).toEqual(['Where can I buy Demo Elite Trainer Box (English) in Australia?', 'What is the RRP of Demo Elite Trainer Box (English) in Australia?'])
    expect(faqs[0]!.a).toContain('JB Hi-Fi and BIG W')
    expect(faqs[0]!.a).toContain('in stock at JB Hi-Fi (A$79.00)')
    expect(faqs[1]!.a).toContain('A$89.95')
  })
  it('keeps titles within 60 characters and names the language', () => {
    expect(productHeading(product({ lang: 'jp' }))).toBe('Demo Elite Trainer Box (Japanese)')
    expect(productTitle(product())).toBe('Demo Elite Trainer Box Stock & Price in Australia')
    const long = product({ name: 'Scarlet & Violet Prismatic Evolutions Super-Premium Collection' })
    expect(productTitle(long).length).toBeLessThanOrEqual(62)
    expect(productDescription(product()).length).toBeGreaterThan(70)
  })
})

describe('stores', () => {
  it('makes logo-free monograms', () => {
    expect(monogram('JB Hi-Fi')).toBe('JB')
    expect(monogram('EB Games')).toBe('EB')
    expect(monogram('BIG W')).toBe('BW')
    expect(monogram('Kmart')).toBe('K')
    expect(monogram('Premium Bandai AU')).toBe('PB')
  })
  it('describes coverage honestly', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    const base = { monitored: true, enabled: true, blockedReason: null, lastCheckedAt: '2026-10-01T11:57:00Z' }
    expect(storeCoverage(base, now)).toEqual({ status: 'live', label: 'Live · checked 3m ago' })
    expect(storeCoverage({ ...base, blockedReason: 'challenge page' }, now).status).toBe('blocked')
    expect(storeCoverage({ ...base, monitored: false }, now).label).toBe('Member sightings only')
    expect(storeCoverage({ ...base, enabled: false }, now).status).toBe('setup')
    expect(intervalLabel(120)).toBe('every 2 minutes')
    expect(intervalLabel(45)).toBe('every 45 seconds')
    expect(intervalLabel(3600)).toBe('every hour')
    expect(intervalLabel(null)).toBeNull()
  })
})

describe('URLs and JSON-LD', () => {
  it('builds product and stock URLs', () => {
    expect(productPath({ game: 'pokemon', lang: 'en', slug: 'demo-expansion-elite-trainer-box' })).toBe('/products/pokemon/en/demo-expansion-elite-trainer-box/')
    expect(productsPath()).toBe('/products/')
    expect(productsPath('one-piece')).toBe('/products/one-piece/')
    expect(inStockPath()).toBe('/drops/in-stock/')
    expect(storesPath()).toBe('/drops/stores/')
  })
  it('maps availability to schema.org', () => {
    expect(schemaAvailability('in_stock_cnc')).toBe('https://schema.org/InStock')
    expect(schemaAvailability('preorder')).toBe('https://schema.org/PreOrder')
    expect(schemaAvailability('unknown')).toBe('https://schema.org/OutOfStock')
  })
  it('builds Product with an AggregateOffer over priced offers', () => {
    const ld = sealedProductLd({
      name: 'Demo ETB (English)', path: '/products/pokemon/en/demo-etb/', brand: 'Pokémon TCG', category: 'Elite Trainer Box',
      offers: [
        { seller: 'A', url: 'https://a.example', priceAud: 79, availability: 'https://schema.org/InStock' },
        { seller: 'B', url: 'https://b.example', priceAud: 95.5, availability: 'https://schema.org/OutOfStock' },
        { seller: 'C', url: 'https://c.example', priceAud: null, availability: 'https://schema.org/PreOrder' },
      ],
    }) as { '@type': string; offers: Record<string, unknown> & { offers: unknown[] } }
    expect(ld['@type']).toBe('Product')
    expect(ld.offers).toMatchObject({ '@type': 'AggregateOffer', priceCurrency: 'AUD', lowPrice: '79.00', highPrice: '95.50', offerCount: 2, availability: 'https://schema.org/InStock' })
    expect(ld.offers.offers).toHaveLength(2)
    const none = sealedProductLd({ name: 'X', path: '/products/pokemon/en/x/', brand: 'b', category: 'c', offers: [] })
    expect(none).not.toHaveProperty('offers')
  })
})

describe('admin store forms', () => {
  it('splits comma lists', () => {
    expect(commaList(' pokemon, one-piece ,,pokemon ')).toEqual(['pokemon', 'one-piece'])
    expect(commaList(null)).toEqual([])
  })
  it('builds platform config and keeps unmanaged keys', () => {
    const f = { collections: ['pokemon', '123'], keywords: [], exclude: ['sleeves'], games: ['pokemon' as const] }
    expect(buildStoreConfig({ ...f, platform: 'shopify' })).toEqual({ collections: ['pokemon', '123'], exclude: ['sleeves'], games: ['pokemon'] })
    expect(buildStoreConfig({ ...f, platform: 'woocommerce' }, { page_size: 50, collections: ['old'] })).toEqual({ page_size: 50, categories: ['pokemon', 123], exclude: ['sleeves'], games: ['pokemon'] })
    expect(configList({ categories: ['a', 12] }, 'categories')).toBe('a, 12')
  })
  it('picks adapters and slugs', () => {
    expect(adapterFor('shopify')).toBe('shopify')
    expect(adapterFor('custom', 'jb_hi_fi')).toBe('jb_hi_fi')
    expect(adapterFor('custom', 'shopify')).toBe('none')
    expect(adapterFor('none', 'kmart')).toBe('none')
    expect(storeSlug('Good Games Melbourne')).toBe('good-games-melbourne')
    expect(storeSlug('Stores')).toBeNull()
    expect(storeSlug('VIC')).toBeNull()
  })
  it('validates a new store', () => {
    const ok = newStoreSchema.safeParse({ name: 'Card Shop', baseUrl: 'https://cards.example.com.au/', enabled: true, platform: 'shopify', collections: ['pokemon'], keywords: [], exclude: [], games: ['pokemon'], kind: 'specialist', state: 'VIC' })
    expect(ok.success && ok.data.baseUrl).toBe('https://cards.example.com.au')
    expect(newStoreSchema.safeParse({ name: 'Card Shop', baseUrl: 'http://cards.example.com.au', enabled: false, platform: 'shopify', collections: [], keywords: [], exclude: [], games: [], kind: '', state: '' }).success).toBe(false)
    expect(storeSettingsSchema.safeParse({ platform: 'shopify', collections: ['bad handle!'], keywords: [], exclude: [], games: [], kind: '', state: '', blockedReason: '' }).success).toBe(false)
  })
})

describe('rules', () => {
  it('shows retailer images only when switched on', () => {
    expect(rulesFromSettings([]).stockShowRetailerImages).toBe(false)
    expect(rulesFromSettings([{ key: 'stock.show_retailer_images', value: true }]).stockShowRetailerImages).toBe(true)
    expect(rulesFromSettings([{ key: 'stock.show_retailer_images', value: 'yes' }]).stockShowRetailerImages).toBe(false)
  })
})
