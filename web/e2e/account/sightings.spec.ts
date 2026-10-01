import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { authUserId, live, png, rest, signIn, uniq } from './helpers'

/**
 * Member sightings end to end, against the live local Supabase stack
 * (E2E_SUPABASE=1): a Free member reports stock in store with a photo, a
 * Premium member (set up through the drop-alert wizard) confirms it, the
 * sighting becomes a drop event, and the alert lands in the Premium member's
 * notifications once the drops dispatcher runs (the Python worker, run once).
 * Set E2E_SKIP_WORKERS=1 to stop at the queued delivery.
 */
test.describe.configure({ mode: 'serial' })
test.skip(!live, 'set E2E_SUPABASE=1 with the local Supabase stack running (supabase start)')

const run = uniq('e2e')
const scout = { email: `${run}-scout@example.test` }
const premium = { email: `${run}-premium@example.test` }
// Unique per run so the 3-hour merge window never folds this report into an older one.
const suburb = `Testvale ${run.slice(-6)}`
const product = `Prismatic Evolutions Elite Trainer Box ${run.slice(-4)}`
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

let scoutCtx: BrowserContext
let premiumCtx: BrowserContext
let scoutPage: Page
let premiumPage: Page
let premiumId = ''
let sightingId = 0

test.beforeAll(async ({ browser }) => {
  scoutCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  premiumCtx = await browser.newContext({ viewport: { width: 390, height: 844 } }) // phone-sized: the wizard must work there
  scoutPage = await scoutCtx.newPage()
  premiumPage = await premiumCtx.newPage()
})

test.afterAll(async () => {
  await scoutCtx?.close()
  await premiumCtx?.close()
})

test('a Free member reports an in-store sighting with a photo', async () => {
  const page = scoutPage
  await signIn(page, scout.email, '/account/')
  // New members are nudged to set up drop alerts.
  await expect(page.getByTestId('drop-setup-card')).toBeVisible()

  await page.goto('/account/sightings/')
  await expect(page.getByRole('heading', { level: 1, name: 'Report a sighting' })).toBeVisible()
  // Free members can't see or confirm pending reports: they get the Premium explainer.
  await expect(page.getByTestId('needs-confirming')).toContainText('Premium members confirm reports')

  const form = page.getByRole('form', { name: 'Report a sighting' })
  await form.getByLabel('Retailer', { exact: true }).selectOption('kmart')
  await form.getByLabel('Product', { exact: true }).fill(product)
  await form.getByLabel('State', { exact: true }).selectOption('VIC')
  await form.getByLabel('Suburb', { exact: true }).fill(suburb)
  await form.getByLabel(/^Price/).fill('89.95')
  await form.getByLabel(/^How many/).selectOption('some')
  await form.getByLabel(/^Purchase limit/).fill('2')
  await form.getByLabel('When did you see it?').selectOption('15m')
  await form.getByLabel(/^Photo/).setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: png(640, 480, [200, 60, 90]) })
  await form.getByLabel(/^Note/).fill('End cap near the registers')
  await form.getByRole('button', { name: 'Send report' }).click()

  const result = page.getByTestId('sighting-result')
  await expect(result).toHaveAttribute('data-outcome', 'pending')
  await expect(result).toContainText('waiting for another member to confirm')

  const rows = await rest<{ id: number; status: string; photo_path: string | null; state: string; quantity: string; purchase_limit: number; price_aud: number }[]>(
    'GET',
    `sightings?select=id,status,photo_path,state,quantity,purchase_limit,price_aud&suburb=eq.${encodeURIComponent(suburb)}`,
  )
  expect(rows).toHaveLength(1)
  sightingId = rows[0]!.id
  expect(rows[0]).toMatchObject({ status: 'pending', state: 'VIC', quantity: 'some', purchase_limit: 2 })
  expect(Number(rows[0]!.price_aud)).toBe(89.95)
  expect(rows[0]!.photo_path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]+\.(webp|png)$/)

  await page.reload()
  await expect(page.getByTestId('my-sightings').locator(`[data-sighting="${sightingId}"]`)).toContainText('Waiting for confirmation')
})

test('a Premium member sets up drop alerts with the wizard', async () => {
  const page = premiumPage
  await signIn(page, premium.email, '/account/')
  premiumId = await authUserId(premium.email)
  await rest('PATCH', `profile_private?user_id=eq.${premiumId}`, { tier_override: 'premium' })

  await page.goto('/account/alerts/drops/')
  const form = page.getByRole('form', { name: 'Drop alert setup' })
  await expect(form).toContainText('Premium: instant alerts')
  await form.getByRole('checkbox', { name: 'All of Australia' }).uncheck()
  await form.getByRole('checkbox', { name: 'Victoria' }).check()
  await form.getByLabel(/^Keywords/).fill('elite trainer box')
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(form.getByRole('button', { name: 'Remove keyword elite trainer box' })).toBeVisible()
  await form.getByRole('checkbox', { name: 'Email' }).uncheck()
  await form.getByRole('button', { name: 'Finish setup' }).click()
  await expect(page.getByTestId('drop-setup-status')).toContainText('Drop alerts saved')

  const f = await rest<{ states: string[]; keywords: string[]; onboarded_at: string | null }[]>('GET', `drop_alert_filters?select=states,keywords,onboarded_at&user_id=eq.${premiumId}`)
  expect(f[0]).toMatchObject({ states: ['VIC'], keywords: ['elite trainer box'] })
  expect(f[0]!.onboarded_at).not.toBeNull()
  const prefs = await rest<{ channel: string; enabled: boolean }[]>('GET', `notification_preferences?select=channel,enabled&alert_type=eq.drop&user_id=eq.${premiumId}`)
  expect(Object.fromEntries(prefs.map((p) => [p.channel, p.enabled]))).toEqual({ email: false, onsite: true, push: true, discord: false })

  // The test alert lands in the member's own notifications.
  await form.getByRole('button', { name: 'Send me a test alert' }).click()
  await expect(form.getByText(/Sent — check Notifications/)).toBeVisible()

  await page.goto('/account/')
  await expect(page.getByTestId('drop-setup-card')).toHaveCount(0)
})

test('the Premium member confirms it and gets the alert', async () => {
  const page = premiumPage
  await page.goto('/account/sightings/?state=vic')
  const row = page.getByTestId('needs-confirming').locator(`[data-sighting="${sightingId}"]`)
  await expect(row).toContainText(product)
  await expect(row).toContainText('limit 2')
  await row.getByRole('button', { name: `Confirm: ${product}` }).click()
  // The row leaves the queue as soon as the page refreshes, so check the database rather than the toast.
  await expect.poll(async () => (await rest<{ status: string }[]>('GET', `sightings?select=status&id=eq.${sightingId}`))[0]?.status).toBe('confirmed')

  // One confirmation is enough with a photo: it is now a normal drop event.
  const s = await rest<{ status: string; drop_event_id: number | null; confirm_count: number }[]>('GET', `sightings?select=status,drop_event_id,confirm_count&id=eq.${sightingId}`)
  expect(s[0]).toMatchObject({ status: 'confirmed', confirm_count: 1 })
  const eventId = s[0]!.drop_event_id
  expect(eventId).not.toBeNull()
  const deliveries = await rest<{ channel: string; tier_at_enqueue: string; status: string }[]>(
    'GET',
    `drop_alert_deliveries?select=channel,tier_at_enqueue,status&drop_event_id=eq.${eventId}&user_id=eq.${premiumId}`,
  )
  // Email was switched off in the wizard; push has no subscription on this browser.
  expect(deliveries.map((d) => d.channel).sort()).toEqual(['onsite'])
  expect(deliveries[0]!.tier_at_enqueue).toBe('premium')

  // Confirmed reports leave the queue.
  await page.reload()
  await expect(page.getByTestId('needs-confirming').locator(`[data-sighting="${sightingId}"]`)).toHaveCount(0)

  if (process.env.E2E_SKIP_WORKERS === '1') return
  execFileSync('uv', ['run', '--frozen', 'python', '-m', 'tcgworkers.main', '--once', 'drops_dispatch'], {
    cwd: fileURLToPath(new URL('../../../workers/', import.meta.url)),
    env: { ...process.env, DATABASE_URL },
    stdio: 'inherit',
    timeout: 120_000,
  })
  await page.goto('/account/notifications/')
  await expect(page.getByRole('main')).toContainText(product)
})

test('the scout hears their report was confirmed', async () => {
  const page = scoutPage
  await page.goto('/account/sightings/')
  await expect(page.getByTestId('my-sightings').locator(`[data-sighting="${sightingId}"]`)).toContainText('Confirmed')
  await expect(page.getByTestId('reward-progress')).toContainText('1 of 10 confirmed sightings')
  await page.goto('/account/notifications/')
  await expect(page.getByRole('main')).toContainText('Your sighting was confirmed')
})
