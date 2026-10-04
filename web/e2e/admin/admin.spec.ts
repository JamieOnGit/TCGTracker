import { expect, test } from '@playwright/test'
import { createUser, deleteRetailer, deleteUsers, getSettings, live, pendingListing, restoreSettings, service, signIn, testRetailer, type TestUser } from './helpers'

/**
 * Admin console flows against the local Supabase stack. Everything created
 * here is uniquely named per run and deleted afterwards; global settings the
 * eBay test touches are restored.
 */
test.describe('admin console', () => {
  test.skip(!live, 'set E2E_SUPABASE=1 with the local Supabase stack and a dev server on :3402')
  test.describe.configure({ mode: 'serial' })

  let admin: TestUser, moderator: TestUser, member: TestUser, seller: TestUser
  let retailerSlug = ''
  const EBAY_KEYS = ['ebay.enabled', 'ebay.affiliate_enabled', 'ebay.campaign_id', 'ebay.custom_id', 'features.external_buy_fallback']
  let savedSettings: { key: string; value: unknown }[] = []

  test.beforeAll(async () => {
    ;[admin, moderator, member, seller] = await Promise.all([createUser('admin', 'admin'), createUser('mod', 'moderator'), createUser('member'), createUser('seller')])
    savedSettings = await getSettings(EBAY_KEYS)
    retailerSlug = (await testRetailer(true)).slug
  })

  test.afterAll(async () => {
    if (savedSettings.length) restoreSettings(savedSettings)
    if (retailerSlug) await deleteRetailer(retailerSlug)
    await deleteUsers([admin, moderator, member, seller])
  })

  test('signed-out visitors go to login; members without a staff role are sent home', async ({ page, context }) => {
    await page.goto('/admin/listings/')
    await expect(page).toHaveURL(/\/login\/\?next=/)
    await signIn(context, member)
    await page.goto('/admin/')
    await expect(page).toHaveURL(/localhost:\d+\/$/)
    await page.goto('/admin/settings/')
    await expect(page).toHaveURL(/localhost:\d+\/$/)
  })

  test('a moderator only sees their sections, and admin-only pages bounce to the overview', async ({ page, context }) => {
    await signIn(context, moderator)
    await page.goto('/admin/')
    const nav = page.getByRole('navigation', { name: 'Admin sections' })
    await expect(nav.getByRole('link', { name: /Listings/ })).toBeVisible()
    await expect(nav.getByRole('link', { name: /Reports/ })).toBeVisible()
    await expect(nav.getByRole('link', { name: /Settings/ })).toHaveCount(0)
    await page.goto('/admin/settings/')
    await expect(page).toHaveURL(/\/admin\/$/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })

  test('moderator approves a pending listing: it goes live and the seller is emailed', async ({ page, context, request }) => {
    const listing = await pendingListing(seller)
    await signIn(context, moderator)
    await page.goto('/admin/listings/')
    const item = page.locator(`li[data-listing-id="${listing.id}"]`)
    await expect(item).toBeVisible()
    await expect(item.locator('.lang-tag')).toContainText('English')
    await expect(item.locator('img')).toHaveCount(2)
    await item.getByRole('button', { name: 'Approve', exact: true }).click()
    // The page re-renders after the action, and the approved listing leaves the queue.
    await expect(item).toHaveCount(0)
    await expect.poll(async () => (await service().from('listings').select('status').eq('id', listing.id).single()).data?.status).toBe('active')
    const res = await request.get(`/marketplace/listing/${listing.id}/`)
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain(listing.title)

    const { data: mail } = await service().from('email_outbox').select('template,data').eq('user_id', seller.id).eq('template', 'listing_status')
    expect(mail?.length).toBeGreaterThan(0)
  })

  test('admin saves an eBay campaign id and every card link on the homepage carries it', async ({ page, context }) => {
    const campaign = String(5_000_000_000 + Math.floor(Math.random() * 999_999_999)).slice(0, 10)
    await signIn(context, admin)
    await page.goto('/admin/settings/')
    const panel = page.locator('#ebay')
    await panel.getByLabel('Show the eBay fallback link').check()
    await panel.getByLabel(/Add affiliate tracking/).check()
    await panel.getByLabel('EPN Campaign ID').fill(campaign)
    await expect(panel.getByTestId('ebay-preview')).toContainText(`campid=${campaign}`)
    await panel.getByRole('button', { name: 'Save eBay settings' }).click()
    await expect(panel.getByRole('status')).toContainText('Affiliate tracking is on')

    // features.external_buy_fallback must be on for the fallback to render at all.
    await service().from('site_settings').update({ value: true }).eq('key', 'features.external_buy_fallback')
    await page.goto('/')
    const link = page.locator('[data-buy="ebay"]').first()
    await expect(link).toHaveAttribute('href', new RegExp(`campid=${campaign}`))

    // Clearing the id and switching tracking off works too (jsonb NOT NULL column).
    await page.goto('/admin/settings/')
    await panel.getByLabel(/Add affiliate tracking/).uncheck()
    await panel.getByLabel('EPN Campaign ID').fill('')
    await panel.getByRole('button', { name: 'Save eBay settings' }).click()
    await expect(panel.getByRole('status')).toContainText('Affiliate tracking is off')
    await page.goto('/')
    await expect(page.locator('[data-buy="ebay"]').first()).not.toHaveAttribute('href', /campid=/)
  })

  test('admin disables a retailer', async ({ page, context }) => {
    await signIn(context, admin)
    await page.goto('/admin/drops/')
    const sw = page.locator(`tr[data-retailer="${retailerSlug}"]`).getByRole('switch')
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    const { data } = await service().from('retailers').select('enabled').eq('slug', retailerSlug).single()
    expect(data?.enabled).toBe(false)
  })

  test('admin sees image coverage and sets a missing image by hand', async ({ page, context }) => {
    await signIn(context, admin)
    await page.goto('/admin/images/')
    await expect(page.getByRole('heading', { level: 1, name: 'Images' })).toBeVisible()
    await expect(page.locator('[data-coverage="cards"]')).toHaveText(/%|—/)
    const item = page.locator('[data-missing]').first()
    test.skip((await item.count()) === 0, 'every product already has an image')
    const input = item.locator('input[type="url"]')
    const id = (await input.getAttribute('id'))!.replace('img-', '')
    const kind = await item.getAttribute('data-missing')
    const table = kind === 'card' ? 'cards' : 'sealed_products'
    try {
      await input.fill('https://images.example.com/hand-set.webp')
      await item.getByRole('button', { name: 'Save' }).click()
      // Saved as a hand-set image; the page refreshes and the product leaves the missing list.
      await expect
        .poll(async () => (await service().from(table).select('image_url,image_source').eq('id', id).single()).data)
        .toEqual({ image_url: 'https://images.example.com/hand-set.webp', image_source: 'manual' })
      await expect(page.locator(`#img-${id}`)).toHaveCount(0)
    } finally {
      await service().from(table).update({ image_url: null, image_source: null }).eq('id', id)
    }
  })

  test('the audit log shows who did what', async ({ page, context }) => {
    await signIn(context, admin)
    await page.goto(`/admin/audit/?actor=${admin.id}`)
    await expect(page.locator('tr[data-action="retailers.update"]').first()).toContainText(admin.username)
    await expect(page.locator('tr[data-action="site_settings.update"]').first()).toBeVisible()
    await page.goto(`/admin/audit/?actor=${moderator.id}&target=listings`)
    const row = page.locator('tr[data-action="listings.update"]').first()
    await expect(row).toContainText(moderator.username)
    await expect(row).toContainText('pending_review')
  })
})
