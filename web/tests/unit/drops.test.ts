import { describe, expect, it } from 'vitest'
import { confirmationsLabel, durationLabel, hasRecentDrops, parseDropSource, purchaseLimitLabel, sightingPlace, stateFromSlug } from '@/lib/domain/drops'

describe('drops page helpers', () => {
  it('parses ?source= and ignores anything else', () => {
    expect(parseDropSource('member')).toBe('member')
    expect(parseDropSource(['monitor', 'member'])).toBe('monitor')
    expect(parseDropSource('bots')).toBeUndefined()
    expect(parseDropSource(undefined)).toBeUndefined()
  })
  it('routes /drops/<slug>/ to a state only for lowercase state codes', () => {
    expect(stateFromSlug('vic')).toBe('VIC')
    expect(stateFromSlug('act')).toBe('ACT')
    expect(stateFromSlug('VIC')).toBeNull()
    expect(stateFromSlug('kmart')).toBeNull()
    expect(stateFromSlug('scouts')).toBeNull()
  })
  it('describes where a sighting was', () => {
    expect(sightingPlace('Kmart', { channel: 'in_store', suburb: 'Chadstone', state: 'VIC' })).toBe('Kmart Chadstone, VIC')
    expect(sightingPlace('BIG W', { channel: 'in_store', suburb: null, state: 'NSW' })).toBe('BIG W, NSW')
    expect(sightingPlace('Target', { channel: 'online', suburb: null, state: null })).toBe('Target online')
  })
  it('labels limits, confirmations and durations', () => {
    expect(purchaseLimitLabel(2)).toBe('Limit 2 per customer')
    expect(purchaseLimitLabel(null)).toBeNull()
    expect(purchaseLimitLabel(0)).toBeNull()
    expect(confirmationsLabel(3)).toBe('Confirmed by 3 members')
    expect(confirmationsLabel(1)).toBe('Confirmed by 1 member')
    expect(confirmationsLabel(0)).toBeNull()
    expect(durationLabel(1440)).toBe('24 hours')
    expect(durationLabel(60)).toBe('1 hour')
    expect(durationLabel(90)).toBe('90 minutes')
  })
  it('flags state pages with nothing in the last 90 days as thin', () => {
    const now = new Date('2026-09-30T00:00:00Z')
    expect(hasRecentDrops([{ occurredAt: '2026-07-10T00:00:00Z' }], now)).toBe(true)
    expect(hasRecentDrops([{ occurredAt: '2026-06-01T00:00:00Z' }], now)).toBe(false)
    expect(hasRecentDrops([], now)).toBe(false)
  })
})
