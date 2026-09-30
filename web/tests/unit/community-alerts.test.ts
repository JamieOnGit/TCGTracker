import { describe, expect, it } from 'vitest'
import { needsHomeScreen, pushSubscriptionSchema, urlBase64ToUint8Array } from '@/lib/account/push'
import {
  dropSetupSchema, isOnRetailerSite, outcomeOf, parseKeywords, rewardProgress, seenMinutes, sightingError, sightingSchema, SEEN_OPTIONS,
} from '@/lib/account/sightings'
import { parseProductLines, productsToLines, releaseSchema } from '@/lib/admin/releases'
import { discountLabel, endsIn, isLive } from '@/lib/domain/deals'
import { effectiveTier } from '@/lib/domain/tier'

describe('sighting form helpers', () => {
  it('maps "seen how long ago" to minutes (capped at 4 h like the RPC)', () => {
    expect(seenMinutes('now')).toBe(0)
    expect(seenMinutes('15m')).toBe(15)
    expect(seenMinutes('1h')).toBe(60)
    expect(seenMinutes('4h')).toBe(240)
    expect(seenMinutes('bogus')).toBe(0)
    expect(seenMinutes(undefined)).toBe(0)
    expect(Math.max(...SEEN_OPTIONS.map((o) => o.minutes))).toBeLessThanOrEqual(240)
  })

  it('accepts only links on the retailer’s own site (mirrors report_sighting)', () => {
    const base = 'https://www.bigw.com.au'
    expect(isOnRetailerSite('https://www.bigw.com.au/product/pokemon-etb/p/123', base)).toBe(true)
    expect(isOnRetailerSite('https://WWW.BIGW.COM.AU/product/x', `${base}/`)).toBe(true)
    expect(isOnRetailerSite('https://www.bigw.com.au', base)).toBe(false) // needs a path
    expect(isOnRetailerSite('https://www.bigw.com.au.evil.com/x', base)).toBe(false)
    expect(isOnRetailerSite('http://www.bigw.com.au/x', base)).toBe(false)
    expect(isOnRetailerSite('https://www.kmart.com.au/x', base)).toBe(false)
    expect(isOnRetailerSite('not a url', base)).toBe(false)
    expect(isOnRetailerSite('https://www.bigw.com.au/x', null)).toBe(false)
  })

  const inStore = { retailerSlug: 'kmart', channel: 'in_store' as const, game: 'pokemon' as const, product: 'Elite Trainer Box', state: 'VIC' as const, suburb: 'Doncaster', seenMinutesAgo: 0 }

  it('validates in-store and online reports', () => {
    expect(sightingSchema.safeParse(inStore).success).toBe(true)
    const noSuburb = sightingSchema.safeParse({ ...inStore, suburb: '' })
    expect(noSuburb.success).toBe(false)
    expect(noSuburb.error?.issues[0]?.path).toEqual(['suburb'])
    expect(sightingSchema.safeParse({ ...inStore, state: undefined }).success).toBe(false)
    const online = { retailerSlug: 'big-w', channel: 'online' as const, game: 'one-piece' as const, product: 'OP-09 booster box', seenMinutesAgo: 15 }
    expect(sightingSchema.safeParse(online).success).toBe(false)
    expect(sightingSchema.safeParse({ ...online, url: 'https://www.bigw.com.au/p/1' }).success).toBe(true)
    expect(sightingSchema.safeParse({ ...inStore, product: 'ab' }).success).toBe(false)
    expect(sightingSchema.safeParse({ ...inStore, note: 'x'.repeat(281) }).success).toBe(false)
    expect(sightingSchema.safeParse({ ...inStore, purchaseLimit: 21 }).success).toBe(false)
    expect(sightingSchema.safeParse({ ...inStore, priceAud: 0 }).success).toBe(false)
    expect(sightingSchema.safeParse({ ...inStore, seenMinutesAgo: 300 }).success).toBe(false)
    // Blank optional text becomes undefined, so the RPC gets NULL rather than ''.
    expect(sightingSchema.parse({ ...inStore, storeName: '  ', note: '' })).toMatchObject({ storeName: undefined, note: undefined })
  })

  it('independent game stores are in store only and need a store name', () => {
    const lgs = { ...inStore, retailerSlug: 'local-game-store' }
    expect(sightingSchema.safeParse(lgs).error?.issues[0]?.path).toEqual(['storeName'])
    expect(sightingSchema.safeParse({ ...lgs, storeName: 'Good Games Melbourne Central' }).success).toBe(true)
    expect(sightingSchema.safeParse({ ...lgs, channel: 'online', url: 'https://tcgtrade.com.au/x', storeName: 'GG' }).success).toBe(false)
  })

  it('explains the outcome and the RPC’s errors in plain English', () => {
    expect(outcomeOf({ merged: true, status: 'pending' })).toBe('merged')
    expect(outcomeOf({ merged: false, status: 'confirmed' })).toBe('confirmed')
    expect(outcomeOf({ merged: false, status: 'pending' })).toBe('pending')
    expect(sightingError('daily sighting limit reached')).toMatch(/today’s limit/)
    expect(sightingError('online sightings need a link to the product on BIG W')).toMatch(/isn’t on the retailer’s website/)
    expect(sightingError('report contains words that are not allowed')).toMatch(/aren’t allowed/)
    expect(sightingError('duplicate key value violates unique constraint "sighting_votes_pkey"')).toMatch(/already voted/)
    expect(sightingError('please add the store name')).toMatch(/store’s name/)
    expect(sightingError(undefined)).toMatch(/Something went wrong/)
  })

  it('shows scout reward progress', () => {
    expect(rewardProgress(7).text).toBe('7 of 10 confirmed sightings toward your next free month of Premium')
    expect(rewardProgress(23)).toMatchObject({ done: 3, earned: 2 })
    expect(rewardProgress(0, 5, 14).text).toBe('0 of 5 confirmed sightings toward your next free 14 days of Premium')
  })
})

describe('drop alert setup', () => {
  it('parses keyword chips and free text', () => {
    expect(parseKeywords(['Elite Trainer Box'], 'prismatic,  PRISMATIC , a\nbooster   bundle')).toEqual(['elite trainer box', 'prismatic', 'booster bundle'])
    expect(parseKeywords(Array.from({ length: 30 }, (_, i) => `kw${i}`))).toHaveLength(20)
    expect(parseKeywords(null, undefined, '')).toEqual([])
  })

  it('validates the wizard', () => {
    const ok = {
      games: ['pokemon'], retailerSlugs: null, states: ['VIC'], keywords: [], maxPriceAud: null, onlyAtOrBelowRrp: true, includeSightings: true,
      channels: { email: true, onsite: true, push: false, discord: false },
    }
    expect(dropSetupSchema.safeParse(ok).success).toBe(true)
    expect(dropSetupSchema.safeParse({ ...ok, games: [] }).success).toBe(false)
    expect(dropSetupSchema.safeParse({ ...ok, states: [] }).success).toBe(false)
    expect(dropSetupSchema.safeParse({ ...ok, states: ['XYZ'] }).success).toBe(false)
    expect(dropSetupSchema.safeParse({ ...ok, retailerSlugs: [] }).success).toBe(false)
    expect(dropSetupSchema.safeParse({ ...ok, maxPriceAud: -1 }).success).toBe(false)
  })
})

describe('web push', () => {
  it('decodes URL-safe base64 VAPID keys', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3])
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]) // '-' and '_' are URL-safe for '+' and '/'
    expect(urlBase64ToUint8Array('A'.repeat(87))).toHaveLength(65) // a P-256 public key, padding added
  })

  it('validates subscriptions', () => {
    const s = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'BN…', auth: 'xyz', userAgent: null }
    expect(pushSubscriptionSchema.safeParse(s).success).toBe(true)
    expect(pushSubscriptionSchema.safeParse({ ...s, endpoint: 'http://example.com/x' }).success).toBe(false)
    expect(pushSubscriptionSchema.safeParse({ ...s, auth: '' }).success).toBe(false)
  })

  it('knows iPhone needs Add to Home Screen first', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    expect(needsHomeScreen(iphone, false)).toBe(true)
    expect(needsHomeScreen(iphone, true)).toBe(false)
    expect(needsHomeScreen('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0', false)).toBe(false)
  })
})

describe('release calendar editing', () => {
  it('parses "name | type | rrp" product lines', () => {
    const { products, errors } = parseProductLines('Prismatic Evolutions Elite Trainer Box | ETB | A$89.95\n\nBooster Bundle | booster bundle\nSurprise Box\n')
    expect(errors).toEqual([])
    expect(products).toEqual([
      { name: 'Prismatic Evolutions Elite Trainer Box', type: 'etb', rrp_aud: 89.95 },
      { name: 'Booster Bundle', type: 'booster-bundle', rrp_aud: null },
      { name: 'Surprise Box', type: null, rrp_aud: null },
    ])
    expect(parseProductLines('Tin | tin | cheap').errors[0]).toMatch(/Line 1/)
    expect(parseProductLines(' | etb | 10').errors[0]).toMatch(/product name/)
  })

  it('round-trips products to lines', () => {
    const lines = productsToLines([{ name: 'ETB', type: 'etb', rrpAud: 89.95 }, { name: 'Tin', type: null, rrpAud: null }, { name: 'Box', type: null, rrpAud: 10 }])
    expect(lines).toBe('ETB | etb | 89.95\nTin\nBox |  | 10')
    expect(parseProductLines(lines).products.map((p) => p.rrp_aud)).toEqual([89.95, null, 10])
  })

  it('validates release events like the table checks', () => {
    const base = {
      id: null, game: 'pokemon', lang: 'en', title: 'Mega Evolution', slug: 'mega-evolution', kind: 'set_release', releaseDate: '2026-11-14', datePrecision: 'day',
      confidence: 'official', setId: null, products: [], retailerSlugs: [], summary: '', bodyMd: null, sourceName: null, sourceUrl: '', published: true,
    }
    expect(releaseSchema.safeParse(base).success).toBe(true)
    expect(releaseSchema.parse(base)).toMatchObject({ summary: null, sourceUrl: null })
    expect(releaseSchema.safeParse({ ...base, releaseDate: null }).success).toBe(false)
    expect(releaseSchema.safeParse({ ...base, releaseDate: null, datePrecision: 'tbc' }).success).toBe(true)
    expect(releaseSchema.safeParse({ ...base, slug: 'Mega Evolution' }).success).toBe(false)
    expect(releaseSchema.safeParse({ ...base, sourceUrl: 'http://example.com' }).success).toBe(false)
    expect(releaseSchema.safeParse({ ...base, releaseDate: '2026-13-01' }).success).toBe(false)
  })
})

describe('effectiveTier with scout rewards (premium_until)', () => {
  const now = new Date('2026-09-30T00:00:00Z')
  it('treats premium_until in the future as Premium, after override and subscription rules', () => {
    expect(effectiveTier({ status: 'none', graceUntil: null, premiumUntil: new Date('2026-10-15T00:00:00Z') }, now)).toBe('premium')
    expect(effectiveTier({ status: 'canceled', graceUntil: null, premiumUntil: new Date('2026-09-01T00:00:00Z') }, now)).toBe('free')
    expect(effectiveTier({ status: 'none', graceUntil: null, premiumUntil: null }, now)).toBe('free')
    // An override wins over a reward, like public.effective_tier().
    expect(effectiveTier({ status: 'none', graceUntil: null, tierOverride: 'free', premiumUntil: new Date('2026-10-15T00:00:00Z') }, now)).toBe('free')
  })
})

describe('eBay deals', () => {
  it('labels discounts and auction countdowns', () => {
    expect(discountLabel(27.6)).toBe('28% under value')
    expect(discountLabel(0.2)).toBe('at market value')
    const now = Date.parse('2026-09-30T10:00:00Z')
    expect(endsIn('2026-09-30T10:45:00Z', now)).toBe('ends in 45 min')
    expect(endsIn('2026-09-30T11:20:00Z', now)).toBe('ends in 1 h 20 min')
    expect(endsIn('2026-09-30T12:00:00Z', now)).toBe('ends in 2 h')
    expect(endsIn('2026-09-30T09:00:00Z', now)).toBe('ended')
    expect(endsIn(null, now)).toBeNull()
  })
  it('hides finished auctions and gone listings', () => {
    const now = Date.parse('2026-09-30T10:00:00Z')
    expect(isLive({ buyingOption: 'AUCTION', endTime: '2026-09-30T09:00:00Z', goneAt: null }, now)).toBe(false)
    expect(isLive({ buyingOption: 'AUCTION', endTime: '2026-09-30T11:00:00Z', goneAt: null }, now)).toBe(true)
    expect(isLive({ buyingOption: 'FIXED_PRICE', endTime: null, goneAt: null }, now)).toBe(true)
    expect(isLive({ buyingOption: 'FIXED_PRICE', endTime: null, goneAt: '2026-09-30T09:00:00Z' }, now)).toBe(false)
  })
})

describe('push endpoints', () => {
  it('accepts browser push services only', () => {
    const base = { p256dh: 'k', auth: 'a', userAgent: null }
    expect(pushSubscriptionSchema.safeParse({ ...base, endpoint: 'https://web.push.apple.com/QGx' }).success).toBe(true)
    expect(pushSubscriptionSchema.safeParse({ ...base, endpoint: 'https://wns2-par02p.notify.windows.com/w/?token=x' }).success).toBe(true)
    expect(pushSubscriptionSchema.safeParse({ ...base, endpoint: 'https://evil.example/hook' }).success).toBe(false)
  })
})

