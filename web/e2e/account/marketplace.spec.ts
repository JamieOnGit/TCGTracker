import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { live, png, rest, signIn, uniq } from './helpers'

/**
 * The owner's #1 rule: marketplace, messaging and email alerts work end to end.
 * Runs against the live local Supabase stack (E2E_SUPABASE=1): real magic-link
 * sign-in via Mailpit, real Storage uploads, real RLS, triggers and Realtime.
 */
// Card ids differ on every `supabase db reset`, so look them up by their natural key.
let CHARIZARD_EN = '' // Charizard ex 199 · 151 (EN)
let UMBREON_JP = '' // Umbreon VMAX 095 · Eevee Heroes (JP)
async function cardId(lang: string, number: string): Promise<string> {
  const rows = await rest<{ id: string }[]>('GET', `cards?select=id&lang=eq.${lang}&number=eq.${encodeURIComponent(number)}&limit=1`)
  if (!rows[0]) throw new Error(`seed card ${lang} ${number} missing — run supabase db reset`)
  return rows[0].id
}

test.describe.configure({ mode: 'serial' })
test.skip(!live, 'set E2E_SUPABASE=1 with the local Supabase stack running (supabase start)')

const run = uniq('e2e')
const seller = { email: `${run}-seller@example.test`, username: `s${run.replace(/[^a-z0-9]/g, '').slice(-14)}` }
const buyer = { email: `${run}-buyer@example.test` }
let sellerCtx: BrowserContext
let buyerCtx: BrowserContext
let sellerPage: Page
let buyerPage: Page
let listingId = 0
let conversationId = ''

test.beforeAll(async ({ browser }) => {
  CHARIZARD_EN = await cardId('en', '199')
  UMBREON_JP = await cardId('jp', '095')
  sellerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  buyerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  sellerPage = await sellerCtx.newPage()
  buyerPage = await buyerCtx.newPage()
})

test.afterAll(async () => {
  await sellerCtx?.close()
  await buyerCtx?.close()
})

test('seller signs in with a magic link and sets up their profile and notification preferences', async () => {
  const page = sellerPage
  await signIn(page, seller.email, '/account/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText("G'day")
  await expect(page.getByTestId('quota-line')).toContainText('0 of 5 listings used this month · resets 1 Oct')

  await page.goto('/account/settings/')
  await page.getByLabel('Username').fill(seller.username)
  await page.getByLabel('State', { exact: true }).selectOption('VIC')
  await page.getByLabel('Postcode (private)').fill('3000')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Profile saved.')).toBeVisible()

  // Preferences centre: opt in to the weekly digest, turn off on-site listing-status alerts.
  const digest = page.getByRole('checkbox', { name: 'Weekly market digest by email' })
  await expect(digest).not.toBeChecked()
  await digest.check()
  await page.getByRole('checkbox', { name: 'Listing about to expire by on-site' }).uncheck()
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByText('Preferences saved.')).toBeVisible()
  const profile = await rest<{ id: string }[]>('GET', `profiles?select=id&username=eq.${seller.username}`)
  expect(profile).toHaveLength(1)
  const prefs = await rest<{ alert_type: string; channel: string; enabled: boolean }[]>('GET', `notification_preferences?select=alert_type,channel,enabled&user_id=eq.${profile[0]!.id}`)
  expect(prefs.find((p) => p.alert_type === 'weekly_digest' && p.channel === 'email')?.enabled).toBe(true)
  expect(prefs.find((p) => p.alert_type === 'listing_expiring' && p.channel === 'onsite')?.enabled).toBe(false)
  expect(prefs.find((p) => p.alert_type === 'message' && p.channel === 'email')?.enabled).toBe(true)
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Weekly market digest by email' })).toBeChecked()
})

test('seller creates a draft with two photos and submits it for review', async () => {
  const page = sellerPage
  await page.goto(`/account/listings/new/?card=${CHARIZARD_EN}&grade=psa-10`)
  // (a) item: prefilled from the Buy button's "Sell yours" link, EN clearly labelled
  await expect(page.getByTestId('selected-item')).toContainText('Charizard ex')
  await expect(page.getByTestId('selected-item')).toContainText('EN · English')
  // search still works and shows both languages
  await page.getByLabel('Search the card catalogue').fill('charizard 151')
  await expect(page.getByRole('list', { name: 'Matching cards' })).toContainText('JP · Japanese')
  await expect(page.getByRole('list', { name: 'Matching cards' })).toContainText('EN · English')
  await page.locator(`[data-card-id="${CHARIZARD_EN}"]`).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  // (b) grading: PSA 10 prefilled
  await expect(page.getByLabel('Grading company')).toHaveValue('PSA')
  await expect(page.getByLabel('Grade', { exact: true })).toHaveValue('10')
  await page.getByLabel(/Cert number/).fill('12345678')
  await page.getByRole('button', { name: 'Continue' }).click()
  // (d) price & delivery; title is suggested
  await expect(page.getByLabel('Title')).toHaveValue('Charizard ex 199 · 151 · EN · PSA 10')
  await page.getByLabel('Price (A$)').fill('1450')
  await expect(page.getByLabel('State')).toHaveValue('VIC')
  await page.getByLabel('Description').fill('Clean slab, sharp corners. Ships in a bubble mailer inside a box.')
  await page.getByRole('button', { name: 'Save draft & add photos' }).click()
  // (c) photos: direct upload to Storage
  await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible()
  await page.getByTestId('upload-slab-front').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: png(120, 168, [200, 40, 40]) })
  await expect(page.locator('.photo-slot[data-kind="slab-front"] img')).toBeVisible()
  await page.getByTestId('upload-slab-back').setInputFiles({ name: 'back.png', mimeType: 'image/png', buffer: png(120, 168, [40, 40, 200]) })
  await expect(page.locator('.photo-slot[data-kind="slab-back"] img')).toBeVisible()
  await expect(page.getByText('✓ Photos ready')).toBeVisible()
  const url = new URL(page.url())
  expect(url.pathname).toBe('/account/listings/new/')
  // (e) review & submit
  await page.getByRole('button', { name: 'Review listing' }).click()
  await expect(page.getByText('A$1450.00')).toBeVisible()
  await page.getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.getByTestId('submit-success')).toBeVisible()
  await expect(page.getByTestId('quota-line')).toContainText('1 of 5 listings used this month')

  await page.goto('/account/listings/')
  const row = page.locator('[data-testid="my-listings"] tbody tr').first()
  await expect(row).toContainText('Charizard ex 199')
  await expect(row.locator('.chip-status')).toHaveText('Pending review')
  listingId = Number(await row.getAttribute('data-listing-id'))
  expect(listingId).toBeGreaterThan(100000)

  // Stored photos are WebP, resized in the browser, with dimensions recorded.
  const imgs = await rest<{ kind: string; mime_type: string; width: number; height: number; bytes: number; storage_path: string }[]>('GET', `listing_images?select=kind,mime_type,width,height,bytes,storage_path&listing_id=eq.${listingId}`)
  expect(imgs.map((i) => i.kind).sort()).toEqual(['slab-back', 'slab-front'])
  for (const i of imgs) {
    expect(i.mime_type).toBe('image/webp')
    expect(i.width).toBe(120)
    expect(i.height).toBe(168)
    expect(i.bytes).toBeGreaterThan(0)
    expect(i.storage_path).toMatch(new RegExp(`^[0-9a-f-]{36}/${listingId}/[0-9a-f-]{36}\\.webp$`))
  }
})

test('buyer sets a wishlist alert from the Buy button link', async () => {
  const page = buyerPage
  await signIn(page, buyer.email, `/account/alerts/new/?card=${UMBREON_JP}&grade=psa-10`)
  await expect(page.getByText('JP · Japanese')).toBeVisible()
  await expect(page.getByLabel('Grade')).toHaveValue('psa-10')
  await page.getByLabel(/Maximum price/).fill('900')
  await page.getByRole('button', { name: /Notify me when it/ }).click()
  await expect(page.getByTestId('alert-set')).toBeVisible()
  await page.goto('/account/alerts/')
  await expect(page.getByTestId('wishlist')).toContainText('Umbreon VMAX 095')
  await expect(page.getByTestId('wishlist')).toContainText('PSA 10 · up to A$900')
  await expect(page.getByText('Free plan: alerts arrive 24 hours after the drop.')).toBeVisible()
})

test('buyer messages the seller; both inboxes show the thread; Realtime delivers without reload; email queued', async () => {
  // A moderator approves the listing (service role = system actor in the lifecycle trigger).
  const approved = await rest<{ status: string }[]>('PATCH', `listings?id=eq.${listingId}`, { status: 'active' })
  expect(approved[0]?.status).toBe('active')

  // Buyer: "Message seller" link from the public listing page.
  await buyerPage.goto(`/messages/new/?listing=${listingId}`)
  await expect(buyerPage.getByRole('heading', { name: 'Message the seller' })).toBeVisible()
  await expect(buyerPage.getByText('Contact details are hidden — keep payment on-platform.')).toBeVisible()
  await buyerPage.getByLabel(/Message to @/).fill('Hi! Is the Charizard still available? Could you post to 2000?')
  await buyerPage.getByRole('button', { name: 'Send message' }).click()
  await buyerPage.waitForURL(/\/messages\/[0-9a-f-]{36}\/$/)
  conversationId = buyerPage.url().split('/').filter(Boolean).pop()!
  await expect(buyerPage.getByTestId('thread')).toContainText('Is the Charizard still available?')
  await expect(buyerPage.getByTestId('listing-header')).toContainText('A$1,450.00')

  // Seller: inbox shows the thread with an unread badge.
  await sellerPage.goto('/messages/')
  const convo = sellerPage.locator(`[data-conversation-id="${conversationId}"]`)
  await expect(convo).toContainText('Charizard ex 199')
  await expect(convo.getByTestId('unread-badge')).toHaveText('1')
  await convo.click()
  await expect(sellerPage.getByTestId('thread')).toContainText('Is the Charizard still available?')
  await expect(sellerPage.getByTestId('live-status')).toHaveText('Live')
  await expect(buyerPage.getByTestId('live-status')).toHaveText('Live')

  // Seller replies; buyer's open page receives it via Realtime (no reload).
  const buyerNavs: string[] = []
  buyerPage.on('framenavigated', (f) => f === buyerPage.mainFrame() && buyerNavs.push(f.url()))
  await sellerPage.getByLabel(/Message @/).fill('Yes it is! Tracked post to 2000 is A$12.')
  await sellerPage.getByRole('button', { name: 'Send message' }).click()
  await expect(sellerPage.getByTestId('thread')).toContainText('Tracked post to 2000 is A$12.')
  await expect(buyerPage.getByTestId('thread')).toContainText('Tracked post to 2000 is A$12.', { timeout: 10_000 })
  // Buyer replies with a photo; seller sees it live too.
  await buyerPage.getByTestId('attach-input').setInputFiles({ name: 'offer.png', mimeType: 'image/png', buffer: png(64, 64, [20, 160, 90]) })
  await expect(buyerPage.getByText(/Photo ready/)).toBeVisible()
  await buyerPage.getByLabel(/Message @/).fill('Great, here is my return address label area.')
  await buyerPage.getByRole('button', { name: 'Send message' }).click()
  await expect(sellerPage.getByTestId('thread')).toContainText('here is my return address', { timeout: 10_000 })
  await expect(sellerPage.locator('[data-testid="thread"] img.att-img')).toBeVisible()
  expect(buyerNavs).toHaveLength(0)

  // Buyer's inbox lists the thread too.
  await buyerPage.goto('/messages/')
  await expect(buyerPage.locator(`[data-conversation-id="${conversationId}"]`)).toContainText('Charizard ex 199')

  // The seller's new-message email is queued (batched per conversation) in the outbox.
  const outbox = await rest<{ template: string; to_email: string; data: { conversation_id: string; url: string } }[]>(
    'GET',
    `email_outbox?select=template,to_email,data&to_email=eq.${encodeURIComponent(seller.email)}&template=eq.message`,
  )
  expect(outbox.length).toBeGreaterThanOrEqual(1)
  expect(outbox[0]!.data.conversation_id).toBe(conversationId)
  expect(outbox[0]!.data.url).toBe(`/messages/${conversationId}/`)
  // Listing-approved email and on-site notification for the seller.
  const approvedMail = await rest<unknown[]>('GET', `email_outbox?select=id&to_email=eq.${encodeURIComponent(seller.email)}&template=eq.listing_status`)
  expect(approvedMail.length).toBe(1)
  await sellerPage.goto('/account/notifications/')
  await expect(sellerPage.getByTestId('notifications')).toContainText('Your listing is live')
  await expect(sellerPage.getByTestId('notifications')).toContainText('New message about')
})

test('seller marks the listing sold; buyer can report the conversation', async () => {
  await sellerPage.goto('/account/listings/')
  sellerPage.once('dialog', (d) => d.accept())
  const row = sellerPage.locator(`tr[data-listing-id="${listingId}"]`)
  await row.getByRole('button', { name: 'Mark sold' }).click()
  await expect(row.locator('.chip-status')).toHaveText('Sold')

  await buyerPage.goto(`/report/?conversation=${conversationId}`)
  await buyerPage.getByLabel(/Pushing an unprotected payment/).check()
  await buyerPage.getByLabel(/Details/).fill('e2e test report')
  await buyerPage.getByRole('button', { name: 'Send report' }).click()
  await expect(buyerPage.getByTestId('report-done')).toBeVisible()
})

test('screenshots of every member screen at 390px and 1440px', async () => {
  test.setTimeout(300_000)
  const shots: [Page, string, string][] = [
    [sellerPage, 'dashboard', '/account/'],
    [sellerPage, 'listings', '/account/listings/'],
    [sellerPage, 'listing-new', `/account/listings/new/?card=${CHARIZARD_EN}&grade=psa-10`],
    [buyerPage, 'alerts', '/account/alerts/'],
    [buyerPage, 'alert-new', `/account/alerts/new/?card=${UMBREON_JP}&grade=psa-10`],
    [sellerPage, 'settings', '/account/settings/'],
    [sellerPage, 'billing', '/account/billing/'],
    [sellerPage, 'upgrade', '/account/billing/upgrade/'],
    [sellerPage, 'notifications', '/account/notifications/'],
    [sellerPage, 'inbox', '/messages/'],
    [sellerPage, 'thread', `/messages/${conversationId}/`],
    [buyerPage, 'report', `/report/?listing=${listingId}`],
  ]
  for (const width of [390, 1440]) {
    for (const [page, name, path] of shots) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto(path)
      await page.waitForLoadState('load')
      await page.waitForTimeout(400)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${name} at ${width}px scrolls horizontally`).toBeLessThanOrEqual(0)
      await page.screenshot({ path: `test-results/account/screens/${name}-${width}.png`, fullPage: true })
    }
  }
  const anon = await sellerPage.context().browser()!.newPage()
  for (const width of [390, 1440]) {
    await anon.setViewportSize({ width, height: 844 })
    await anon.goto('/login/?next=/account/')
    await anon.screenshot({ path: `test-results/account/screens/login-${width}.png`, fullPage: true })
  }
  await anon.close()
})
