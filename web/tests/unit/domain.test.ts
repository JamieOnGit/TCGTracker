import { describe, expect, it } from 'vitest'
import { applyBillingEvent, type StoredSubscription } from '@/lib/domain/billing'
import { resolveBuyButton } from '@/lib/domain/buyButton'
import { canTransition, listingPageOutcome } from '@/lib/domain/listing'
import { countQuotaUsage, quotaPeriodStart, quotaResetsAt, quotaStatus } from '@/lib/domain/quota'
import { DEFAULT_RULES, rulesFromSettings } from '@/lib/domain/rules'
import { can, effectiveTier, quotaLimit } from '@/lib/domain/tier'
import type { CardRef } from '@/lib/seo/urls'

const MEL = 'Australia/Melbourne'

describe('quota counting', () => {
  it('starts the calendar month at local midnight in Melbourne', () => {
    // 1 Oct 2026 00:00 AEST (UTC+10; DST starts 4 Oct) = 30 Sep 14:00 UTC
    expect(quotaPeriodStart(new Date('2026-10-15T00:00:00Z'), MEL, 'calendar_month').toISOString()).toBe('2026-09-30T14:00:00.000Z')
    // 1 Nov 2026 00:00 AEDT (UTC+11) = 31 Oct 13:00 UTC
    expect(quotaPeriodStart(new Date('2026-11-20T00:00:00Z'), MEL, 'calendar_month').toISOString()).toBe('2026-10-31T13:00:00.000Z')
  })

  it('uses the member timezone: 30 Sep 23:30 UTC is already October in Melbourne', () => {
    const at = new Date('2026-09-30T23:30:00Z')
    expect(quotaPeriodStart(at, MEL, 'calendar_month').toISOString()).toBe('2026-09-30T14:00:00.000Z')
    expect(quotaPeriodStart(at, 'UTC', 'calendar_month').toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('counts submissions this month, including rejected by default', () => {
    const at = new Date('2026-09-27T02:00:00Z')
    const listings = [
      { submittedAt: new Date('2026-09-02T00:00:00Z'), status: 'active' },
      { submittedAt: new Date('2026-09-10T00:00:00Z'), status: 'rejected' },
      { submittedAt: new Date('2026-08-31T13:00:00Z'), status: 'active' }, // 31 Aug 23:00 AEST: last month
      { submittedAt: null, status: 'draft' }, // drafts never count
    ]
    expect(countQuotaUsage(listings, at, MEL, DEFAULT_RULES)).toBe(2)
    expect(countQuotaUsage(listings, at, MEL, { ...DEFAULT_RULES, countRejected: false })).toBe(1)
  })

  it('supports a rolling 30-day period via config', () => {
    const at = new Date('2026-09-27T00:00:00Z')
    const listings = [{ submittedAt: new Date('2026-08-30T00:00:00Z'), status: 'active' }]
    expect(countQuotaUsage(listings, at, MEL, { ...DEFAULT_RULES, quotaPeriod: 'rolling_30_days' })).toBe(1)
    expect(countQuotaUsage(listings, at, MEL, DEFAULT_RULES)).toBe(0)
  })

  it('labels and blocks', () => {
    expect(quotaStatus(3, 5)).toMatchObject({ label: '3 of 5 listings used this month', blocked: false, remaining: 2 })
    expect(quotaStatus(5, 5).blocked).toBe(true)
    expect(quotaResetsAt(new Date('2026-09-27T00:00:00Z'), MEL).toISOString()).toBe('2026-09-30T14:00:00.000Z')
  })
})

describe('tier gating', () => {
  const now = new Date('2026-09-27T00:00:00Z')
  it('derives the effective tier from Stripe status and grace period', () => {
    expect(effectiveTier(null)).toBe('free')
    expect(effectiveTier({ status: 'active', graceUntil: null }, now)).toBe('premium')
    expect(effectiveTier({ status: 'past_due', graceUntil: new Date('2026-09-30T00:00:00Z') }, now)).toBe('premium')
    expect(effectiveTier({ status: 'past_due', graceUntil: new Date('2026-09-20T00:00:00Z') }, now)).toBe('free')
    expect(effectiveTier({ status: 'canceled', graceUntil: null, tierOverride: 'premium' }, now)).toBe('premium')
  })
  it('gates features', () => {
    expect(can('free', 'instant_drop_alerts')).toBe(false)
    expect(can('premium', 'instant_drop_alerts')).toBe(true)
    expect(can('free', 'message_sellers')).toBe(true)
    expect(can('free', 'premium_badge')).toBe(false)
  })
  it('quota limits come from config, with admin override', () => {
    expect(quotaLimit('free', DEFAULT_RULES)).toBe(5)
    expect(quotaLimit('premium', DEFAULT_RULES)).toBe(30)
    expect(quotaLimit('free', { ...DEFAULT_RULES, freeQuota: 8 })).toBe(8)
    expect(quotaLimit('free', DEFAULT_RULES, 12)).toBe(12)
  })
  it('reads rules from site_settings rows', () => {
    const r = rulesFromSettings([{ key: 'quota.free_per_period', value: 7 }, { key: 'billing.premium_monthly_cents', value: 999 }, { key: 'nope', value: 1 }])
    expect(r.freeQuota).toBe(7)
    expect(r.premiumMonthlyCents).toBe(999)
  })
  it('reads sighting and scout settings, keeping defaults for bad values', () => {
    expect(DEFAULT_RULES.sightings).toMatchObject({ confirmationsNeeded: 2, confirmationsWithPhoto: 1, trustedAfter: 5, rewardEvery: 10, rewardDays: 30 })
    const r = rulesFromSettings([
      { key: 'sightings.confirmations_needed', value: 3 },
      { key: 'scouts.reward_every', value: '12' },
      { key: 'scouts.reward_days', value: -1 },
      { key: 'sightings.trusted_after', value: 'lots' },
      { key: 'sightings.enabled', value: false },
    ])
    expect(r.sightings.confirmationsNeeded).toBe(3)
    expect(r.sightings.rewardEvery).toBe(12)
    expect(r.sightings.rewardDays).toBe(30)
    expect(r.sightings.trustedAfter).toBe(5)
    expect(r.sightings.enabled).toBe(false)
    expect(DEFAULT_RULES.sightings.enabled).toBe(true)
  })
})

describe('billing webhook reducer', () => {
  const base: StoredSubscription = { userId: 'u', status: 'none', stripeCustomerId: 'cus_1', stripeSubscriptionId: null, stripePriceId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, graceUntil: null, lastEventAt: null }
  const sub = (status: string) => ({ id: 'sub_1', customer: 'cus_1', status, cancel_at_period_end: false, items: { data: [{ price: { id: 'price_premium' }, current_period_end: 1790000000 }] } })

  it('activates, fails into grace, recovers, and cancels', () => {
    let s = applyBillingEvent(base, { type: 'customer.subscription.created', created: 1000, subscription: sub('active') }, { gracePeriodDays: 7 })
    expect(s.status).toBe('active')
    expect(effectiveTier(s)).toBe('premium')
    s = applyBillingEvent(s, { type: 'invoice.payment_failed', created: 2000, subscriptionId: 'sub_1' }, { gracePeriodDays: 7 })
    expect(s.status).toBe('past_due')
    expect(s.graceUntil?.getTime()).toBe(2000 * 1000 + 7 * 86_400_000)
    expect(effectiveTier(s, new Date(2000 * 1000 + 86_400_000))).toBe('premium')
    expect(effectiveTier(s, new Date(2000 * 1000 + 8 * 86_400_000))).toBe('free')
    s = applyBillingEvent(s, { type: 'invoice.paid', created: 3000, subscriptionId: 'sub_1' }, { gracePeriodDays: 7 })
    expect(s.status).toBe('active')
    expect(s.graceUntil).toBeNull()
    s = applyBillingEvent(s, { type: 'customer.subscription.deleted', created: 4000, subscription: sub('canceled') }, { gracePeriodDays: 7 })
    expect(effectiveTier(s)).toBe('free')
  })

  it('ignores out-of-order events', () => {
    const s = applyBillingEvent(base, { type: 'customer.subscription.updated', created: 5000, subscription: sub('canceled') }, { gracePeriodDays: 7 })
    const stale = applyBillingEvent(s, { type: 'customer.subscription.updated', created: 4000, subscription: sub('active') }, { gracePeriodDays: 7 })
    expect(stale.status).toBe('canceled')
  })
})

describe('listing lifecycle', () => {
  it('only moderators approve; owners submit and close', () => {
    expect(canTransition('draft', 'pending_review', 'owner')).toBe(true)
    expect(canTransition('pending_review', 'active', 'owner')).toBe(false)
    expect(canTransition('pending_review', 'active', 'moderator')).toBe(true)
    expect(canTransition('active', 'sold', 'owner')).toBe(true)
    expect(canTransition('rejected', 'active', 'moderator')).toBe(false)
  })

  const now = new Date('2026-09-27T00:00:00Z')
  const base = { now, soldVisibleDays: 90, cardMarketplacePath: '/marketplace/pokemon/en/151/199-charizard-ex/', viewerIsOwner: false }
  it('maps states to SEO outcomes (brief 7.4)', () => {
    expect(listingPageOutcome({ ...base, status: 'active', closedAt: null })).toEqual({ kind: 'render', indexable: true, state: 'active' })
    expect(listingPageOutcome({ ...base, status: 'sold', closedAt: new Date('2026-09-01T00:00:00Z') })).toMatchObject({ kind: 'render', state: 'sold' })
    expect(listingPageOutcome({ ...base, status: 'sold', closedAt: new Date('2026-05-01T00:00:00Z') })).toEqual({ kind: 'redirect', status: 301, to: base.cardMarketplacePath })
    expect(listingPageOutcome({ ...base, status: 'rejected', closedAt: null })).toEqual({ kind: 'gone', status: 410 })
    expect(listingPageOutcome({ ...base, status: 'removed', closedAt: null })).toEqual({ kind: 'gone', status: 410 })
    expect(listingPageOutcome({ ...base, status: 'pending_review', closedAt: null })).toEqual({ kind: 'not-found', status: 404 })
    expect(listingPageOutcome({ ...base, status: 'pending_review', closedAt: null, viewerIsOwner: true })).toMatchObject({ kind: 'render', indexable: false })
  })
})

describe('Buy button', () => {
  const card: CardRef = { id: 'c1', game: 'pokemon', lang: 'en', setSlug: '151', slug: '199-charizard-ex' }
  const stats = [
    { cardId: 'c1', gradeKey: 'psa-10', activeCount: 2, lowestPriceAud: 4650 },
    { cardId: 'c1', gradeKey: 'psa-9', activeCount: 1, lowestPriceAud: 1450 },
    { cardId: 'c2', gradeKey: 'psa-10', activeCount: 5, lowestPriceAud: 10 },
  ]
  it('links to the card marketplace page sorted by price when listings exist', () => {
    const b = resolveBuyButton({ card, gradeKey: 'psa-10', stats, externalFallback: false })
    expect(b).toMatchObject({ kind: 'listings', count: 2, fromAud: 4650, href: '/marketplace/pokemon/en/151/199-charizard-ex/?sort=price-asc&grade=psa-10' })
    expect(b.label).toBe('Buy · 2 from $4,650') // component renders it with A$
  })
  it('all grades sums across grades', () => {
    expect(resolveBuyButton({ card, gradeKey: null, stats, externalFallback: false })).toMatchObject({ count: 3, fromAud: 1450 })
  })
  it('shows Set alert + Sell yours when none, with no external link unless flagged', () => {
    const b = resolveBuyButton({ card, gradeKey: 'psa-8', stats, externalFallback: false, externalUrl: 'https://ebay.example' })
    expect(b).toMatchObject({ kind: 'none', label: 'No listings yet', sellHref: '/account/listings/new/?card=c1&grade=psa-8' })
    expect('external' in b && b.external).toBeFalsy()
    const flagged = resolveBuyButton({ card, gradeKey: 'psa-8', stats, externalFallback: true, externalUrl: 'https://ebay.example' })
    expect(flagged.kind === 'none' && flagged.external?.href).toBe('https://ebay.example')
  })
  it('never counts another card (JP and EN are different card_ids)', () => {
    const jp: CardRef = { ...card, id: 'c1-jp', lang: 'jp' }
    expect(resolveBuyButton({ card: jp, gradeKey: 'psa-10', stats, externalFallback: false }).kind).toBe('none')
  })
})

describe('eBay links', async () => {
  const { ebaySearchUrl, ebaySearchQuery, DEFAULT_EBAY } = await import('@/lib/domain/ebay')
  const q = { cardId: 'c1', name: 'Charizard ex', number: '199', setName: '151', lang: 'en' as const, game: 'pokemon' as const, gradeKey: 'psa-10' }
  it('searches eBay Australia for the exact card, grade and language', () => {
    expect(ebaySearchQuery(q)).toBe('Charizard ex 199 151 PSA 10')
    expect(ebaySearchQuery({ ...q, lang: 'jp', number: '095' })).toBe('Charizard ex 95 151 Japanese PSA 10')
    const url = new URL(ebaySearchUrl(q)!)
    expect(url.host).toBe('www.ebay.com.au')
    expect(url.searchParams.get('_sacat')).toBe('183454')
    expect(url.searchParams.get('campid')).toBeNull()
  })
  it('applies EPN tracking to every card once a valid campaign id is saved', () => {
    const url = new URL(ebaySearchUrl(q, { ...DEFAULT_EBAY, affiliateEnabled: true, campaignId: '5338123456' })!)
    expect(url.searchParams.get('campid')).toBe('5338123456')
    expect(url.searchParams.get('mkrid')).toBe('705-53470-19255-0')
    expect(url.searchParams.get('customid')).toBe('tcgtrade-c1')
  })
  it('ignores an invalid campaign id and respects the off switch', () => {
    expect(new URL(ebaySearchUrl(q, { ...DEFAULT_EBAY, affiliateEnabled: true, campaignId: 'abc' })!).searchParams.get('campid')).toBeNull()
    expect(ebaySearchUrl(q, { ...DEFAULT_EBAY, enabled: false })).toBeNull()
  })
})
