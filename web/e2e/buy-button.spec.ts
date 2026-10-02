import { expect, test } from '@playwright/test'

// Runs against demo data (no Supabase needed).
test('home is server-rendered with ranked rows in the initial HTML', async ({ request }) => {
  const html = await (await request.get('/')).text()
  expect(html).toContain('data-card-id="card-pokemon-en-199"')
  expect(html).toMatch(/The graded card market, measured/)
})

test('Buy button routes to the marketplace listings for the same card and grade, cheapest first', async ({ page }) => {
  await page.goto('/?grade=psa-10')
  const row = page.locator('tr[data-card-id="card-pokemon-en-199"][data-grade="psa-10"]')
  await row.locator('[data-buy="listings"]').click()
  await expect(page).toHaveURL(/\/marketplace\/pokemon\/en\/151\/199-charizard-ex\/\?sort=price-asc&grade=psa-10$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Charizard ex')
  await expect(page.locator('.lead').first()).toContainText('2 listings in PSA 10, cheapest first')
  const prices = await page.locator('.grid-tiles .tile .num').allTextContents()
  expect(prices).toEqual(['A$4,650', 'A$4,890'])
})

test('a card with no listings offers eBay, Alert me and Sell', async ({ page }) => {
  await page.goto('/?grade=psa-10')
  const row = page.locator('tr[data-card-id="card-pokemon-jp-201"][data-grade="psa-10"]')
  const cell = row.locator('[data-buy="none"]')
  await expect(cell.getByRole('link', { name: 'Sell' })).toHaveAttribute('href', /card=card-pokemon-jp-201/)
  await expect(cell.getByRole('link', { name: 'Alert me' })).toBeVisible()
  const ebay = cell.locator('[data-buy="ebay"]')
  await expect(ebay).toHaveAttribute('href', /ebay\.com\.au\/sch\/i\.html\?_nkw=Charizard\+ex\+201\+Pok/)
  await expect(ebay).toHaveAttribute('rel', /sponsored/)
})

test('JP and EN versions are separate pages linked to each other', async ({ page }) => {
  await page.goto('/cards/pokemon/en/151/199-charizard-ex/')
  await page.getByRole('link', { name: /See the Japanese version/ }).click()
  await expect(page).toHaveURL('/cards/pokemon/jp/sv2a-pokemon-card-151/201-charizard-ex/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Charizard ex')
})

test('no horizontal page scroll at phone width', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only')
  for (const path of ['/', '/cards/pokemon/en/151/199-charizard-ex/', '/marketplace/', '/drops/', '/premium/']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
    // Mobile browsers zoom out (widen innerWidth) instead of scrolling when content overflows.
    expect(await page.evaluate(() => window.innerWidth), path).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
})
