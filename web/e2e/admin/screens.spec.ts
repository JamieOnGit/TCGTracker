import { expect, test } from '@playwright/test'
import { createUser, deleteRetailer, deleteUsers, live, pendingListing, pickCard, runId, service, signIn, testRetailer, type TestUser } from './helpers'

/**
 * Seeds a realistic data set and screenshots every admin section at phone and
 * desktop widths, checking there is no page-level horizontal scroll.
 * Run with ADMIN_SCREENSHOTS=<dir> (and E2E_SUPABASE=1).
 */
const OUT = process.env.ADMIN_SCREENSHOTS
const SECTIONS = ['', 'listings/', 'listings/?tab=live', 'mapping/', 'users/', 'reports/', 'drops/', 'settings/', 'emails/', 'audit/', 'subscriptions/', 'news/']

test.describe('admin screenshots', () => {
  test.skip(!live || !OUT, 'set E2E_SUPABASE=1 and ADMIN_SCREENSHOTS=<dir>')
  let admin: TestUser, seller: TestUser, buyer: TestUser, premium: TestUser
  let retailerSlug = ''
  const cleanup: { table: string; ids: (number | string)[] }[] = []

  test.beforeAll(async () => {
    const svc = service()
    ;[admin, seller, buyer, premium] = await Promise.all([createUser('admin', 'admin'), createUser('seller'), createUser('buyer'), createUser('prem')])
    const a = await pendingListing(seller, { price: 480 })
    await pendingListing(seller, { lang: 'jp', title: `Charizard ex SAR PSA 10 Japanese ${runId}`, price: 12, description: 'Happy to take PayPal friends and family to save fees.' })
    await pendingListing(buyer, { mismatch: true, price: 2600, cert: '87654321' })
    // One live listing for the Live tab and a reported conversation about it.
    await svc.from('listings').update({ status: 'active' }).eq('id', a.id)
    const { data: conv } = await svc.from('conversations').insert({ listing_id: a.id, buyer_id: buyer.id, seller_id: seller.id }).select('id').single()
    if (conv) {
      await svc.from('messages').insert([
        { conversation_id: conv.id, sender_id: buyer.id, body: 'Is this still available? Can you do $400?' },
        { conversation_id: conv.id, sender_id: seller.id, body: 'Yes. Pay by gift card and I will post today.' },
      ])
      await svc.from('reports').insert({ reporter_id: buyer.id, target_type: 'conversation', target_id: conv.id, reason: 'off_platform_payment', details: 'Seller asked for gift cards.' })
    }
    await svc.from('reports').insert([
      { reporter_id: buyer.id, target_type: 'listing', target_id: String(a.id), reason: 'counterfeit', details: 'Label font looks wrong on the slab.' },
      { reporter_id: seller.id, target_type: 'user', target_id: buyer.id, reason: 'spam', details: null },
    ])
    const en = await pickCard('en')
    const jp = await pickCard('jp')
    const { data: mq } = await svc.from('mapping_queue').insert([
      { source: 'pricecharting', external_id: `e2e-${runId}-1`, payload: { name: en.name, set: 'Scarlet & Violet 151', number: en.number, variant: 'standard' }, game: en.game, lang: 'en', suggested_card_id: en.id, confidence: 0.82, reasons: ['name exact', 'number exact', 'set fuzzy 0.71'] },
      { source: 'pricecharting', external_id: `e2e-${runId}-2`, payload: { name: jp.name, set: 'Pokemon Card 151', number: jp.number, variant: 'sar' }, game: jp.game, lang: 'jp', suggested_card_id: jp.id, confidence: 0.64, reasons: ['name exact', 'variant unknown'] },
      { source: 'pricecharting', external_id: `e2e-${runId}-3`, payload: { name: 'Monkey D. Luffy', set: 'OP05', number: 'OP05-119', variant: 'manga' }, game: 'one-piece', lang: 'en', confidence: null, reasons: [] },
    ]).select('id')
    cleanup.push({ table: 'mapping_queue', ids: (mq ?? []).map((r) => r.id as number) })
    await svc.from('email_outbox').insert([
      { user_id: seller.id, to_email: seller.email, template: 'listing_status', status: 'failed', attempts: 5, last_error: '550 mailbox unavailable', dedupe_key: `e2e-${runId}-1` },
      { user_id: buyer.id, to_email: buyer.email, template: 'message', status: 'sent', attempts: 1, sent_at: new Date().toISOString(), dedupe_key: `e2e-${runId}-2` },
      { user_id: buyer.id, to_email: buyer.email, template: 'drop', status: 'queued', attempts: 0, dedupe_key: `e2e-${runId}-3` },
    ])
    const now = Date.now()
    const { data: runs } = await svc.from('pipeline_runs').insert([
      { job: `e2e-prices-${runId}`, status: 'succeeded', started_at: new Date(now - 3_600_000).toISOString(), finished_at: new Date(now - 3_540_000).toISOString() },
      { job: `e2e-population-${runId}`, status: 'failed', started_at: new Date(now - 7_200_000).toISOString(), finished_at: new Date(now - 7_190_000).toISOString(), error: 'PSA API 429: rate limited, will retry' },
    ]).select('id')
    cleanup.push({ table: 'pipeline_runs', ids: (runs ?? []).map((r) => r.id as number) })
    const ret = await testRetailer(true)
    retailerSlug = ret.slug
    await svc.from('retailers').update({ consecutive_errors: 4, last_error_at: new Date().toISOString(), last_error: 'HTTP 403 from search endpoint' }).eq('slug', ret.slug)
    const { data: prod } = await svc.from('retail_products').insert({ retailer_id: ret.id, sku: `E2E-${runId}`, url: 'https://example.test/p/1', title: 'Pokémon TCG: Prismatic Evolutions Elite Trainer Box', game: 'pokemon', product_type: 'etb', set_code: 'PRE' }).select('id').single()
    if (prod) {
      await svc.from('drop_events').insert([
        { retail_product_id: prod.id, event_type: 'IN_STOCK', price_aud: 89, rrp_aud: 89, rrp_tag: 'AT_RRP', rrp_delta_pct: 0, dedupe_key: `e2e-${runId}-a` },
        { retail_product_id: prod.id, event_type: 'PRICE_CHANGE', price_aud: 179, rrp_aud: 89, rrp_tag: 'ABOVE_RRP', rrp_delta_pct: 101, dedupe_key: `e2e-${runId}-b`, suppressed: true, suppressed_reason: 'marketplace seller above RRP' },
      ])
    }
    await svc.from('subscriptions').update({ tier: 'premium', status: 'active', current_period_end: new Date(now + 20 * 86_400_000).toISOString() }).eq('user_id', premium.id)
    await svc.from('subscriptions').update({ tier: 'free', status: 'canceled' }).eq('user_id', buyer.id)
  })

  test.afterAll(async () => {
    const svc = service()
    for (const c of cleanup) if (c.ids.length) await svc.from(c.table).delete().in('id', c.ids)
    if (retailerSlug) await deleteRetailer(retailerSlug)
    await deleteUsers([admin, seller, buyer, premium])
  })

  for (const [w, h] of [[390, 844], [1440, 1000]] as const) {
    test(`every section at ${w}px`, async ({ page, context }) => {
      await page.setViewportSize({ width: w, height: h })
      await signIn(context, admin)
      for (const s of SECTIONS) {
        await page.goto(`/admin/${s}`, { waitUntil: "domcontentloaded" }).catch(() => page.goto(`/admin/${s}`))
        await expect(page.locator('.admin-main h1')).toBeVisible()
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        expect.soft(overflow, `horizontal page scroll on /admin/${s} at ${w}px`).toBeLessThanOrEqual(0)
        const name = (s || 'overview').replace(/[/?=]+/g, '-').replace(/-$/, '')
        await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true })
      }
      // The user detail page too.
      await page.goto(`/admin/users/${seller.id}/`)
      await page.screenshot({ path: `${OUT}/user-detail-${w}.png`, fullPage: true })
    })
  }
})
