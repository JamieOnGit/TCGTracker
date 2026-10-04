import { describe, expect, it, vi } from 'vitest'
import { demoRepository } from '@/lib/data/demo'
import type { Repository } from '@/lib/data/types'

let repo: Repository = demoRepository
vi.mock('server-only', () => ({}))
vi.mock('@/lib/data', async (orig) => ({ ...(await orig<object>()), getRepo: () => repo }))

describe('drops sitemap', () => {
  it('lists the same store and state pages from one query as from one request per page', async () => {
    const { entriesFor } = await import('@/lib/seo/sitemap')
    repo = demoRepository
    const fast = (await entriesFor('drops')).map((e) => e.path).sort()
    // The database function isn't deployed yet: the old per-page lookups still give the full list.
    let calls = 0
    repo = {
      ...demoRepository,
      dropPageLastEvents: async () => null,
      drops: async (f) => {
        calls++
        return demoRepository.drops(f)
      },
    }
    const fallback = (await entriesFor('drops')).map((e) => e.path).sort()
    expect(fallback).toEqual(fast)
    expect(fast).toContain('/drops/')
    expect(fast.some((p) => /^\/drops\/[a-z0-9-]+\/$/.test(p) && p !== '/drops/')).toBe(true)
    expect(calls).toBeGreaterThan(5)
  })
})
