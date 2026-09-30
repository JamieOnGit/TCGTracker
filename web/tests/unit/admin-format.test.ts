import { describe, expect, it } from 'vitest'
import { audToCents, fmtAgo, fmtDuration, jsonDiff, maskEmail, pageParam, pctVsFloor, priceLooksOff, retailerHealth, rrpTag, shortJson, subscriptionMetrics } from '@/lib/admin/format'

describe('maskEmail', () => {
  it('keeps enough to recognise, not enough to harvest', () => {
    expect(maskEmail('jamie@example.com')).toBe('ja***@e***.com')
    expect(maskEmail('a@b.com.au')).toBe('a***@b***.au')
    expect(maskEmail(null)).toBe('—')
    expect(maskEmail('nope')).toBe('***')
  })
})

describe('jsonDiff', () => {
  it('lists only changed keys on update, ignoring noise columns', () => {
    const d = jsonDiff({ status: 'pending_review', price: 10, updated_at: 'a', updated_by: 'x' }, { status: 'active', price: 10, updated_at: 'b', updated_by: 'y' })
    expect(d).toEqual([{ key: 'status', before: 'pending_review', after: 'active' }])
  })
  it('shows non-null fields for inserts and deletes', () => {
    expect(jsonDiff(null, { a: 1, b: null })).toEqual([{ key: 'a', before: undefined, after: 1 }])
    expect(jsonDiff({ a: 1 }, null)).toEqual([{ key: 'a', before: 1, after: undefined }])
  })
  it('compares nested values structurally and respects the limit', () => {
    expect(jsonDiff({ s: { a: [1] } }, { s: { a: [1] } })).toEqual([])
    expect(jsonDiff({}, { a: 1, b: 2, c: 3 }, 2)).toHaveLength(2)
  })
  it('shortJson truncates', () => {
    expect(shortJson('x'.repeat(100), 10)).toHaveLength(10)
    expect(shortJson(undefined)).toBe('∅')
    expect(shortJson({ a: 1 })).toBe('{"a":1}')
  })
})

describe('retailerHealth', () => {
  const now = Date.parse('2026-09-28T10:00:00Z')
  const base = { enabled: true, last_success_at: '2026-09-28T09:59:00Z', last_error_at: null, consecutive_errors: 0, zero_product_cycles: 0, watch_interval_seconds: 90 }
  it('off when disabled', () => expect(retailerHealth({ ...base, enabled: false }, 5, now)).toBe('off'))
  it('ok when recent success and no errors', () => expect(retailerHealth(base, 5, now)).toBe('ok'))
  it('warn on an error streak or empty cycles', () => {
    expect(retailerHealth({ ...base, consecutive_errors: 1 }, 5, now)).toBe('warn')
    expect(retailerHealth({ ...base, zero_product_cycles: 5 }, 5, now)).toBe('warn')
  })
  it('down after 3 errors, or stale with an error', () => {
    expect(retailerHealth({ ...base, consecutive_errors: 3 }, 5, now)).toBe('down')
    expect(retailerHealth({ ...base, last_success_at: '2026-09-28T09:00:00Z', last_error_at: '2026-09-28T09:59:00Z' }, 5, now)).toBe('down')
  })
})

describe('durations and times', () => {
  it('fmtDuration', () => {
    expect(fmtDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:00.250Z')).toBe('250 ms')
    expect(fmtDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:05Z')).toBe('5.0 s')
    expect(fmtDuration('2026-01-01T00:00:00Z', '2026-01-01T00:02:05Z')).toBe('2m 5s')
    expect(fmtDuration('2026-01-01T00:00:00Z', null)).toBe('—')
  })
  it('fmtAgo', () => {
    const now = Date.parse('2026-09-28T10:00:00Z')
    expect(fmtAgo('2026-09-28T09:59:50Z', now)).toBe('just now')
    expect(fmtAgo('2026-09-28T09:45:00Z', now)).toBe('15m ago')
    expect(fmtAgo('2026-09-28T07:00:00Z', now)).toBe('3h ago')
    expect(fmtAgo('2026-09-20T10:00:00Z', now)).toBe('8d ago')
    expect(fmtAgo('2026-09-28T11:00:00Z', now)).toBe('in 1h')
  })
})

describe('prices', () => {
  it('pctVsFloor and priceLooksOff', () => {
    expect(pctVsFloor(110, 100)).toBeCloseTo(10)
    expect(pctVsFloor(110, null)).toBeNull()
    expect(priceLooksOff(pctVsFloor(12, 3368))).toBe(true)
    expect(priceLooksOff(pctVsFloor(95, 100))).toBe(false)
  })
  it('rrpTag within tolerance, below and above', () => {
    expect(rrpTag(89, 89).tag).toBe('AT_RRP')
    expect(rrpTag(90, 89, 2).tag).toBe('AT_RRP')
    expect(rrpTag(70, 89)).toEqual({ tag: 'BELOW_RRP', deltaPct: -21.35 })
    expect(rrpTag(179, 89).tag).toBe('ABOVE_RRP')
    expect(rrpTag(null, 89).tag).toBe('UNKNOWN')
  })
  it('audToCents', () => {
    expect(audToCents('12.99')).toBe(1299)
    expect(audToCents('A$1,299')).toBe(129900)
    expect(audToCents('$5')).toBe(500)
    expect(audToCents('12.999')).toBeNull()
    expect(audToCents('abc')).toBeNull()
  })
  it('pageParam clamps', () => {
    expect(pageParam('3')).toBe(3)
    expect(pageParam('-1')).toBe(1)
    expect(pageParam(undefined)).toBe(1)
    expect(pageParam('99999', 50)).toBe(50)
  })
})

describe('subscriptionMetrics', () => {
  const now = Date.parse('2026-09-28T00:00:00Z')
  const row = (status: string, updated = '2026-09-20T00:00:00Z', cancel = false) => ({ tier: 'premium', status, cancel_at_period_end: cancel, updated_at: updated })
  it('MRR is active × price; churn counts the last 30 days only', () => {
    const m = subscriptionMetrics([row('active'), row('active', undefined, true), row('trialing'), row('past_due'), row('canceled'), row('canceled', '2026-07-01T00:00:00Z')], 1299, now)
    expect(m.activePremium).toBe(3)
    expect(m.mrrCents).toBe(3897)
    expect(m.canceled30d).toBe(1)
    expect(m.churnPct).toBeCloseTo(25)
    expect(m.pastDue).toBe(1)
    expect(m.cancelingAtPeriodEnd).toBe(1)
  })
  it('no churn figure without data', () => expect(subscriptionMetrics([], 1299, now).churnPct).toBeNull())
})
