import { expect, test } from '@playwright/test'

// Runs against demo data (no Supabase needed).
test('drops hub shows the member sighting row, state links and the report CTA', async ({ page }) => {
  await page.goto('/drops/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Restocks & pre-orders')
  const sighting = page.locator('li[data-source="member"]', { hasText: 'Pokémon TCG booster bundles (demo sighting)' })
  await expect(sighting).toContainText('Member sighting')
  await expect(sighting).toContainText('Kmart Chadstone, VIC')
  await expect(sighting).toContainText('Limit 2 per customer')
  await expect(sighting).toContainText('Confirmed by 3 members')
  await expect(sighting.locator('a[target="_blank"]')).toHaveCount(0) // in store: no outbound link
  await expect(page.locator('li[data-source="member"][data-gone]')).toContainText('Reported sold out')
  await expect(page.locator('li[data-source="monitor"] a[target="_blank"]').first()).toHaveAttribute('rel', 'nofollow noopener')
  await expect(page.getByRole('navigation', { name: 'By state' }).getByRole('link')).toHaveCount(8)
  await expect(page.getByRole('link', { name: 'Seen stock in store? Report it' })).toHaveAttribute('href', '/account/sightings/')
  await expect(page.getByRole('navigation', { name: 'Member sightings' })).toContainText('Toymate')
})

test('?source=member is a noindex view canonicalised to /drops/', async ({ page }) => {
  await page.goto('/drops/?source=member')
  await expect(page.locator('li[data-source="monitor"]')).toHaveCount(0)
  await expect(page.locator('li[data-source="member"]').first()).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/drops\/$/)
})

test('state, retailer and scouts pages render', async ({ page }) => {
  await page.goto('/drops/vic/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Restocks in Victoria')
  await expect(page.locator('li[data-source="member"]')).toContainText('Kmart Chadstone, VIC')

  await page.goto('/drops/kmart/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kmart restocks & pre-orders')
  await expect(page.locator('li[data-source="member"]')).toContainText('Chadstone')

  await page.goto('/drops/toymate/')
  await expect(page.locator('.lead').first()).toContainText("We don't monitor Toymate online")
  await expect(page.getByRole('link', { name: 'Seen stock in store? Report it' })).toBeVisible()

  await page.goto('/drops/scouts/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('TCGTracker Scouts')
  await expect(page.getByRole('table').first()).toContainText('demo-scout')
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents()
  expect(jsonLd.filter((j) => j.includes('"FAQPage"'))).toHaveLength(1)
})

test('unknown drops slug is a 404', async ({ request }) => {
  expect((await request.get('/drops/not-a-retailer/')).status()).toBe(404)
})

test('drops pages have no horizontal scroll at phone width', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only')
  for (const path of ['/drops/', '/drops/vic/', '/drops/kmart/', '/drops/scouts/']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})
