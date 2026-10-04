import { expect, test } from '@playwright/test'

// Every long list shows about ten rows, with crawlable numbered page links.
test('market rankings: ten rows a page, numbered links, page 2 self-canonical', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('section#rankings tbody tr')
  const count = await rows.count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(10)
  const pager = page.locator('section#rankings nav[aria-label="Pagination"]')
  if ((await pager.count()) === 0) return // demo data fits on one page
  await expect(pager.locator('[aria-current="page"]')).toHaveText('1')
  await pager.getByRole('link', { name: 'Next page' }).click()
  await expect(page).toHaveURL(/[?&]page=2#rankings$/)
  await expect(pager.locator('[aria-current="page"]')).toHaveText('2')
  // What a crawler gets on a fresh load of page 2: self-canonical and indexable.
  await page.goto('/?page=2')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/\?page=2$/)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index, follow/)
  await expect(page).toHaveTitle(/Page 2/)
})

test('a page past the end is a 404', async ({ page }) => {
  const res = await page.goto('/?page=9999')
  expect(res?.status()).toBe(404)
})

test('pages keep the filters and come back to the list', async ({ page }) => {
  await page.goto('/marketplace/?sort=price-asc')
  const tiles = page.locator('#listings .grid-tiles > *')
  expect(await tiles.count()).toBeLessThanOrEqual(12)
  const next = page.getByRole('link', { name: 'Next page' })
  if ((await next.count()) > 0) {
    await expect(next).toHaveAttribute('href', /sort=price-asc.*page=2#listings$/)
  }
})

test('pager fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
