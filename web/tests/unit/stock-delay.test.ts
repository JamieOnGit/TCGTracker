import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('store stock: live for members, delayed for visitors', () => {
  it('visitors read the delayed copy under the live names, so the mappers need no change', async () => {
    const { stockSelect } = await import('@/lib/data/supabase')
    const { SEALED_SELECT, STORE_LISTING_SELECT } = await import('@/lib/data/drops')
    expect(stockSelect(STORE_LISTING_SELECT, true)).toBe(STORE_LISTING_SELECT)
    const delayed = stockSelect(STORE_LISTING_SELECT, false)
    expect(delayed).toContain('current_availability:public_availability')
    expect(delayed).toContain('current_price_aud:public_price_aud')
    expect(delayed).toContain('last_change_at:public_change_at')
    expect(delayed).not.toMatch(/(^|,)current_availability(,|$)/)
    // Inside the embedded store listings of a sealed product too.
    expect(stockSelect(SEALED_SELECT, false)).toMatch(/retail_products\([^)]*current_availability:public_availability/)
  })

  it('defaults to a 10-minute delay', async () => {
    const { DEFAULT_RULES } = await import('@/lib/domain/rules')
    expect(DEFAULT_RULES.stockPublicDelayMinutes).toBe(10)
  })
})
