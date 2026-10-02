import { describe, expect, it } from 'vitest'
import { compareStock, listingLang, normalise, parseLang, parseProductSort, parseQuery, parseSearch, parseTier, productTier, searchRows, searchText, sortProducts } from '@/lib/domain/search'
import { dropRank, feedHref, parseSort, sortDrops } from '@/lib/domain/stock'

const match = (q: string, text: string) => parseQuery(q)!(searchText(text))

describe('wildcard search', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalise('Pokémon TCG: Scarlet & Violet—151')).toBe('pokemon tcg scarlet and violet 151')
    expect(match('POKEMON 151', 'Pokémon TCG: Scarlet & Violet 151 Booster Bundle')).toBe(true)
  })
  it('needs every word, in any order', () => {
    expect(match('etb prismatic', 'Prismatic Evolutions Elite Trainer Box')).toBe(true)
    expect(match('prismatic booster box', 'Prismatic Evolutions Elite Trainer Box')).toBe(false)
  })
  it('supports * and ? wildcards', () => {
    expect(match('char*ex', 'Charizard ex Super Premium Collection')).toBe(true)
    expect(match('*151*', 'Scarlet & Violet 151 Booster Bundle')).toBe(true)
    expect(match('op?09', 'One Piece OP-09 Emperors in the New World Booster Box')).toBe(true)
    expect(match('sv?a', 'Pokémon Card 151 sv2a Booster Box (Japanese)')).toBe(true)
    expect(match('char*zz', 'Charizard ex')).toBe(false)
  })
  it('keeps quoted words together', () => {
    expect(match('"booster box"', 'Surging Sparks Booster Box')).toBe(true)
    expect(match('"box booster"', 'Surging Sparks Booster Box')).toBe(false)
  })
  it('knows the short names', () => {
    expect(match('etb', 'Surging Sparks Elite Trainer Box')).toBe(true)
    expect(match('upc', 'Charizard Ultra Premium Collection')).toBe(true)
    expect(match('jp', 'Terastal Festival Booster Box (Japanese)')).toBe(true)
  })
  it('treats empty and wildcard-only queries as no search, and never throws on regex characters', () => {
    expect(parseQuery('')).toBeNull()
    expect(parseQuery('  * ? ')).toBeNull()
    expect(match('(151) [box] +', '151 box')).toBe(true)
    expect(searchRows(['a', 'b'], undefined, (x) => x)).toEqual(['a', 'b'])
  })
  it('caps and trims ?q=', () => {
    expect(parseSearch('  ')).toBeUndefined()
    expect(parseSearch('x'.repeat(200))).toHaveLength(80)
  })
})

describe('language', () => {
  it('uses the product page when we have one, else the title', () => {
    expect(listingLang('Booster Box', { lang: 'jp' })).toBe('jp')
    expect(listingLang('Terastal Festival ex Booster Box Japanese')).toBe('jp')
    expect(listingLang('Pokémon TCG [JP] Shiny Treasure ex')).toBe('jp')
    expect(listingLang('Surging Sparks Booster Box')).toBe('en')
    expect(parseLang('jp')).toBe('jp')
    expect(parseLang('fr')).toBeUndefined()
  })
})

describe('product priority', () => {
  it('ranks boxes, then ETBs and premium collections, then packs, then tins and decks', () => {
    expect(productTier('Surging Sparks Booster Box')).toBe(0)
    expect(productTier('OP-09 Booster Display')).toBe(0)
    expect(productTier('Prismatic Evolutions Elite Trainer Box')).toBe(1)
    expect(productTier('Charizard ex Ultra Premium Collection')).toBe(1)
    expect(productTier('One Piece Premium Booster -The Best-')).toBe(1)
    expect(productTier('One Piece Illustration Box Vol. 2')).toBe(1)
    expect(productTier('Surging Sparks Booster Bundle')).toBe(2)
    expect(productTier('One Piece Double Pack Set Vol. 5')).toBe(2)
    expect(productTier('Stellar Crown 3 Pack Blister')).toBe(2)
    expect(productTier('Paldean Fates Tin')).toBe(3)
    expect(productTier('ST-21 Starter Deck')).toBe(3)
    expect(productTier('Pikachu Plush')).toBe(4)
    expect(productTier('Thing', 'etb')).toBe(1)
    expect(parseTier('booster-boxes')).toBe(0)
    expect(parseTier('nope')).toBeUndefined()
  })

  it('sorts listings in stock first, then by type, then most recent change', () => {
    const rows = [
      { title: 'A Tin', availability: 'in_stock_online' as const, lastChangeAt: '2026-10-02T00:00:00Z' },
      { title: 'B Booster Box', availability: 'out_of_stock' as const, lastChangeAt: '2026-10-02T00:00:00Z' },
      { title: 'C Elite Trainer Box', availability: 'in_stock_both' as const, lastChangeAt: '2026-09-01T00:00:00Z' },
      { title: 'D Booster Box', availability: 'preorder' as const, lastChangeAt: null },
      { title: 'E Booster Box', availability: 'in_stock_cnc' as const, lastChangeAt: '2026-09-01T00:00:00Z' },
    ]
    expect([...rows].sort(compareStock).map((r) => r.title[0])).toEqual(['E', 'C', 'A', 'D', 'B'])
  })

  it('sorts products: in stock before pre-order only, then type, then most stores', () => {
    const p = (name: string, inStockCount: number, price: number | null = null) => ({ name, type: 'other', inStockCount, lowestInStockAud: price, offers: [], updatedAt: null })
    const rows = [p('Tin', 3, 30), p('Booster Box', 0), p('Elite Trainer Box', 1, 90), p('Booster Box 2', 2, 200)]
    expect(sortProducts(rows, 'recommended').map((r) => r.name)).toEqual(['Booster Box 2', 'Elite Trainer Box', 'Tin', 'Booster Box'])
    expect(sortProducts(rows, 'price-asc').map((r) => r.name)[0]).toBe('Tin')
    expect(parseProductSort('price-desc')).toBe('price-desc')
    expect(parseProductSort('x')).toBe('recommended')
  })
})

describe('feed order and links', () => {
  const d = (title: string, eventType: 'IN_STOCK' | 'PREORDER_OPEN' | 'NEW_LISTING' | 'PRICE_CHANGE', occurredAt: string) => ({ title, eventType, occurredAt, sighting: null })
  it('puts restocks first, then boxes, then newest; Newest and Oldest stay chronological', () => {
    const rows = [d('Tin', 'IN_STOCK', '2026-10-02T03:00:00Z'), d('Booster Box', 'PREORDER_OPEN', '2026-10-02T04:00:00Z'), d('Booster Box', 'IN_STOCK', '2026-10-01T00:00:00Z'), d('Elite Trainer Box', 'IN_STOCK', '2026-10-02T01:00:00Z')]
    expect(sortDrops(rows, 'recommended').map((r) => `${r.title}/${r.eventType}`)).toEqual(['Booster Box/IN_STOCK', 'Elite Trainer Box/IN_STOCK', 'Tin/IN_STOCK', 'Booster Box/PREORDER_OPEN'])
    expect(sortDrops(rows, 'newest')[0]!.eventType).toBe('PREORDER_OPEN')
    expect(sortDrops(rows, 'oldest')[0]!.occurredAt).toBe('2026-10-01T00:00:00Z')
    expect(dropRank({ eventType: 'PRICE_CHANGE', sighting: null })).toBe(3)
    expect(parseSort(undefined)).toBe('recommended')
  })
  it('leaves defaults out of links so the clean URL is canonical', () => {
    expect(feedHref('/drops/', { status: 'all', sort: 'recommended' })).toBe('/drops/')
    expect(feedHref('/drops/', { q: 'char*ex', lang: 'jp', sort: 'newest', page: 2 })).toBe('/drops/?q=char*ex&lang=jp&sort=newest&page=2')
  })
})
