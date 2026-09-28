import { describe, expect, it } from 'vitest'
import { breadcrumbs, cardProduct, listingProduct } from '@/lib/seo/jsonld'
import { buildMetadata, isFiltered, titles } from '@/lib/seo/metadata'
import { cardMarketplacePath, cardPath, listingPath, marketCapPath, parseListingSegment, slugify } from '@/lib/seo/urls'

process.env.NEXT_PUBLIC_SITE_URL = 'https://example.com.au'
process.env.NEXT_PUBLIC_SITE_NAME = 'Brand'

describe('URLs (brief 7.1)', () => {
  it('builds the canonical scheme', () => {
    const card = { id: 'x', game: 'one-piece' as const, lang: 'jp' as const, setSlug: 'op-05', slug: 'op05-119-monkey-d-luffy-manga' }
    expect(cardPath(card)).toBe('/cards/one-piece/jp/op-05/op05-119-monkey-d-luffy-manga/')
    expect(cardMarketplacePath(card)).toBe('/marketplace/one-piece/jp/op-05/op05-119-monkey-d-luffy-manga/')
    expect(marketCapPath('pokemon', 'en', '151')).toBe('/market-cap/pokemon/en/151/')
    expect(marketCapPath()).toBe('/market-cap/')
  })
  it('slugifies like the database', () => {
    expect(slugify('Monkey.D.Luffy (Manga)')).toBe('monkey-d-luffy-manga')
    expect(slugify('Pokémon Card 151')).toBe('pokemon-card-151')
    expect(slugify("Charizard ex 199/165 — PSA 10!")).toBe('charizard-ex-199-165-psa-10')
  })
  it('listing URLs are id + cosmetic slug', () => {
    expect(listingPath(100001, 'Charizard ex 199 EN PSA 10')).toBe('/marketplace/listing/100001-charizard-ex-199-en-psa-10/')
    expect(parseListingSegment('100001-whatever')).toEqual({ id: 100001, slug: 'whatever' })
    expect(parseListingSegment('100001')).toEqual({ id: 100001, slug: '' })
    expect(parseListingSegment('abc')).toBeNull()
  })
})

describe('metadata (brief 7.2)', () => {
  it('is self-canonical and indexable on a clean page', () => {
    const m = buildMetadata({ path: '/market-cap/pokemon/', title: 'T', description: 'D' })
    expect(m.alternates?.canonical).toBe('https://example.com.au/market-cap/pokemon/')
    expect(m.robots).toEqual({ index: true, follow: true })
    expect(m.title).toEqual({ absolute: 'T | Brand' })
  })
  it('filtered views canonicalise to the clean page and are noindex,follow', () => {
    const m = buildMetadata({ path: '/market-cap/pokemon/en/', title: 'T', description: 'D', searchParams: { grade: 'psa-9' } })
    expect(m.alternates?.canonical).toBe('https://example.com.au/market-cap/pokemon/en/')
    expect(m.robots).toEqual({ index: false, follow: true })
  })
  it('pagination is self-canonical with a unique title', () => {
    const m = buildMetadata({ path: '/', title: 'Rankings', description: 'D', searchParams: { page: '2' } })
    expect(m.alternates?.canonical).toBe('https://example.com.au/?page=2')
    expect(m.title).toEqual({ absolute: 'Rankings – Page 2 | Brand' })
    expect(m.robots).toEqual({ index: true, follow: true })
    expect(isFiltered({ page: '2' })).toBe(false)
  })
  it('card title follows the brief pattern', () => {
    expect(titles.card({ name: 'Charizard ex', number: '199', printedTotal: '165', setName: '151', lang: 'en' })).toBe(
      'Charizard ex 199/165 (151) PSA 10 Price in AUD, Population & Market Cap',
    )
  })
})

describe('JSON-LD', () => {
  it('breadcrumbs use absolute URLs and positions', () => {
    const b = breadcrumbs([{ name: 'Home', path: '/' }, { name: 'Cards', path: '/cards/' }]) as { itemListElement: { position: number; item: string }[] }
    expect(b.itemListElement[1]).toMatchObject({ position: 2, item: 'https://example.com.au/cards/' })
  })
  it('card Product has an AggregateOffer in AUD only when listings exist', () => {
    const withOffers = cardProduct({ name: 'C', path: '/c/', cardId: 'x', sku: 's', brand: 'b', offers: { lowAud: 10, highAud: 20, count: 2 } })
    expect(withOffers.offers).toMatchObject({ '@type': 'AggregateOffer', priceCurrency: 'AUD', lowPrice: '10.00', offerCount: 2 })
    expect(cardProduct({ name: 'C', path: '/c/', cardId: 'x', sku: 's', brand: 'b', offers: null }).offers).toBeUndefined()
  })
  it('listing Offer marks sold items SoldOut', () => {
    const p = listingProduct({ name: 'L', path: '/l/', priceAud: 5, sold: true, sellerName: 's', condition: 'used' }) as { offers: { availability: string } }
    expect(p.offers.availability).toBe('https://schema.org/SoldOut')
  })
})
