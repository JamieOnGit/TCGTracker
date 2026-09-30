import { describe, expect, it } from 'vitest'
import {
  audFromCents, bannedWordHints, checkImageFile, describeSearch, fitWithin, gradeKeyOf, listingActions, listingStatusChip, looksLikeContactDetails,
  notificationDefault, parseAud, parseGradeKey, photoSlots, preferenceMatrix, quotaLine, quotaPercent, relativeTime, safeNext, scoreCard, searchTokens,
  suggestTitle, summariseListings,
} from '@/lib/account/format'

describe('grades', () => {
  it('parses grade keys from the Buy button links', () => {
    expect(parseGradeKey('psa-10')).toEqual({ kind: 'graded', grader: 'PSA', grade: 10 })
    expect(parseGradeKey('bgs-9.5')).toEqual({ kind: 'graded', grader: 'BGS', grade: 9.5 })
    expect(parseGradeKey('raw')).toEqual({ kind: 'raw' })
    expect(parseGradeKey('xyz-10')).toBeNull()
    expect(parseGradeKey('psa-11')).toBeNull()
    expect(parseGradeKey(null)).toBeNull()
  })
  it('builds keys like public.grade_key()', () => {
    expect(gradeKeyOf('PSA', 10)).toBe('psa-10')
    expect(gradeKeyOf('BGS', 9.5)).toBe('bgs-9.5')
    expect(gradeKeyOf(null, null)).toBe('raw')
  })
})

describe('suggestTitle', () => {
  it('suggests from card and grade', () => {
    expect(suggestTitle({ listingType: 'graded_single', name: 'Charizard ex', number: '199', setName: '151', lang: 'en', grader: 'PSA', grade: 10 })).toBe('Charizard ex 199 · 151 · EN · PSA 10')
    expect(suggestTitle({ listingType: 'raw_single', name: 'Shanks', number: 'OP01-120', setName: 'Romance Dawn', lang: 'jp', condition: 'NM' })).toBe('Shanks OP01-120 · Romance Dawn · JP · Raw NM')
    expect(suggestTitle({ listingType: 'sealed', name: '151 Booster Bundle', lang: 'en' })).toBe('151 Booster Bundle · EN · Sealed')
    expect(suggestTitle({ listingType: 'sealed', name: null })).toBe('')
  })
  it('caps at 120 characters', () => {
    expect(suggestTitle({ listingType: 'graded_single', name: 'x'.repeat(200), lang: 'en', grader: 'PSA', grade: 10 }).length).toBe(120)
  })
})

describe('listing status and actions', () => {
  it('labels every status, with reasons', () => {
    expect(listingStatusChip({ status: 'pending_review' }).label).toBe('Pending review')
    expect(listingStatusChip({ status: 'draft', changeRequest: 'Show the back' })).toMatchObject({ key: 'changes_requested', note: 'Show the back' })
    expect(listingStatusChip({ status: 'rejected', rejectionReason: 'Proxy' })).toMatchObject({ tone: 'down', note: 'Proxy' })
    expect(listingStatusChip({ status: 'removed' }).label).toBe('Withdrawn')
  })
  it('offers only transitions the DB allows the owner', () => {
    const now = new Date('2026-09-28T00:00:00Z')
    expect(listingActions({ status: 'draft' }, now)).toEqual(['edit', 'submit', 'withdraw'])
    expect(listingActions({ status: 'pending_review' }, now)).toEqual(['withdraw'])
    expect(listingActions({ status: 'active', expiresAt: '2026-11-20T00:00:00Z' }, now)).toEqual(['view', 'mark_sold', 'withdraw'])
    expect(listingActions({ status: 'active', expiresAt: '2026-10-01T00:00:00Z' }, now)).toContain('renew')
    expect(listingActions({ status: 'expired' }, now)).toEqual(['renew'])
    expect(listingActions({ status: 'rejected' }, now)).toEqual([])
  })
  it('summarises by status', () => {
    const s = summariseListings([{ status: 'draft' }, { status: 'draft', changeRequest: 'x' }, { status: 'active' }, { status: 'active' }])
    expect(s).toMatchObject({ draft: 1, changes_requested: 1, active: 2 })
  })
})

describe('quota', () => {
  it('formats the meter line', () => {
    expect(quotaLine(3, 5, new Date('2026-09-30T14:00:00Z'))).toBe('3 of 5 listings used this month · resets 1 Oct')
    expect(quotaLine(7, 5, null)).toBe('5 of 5 listings used this month')
    expect(quotaPercent(3, 5)).toBe(60)
    expect(quotaPercent(9, 5)).toBe(100)
    expect(quotaPercent(0, 0)).toBe(100)
  })
  it('formats cents as A$', () => expect(audFromCents(1299)).toBe('A$12.99'))
})

describe('form helpers', () => {
  it('parses AUD input', () => {
    expect(parseAud('1,234.50')).toBe(1234.5)
    expect(parseAud('A$99')).toBe(99)
    expect(parseAud('0')).toBeNull()
    expect(parseAud('abc')).toBeNull()
    expect(parseAud('1.234')).toBeNull()
  })
  it('hints at banned words and contact details', () => {
    expect(bannedWordHints('Charizard PROXY card').blocked).toEqual(['proxy'])
    expect(bannedWordHints('PayPal friends and family only').flagged).toContain('friends and family')
    expect(looksLikeContactDetails('email me at a.b@c.com')).toBe(true)
    expect(looksLikeContactDetails('call 0412 345 678')).toBe(true)
    expect(looksLikeContactDetails('PSA 10 cert 12345678')).toBe(false)
  })
  it('checks images and scales them', () => {
    expect(checkImageFile({ type: 'image/gif', size: 10 }, 100)).toMatch(/JPEG/)
    expect(checkImageFile({ type: 'image/png', size: 200 }, 100)).toMatch(/over/)
    expect(checkImageFile({ type: 'image/webp', size: 50 }, 100)).toBeNull()
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200, scaled: true })
    expect(fitWithin(800, 1200, 1600)).toEqual({ width: 800, height: 1200, scaled: false })
    expect(photoSlots('graded_single').map((s) => s.kind)).toEqual(['slab-front', 'slab-back'])
    expect(photoSlots('raw_single').map((s) => s.kind)).toEqual(['front', 'back'])
  })
  it('keeps next redirects on-site', () => {
    expect(safeNext('/account/alerts/new/?card=x')).toBe('/account/alerts/new/?card=x')
    expect(safeNext('//evil.com')).toBe('/account/')
    expect(safeNext('https://evil.com')).toBe('/account/')
    expect(safeNext(null)).toBe('/account/')
  })
})

describe('catalogue search', () => {
  it('tokenises safely for PostgREST filters', () => {
    expect(searchTokens('Charizard, (151)* %')).toEqual(['charizard', '151'])
    expect(searchTokens('Gol.D.Roger OP09')).toEqual(['gol.d.roger', 'op09'])
  })
  it('requires every word to match the card or its set', () => {
    const card = { name: 'Charizard ex', number: '199', variant: 'sir', setName: '151', setCode: 'sv3pt5' }
    expect(scoreCard(card, ['charizard', '151'])).toBeGreaterThan(0)
    expect(scoreCard(card, ['charizard', 'evolving'])).toBe(-1)
    expect(scoreCard({ ...card, name: 'Pokémon' }, ['pokemon'])).toBeGreaterThan(0)
    expect(scoreCard(card, ['char'])).toBeGreaterThan(scoreCard(card, ['151']))
  })
})

describe('notification preferences', () => {
  it('mirrors public.notification_default()', () => {
    expect(notificationDefault('message', 'email')).toBe(true)
    expect(notificationDefault('marketing', 'email')).toBe(false)
    expect(notificationDefault('weekly_digest', 'onsite')).toBe(false)
    expect(notificationDefault('drop', 'discord')).toBe(false)
  })
  it('stored rows override defaults', () => {
    const m = preferenceMatrix([{ alert_type: 'marketing', channel: 'email', enabled: true }, { alert_type: 'message', channel: 'email', enabled: false }, { alert_type: 'bogus', channel: 'email', enabled: true }])
    expect(m['marketing:email']).toBe(true)
    expect(m['message:email']).toBe(false)
    expect(m['wishlist:onsite']).toBe(true)
    expect(m['bogus:email']).toBeUndefined()
    expect(Object.keys(m)).toHaveLength(27)
  })
})

describe('misc', () => {
  it('relative times', () => {
    const now = new Date('2026-09-28T10:00:00Z')
    expect(relativeTime('2026-09-28T09:59:50Z', now)).toBe('just now')
    expect(relativeTime('2026-09-28T09:30:00Z', now)).toBe('30 min ago')
    expect(relativeTime('2026-09-28T07:00:00Z', now)).toBe('3 h ago')
    expect(relativeTime('2026-09-27T08:00:00Z', now)).toBe('yesterday')
    expect(relativeTime(null, now)).toBe('')
  })
  it('describes saved searches', () => {
    expect(describeSearch({ game: 'pokemon', lang: 'jp', grade_key: 'psa-10', price_max: 500, q: 'charizard' })).toBe('Pokémon · Japanese · PSA 10 · under A$500 · “charizard”')
    expect(describeSearch({})).toBe('All new listings')
  })
})
