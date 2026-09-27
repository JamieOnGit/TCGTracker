import { expect, test } from '@playwright/test'

// Runs against demo data (no Supabase needed).
test('home is server-rendered with ranked rows in the initial HTML', async ({ request }) => {
  const html = await (await request.get('/')).text()
  expect(html).toContain('data-card-id="card-pokemon-en-199"')
  expect(html).toMatch(/Market cap/)
})

test('Buy button routes to the marketplace listings for the same card and grade, cheapest first', async ({ page }) => {
  await page.goto('/')
  const row = page.locator('tr[data-card-id="card-pokemon-en-199"][data-grade="psa-10"]')
  await row.locator('[data-buy="listings"]').click()
  await expect(page).toHaveURL(/\/marketplace\/pokemon\/en\/151\/199-charizard-ex\/\?sort=price-asc&grade=psa-10$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2 listings for Charizard ex 199')
  const prices = await page.locator('ul.listings li strong').allTextContents()
  expect(prices).toEqual(['$4,650', '$4,890'])
})

test('a card with no listings offers Set alert and Sell yours', async ({ page }) => {
  await page.goto('/')
  const row = page.locator('tr[data-card-id="card-pokemon-jp-201"][data-grade="psa-10"]')
  await expect(row.locator('[data-buy="none"]')).toContainText('No listings yet')
  await expect(row.getByRole('link', { name: 'Sell yours' })).toHaveAttribute('href', /card=card-pokemon-jp-201/)
})

test('JP and EN versions are separate pages linked to each other', async ({ page }) => {
  await page.goto('/cards/pokemon/en/151/199-charizard-ex/')
  await page.getByRole('link', { name: /See the Japanese version/ }).click()
  await expect(page).toHaveURL('/cards/pokemon/jp/sv2a-pokemon-card-151/201-charizard-ex/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('JP')
})

test('no horizontal page scroll at phone width', async ({ page }) => {
  await page.goto('/')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
