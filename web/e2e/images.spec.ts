import { expect, test } from '@playwright/test'

// Runs against demo data: one card and one sealed product have (local) catalogue images.
const ld = async (page: import('@playwright/test').Page, type: string) =>
  page.locator('script[type="application/ld+json"]').evaluateAll(
    (els, t) => els.map((e) => JSON.parse(e.textContent ?? '{}')).find((d) => d['@type'] === t),
    type,
  )

test('product pages show the catalogue image with credit, and Product JSON-LD carries an absolute image URL', async ({ page }) => {
  await page.goto('/products/pokemon/en/demo-expansion-elite-trainer-box/')
  const img = page.locator('img[data-product-image]')
  await expect(img).toBeVisible() // on phones too
  await expect(img).toHaveAttribute('alt', /Demo expansion Elite Trainer Box/)
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByText('Image © The Pokémon Company')).toBeVisible()
  const product = await ld(page, 'Product')
  expect(String(product?.image)).toMatch(/^https?:\/\/[^/]+\/demo\/sealed\.webp$/)
})

test('product cards, card pages and the rankings use catalogue images; others keep the placeholder', async ({ page }) => {
  await page.goto('/drops/in-stock/')
  await expect(page.locator('article[data-product="demo-expansion-elite-trainer-box"] img.thumb')).toHaveAttribute('src', '/demo/sealed.webp')
  await expect(page.locator('article[data-product="demo-premium-booster-box"] [data-placeholder]')).toBeVisible()
  // The default image is the TCGTracker mark, never a 'coming soon' message.
  await expect(page.getByText(/coming soon/i)).toHaveCount(0)

  await page.goto('/cards/pokemon/en/151/199-charizard-ex/')
  await expect(page.locator('img[src="/demo/card.webp"]').first()).toBeVisible()
  const product = await ld(page, 'Product')
  expect(String(product?.image)).toMatch(/\/demo\/card\.webp$/)

  await page.goto('/')
  await expect(page.locator('tr[data-card-id="card-pokemon-en-199"] img.thumb')).toHaveAttribute('src', '/demo/card.webp')
})
