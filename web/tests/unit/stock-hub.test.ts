import { describe, expect, it } from 'vitest'
import { listingCounts, matchesListingFilter, parseListingFilter, sortStoresByStock, stockTotals, storeStockSummary, storeStockTitle } from '@/lib/domain/stock'

const store = (name: string, inStock: number, preorder: number, listings: number, live = true) => ({ name, inStock, preorder, listings, enabled: live, monitored: live, blockedReason: null })

describe('stock hub helpers', () => {
  it('totals across stores', () => {
    const t = stockTotals([store('A', 3, 1, 10), store('B', 0, 2, 5), store('C', 0, 0, 0, false)])
    expect(t).toEqual({ inStock: 3, preorder: 3, listings: 15, storesWithStock: 1, storesLive: 2 })
  })
  it('orders stores by what is in stock', () => {
    expect(sortStoresByStock([store('B', 0, 2, 5), store('A', 3, 0, 1), store('C', 0, 2, 9)]).map((s) => s.name)).toEqual(['A', 'C', 'B'])
  })
  it('parses and applies the status facet', () => {
    expect(parseListingFilter('in-stock')).toBe('in-stock')
    expect(parseListingFilter('nope')).toBe('all')
    expect(matchesListingFilter('in_stock_cnc', 'in-stock')).toBe(true)
    expect(matchesListingFilter('preorder', 'in-stock')).toBe(false)
    expect(matchesListingFilter('out_of_stock', 'sold-out')).toBe(true)
    expect(listingCounts([{ availability: 'in_stock_online' }, { availability: 'preorder' }, { availability: 'out_of_stock' }, { availability: 'unknown' }])).toEqual({ all: 4, 'in-stock': 1, preorder: 1, 'sold-out': 1 })
  })
  it('writes titles and summaries from the data', () => {
    expect(storeStockTitle('Kmart')).toBe('Kmart Pokémon & One Piece Card Stock, Live')
    expect(storeStockTitle('Toys“R”Us Australia Online Store Extra')).toMatch(/^.{1,60}$/)
    expect(storeStockSummary('Kmart', [{ availability: 'in_stock_online' }, { availability: 'preorder' }, { availability: 'out_of_stock' }])).toBe('1 of 3 Pokémon and One Piece listings in stock at Kmart right now, 1 on pre-order.')
    expect(storeStockSummary('Kmart', [])).toContain('don’t track')
  })
})
