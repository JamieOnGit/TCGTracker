import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Pagination } from '@/components/Pagination'
import { byCardNumber, pageCount, pageWindow, pastLastPage, slicePage, TABLE_PAGE_SIZE } from '@/lib/paging'

describe('paging', () => {
  it('pages hold about ten rows', () => {
    expect(TABLE_PAGE_SIZE).toBe(10)
    const rows = Array.from({ length: 23 }, (_, i) => i + 1)
    expect(slicePage(rows, 1, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(slicePage(rows, 3, 10)).toEqual([21, 22, 23])
    expect(pageCount(23, 10)).toBe(3)
    expect(pageCount(0, 10)).toBe(1)
  })

  it('a page past the last is a 404, page 1 never is', () => {
    expect(pastLastPage(1, 0, 10)).toBe(false)
    expect(pastLastPage(3, 23, 10)).toBe(false)
    expect(pastLastPage(4, 23, 10)).toBe(true)
    expect(pastLastPage(2, 0, 10)).toBe(true)
  })

  it('shows first, last and two either side, with gaps', () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageWindow(10, 25)).toEqual([1, null, 8, 9, 10, 11, 12, null, 25])
    // A gap of one page shows the page instead of "…".
    expect(pageWindow(5, 25)).toEqual([1, 2, 3, 4, 5, 6, 7, null, 25])
    expect(pageWindow(25, 25)).toEqual([1, null, 23, 24, 25])
  })

  it('sorts card numbers in printed order', () => {
    const numbers = ['10', '2', '199/165', 'TG10', 'TG02', '034/103', 'OP05-119', 'OP05-020']
    expect(numbers.map((number) => ({ number })).sort(byCardNumber).map((c) => c.number)).toEqual([
      '2',
      '10',
      '034/103',
      '199/165',
      'OP05-020',
      'OP05-119',
      'TG02',
      'TG10',
    ])
  })
})

describe('Pagination', () => {
  const html = (props: Parameters<typeof Pagination>[0]) => renderToStaticMarkup(createElement(Pagination, props))

  it('renders nothing for a single page', () => {
    expect(html({ basePath: '/x/', page: 1, total: 10, pageSize: 10 })).toBe('')
  })

  it('renders crawlable numbered links that keep filters and drop page=1', () => {
    const out = html({ basePath: '/drops/', page: 2, total: 45, pageSize: 10, params: { q: 'etb', game: undefined, sort: 'newest' }, anchor: 'activity', noun: 'events' })
    expect(out).toContain('Showing 11–20 of 45 events')
    // (next/link drops the trailing slash outside the app's trailingSlash config)
    expect(out).toMatch(/rel="prev"[^>]*href="\/drops\/?\?q=etb&amp;sort=newest#activity"/)
    expect(out).toMatch(/rel="next"[^>]*href="\/drops\/?\?q=etb&amp;sort=newest&amp;page=3#activity"/)
    expect(out).toContain('aria-current="page">2</span>')
    expect(out).toMatch(/href="\/drops\/?\?q=etb&amp;sort=newest&amp;page=5#activity"/)
    expect(out).not.toContain('game=')
    expect(out).not.toContain('page=1#')
  })
})
