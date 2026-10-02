import { expect, test } from '@playwright/test'

const CARD = '/cards/pokemon/en/151/199-charizard-ex/'

test('card page: market price (raw) first, then PSA grades, other grading companies for comparison, values in Product JSON-LD', async ({ page }) => {
  await page.goto(CARD)
  const tabs = page.getByRole('navigation', { name: 'Grade' }).getByRole('link')
  await expect(tabs.first()).toHaveText('Raw')
  await expect(tabs.nth(1)).toHaveText('PSA 10')
  const labels = await tabs.allTextContents()
  expect(labels.indexOf('PSA 8')).toBeLessThan(labels.indexOf('BGS 10'))
  expect(labels).toEqual(expect.arrayContaining(['BGS 9.5', 'CGC 10', 'SGC 10']))

  const rows = page.locator('section[aria-labelledby="grades-h"] tbody th')
  await expect(rows.first()).toHaveText('Raw')
  await expect(rows.nth(1)).toHaveText('PSA 10')
  await expect(page.getByText('PSA grades drive market cap.')).toBeVisible()
  await expect(page.getByText(/JustTCG/).first()).toBeVisible()

  const product = await page.locator('script[type="application/ld+json"]').evaluateAll((els) =>
    els.map((e) => JSON.parse(e.textContent ?? '{}')).find((d) => d['@type'] === 'Product'),
  )
  const props = (product?.additionalProperty ?? []).map((p: { name: string }) => p.name)
  expect(props).toEqual(expect.arrayContaining(['Market price (ungraded, Near Mint)', 'PSA 10 value', 'BGS 10 value']))
})

test('another company’s grade is a noindex view that says market cap uses PSA', async ({ page }) => {
  await page.goto(`${CARD}?grade=bgs-10`)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByText('BGS 10 value history')).toBeVisible()
  await expect(page.getByText('Market cap uses PSA grades')).toBeVisible()
})

test('card pages have no horizontal scroll at phone width, however many grades there are', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only')
  for (const path of [CARD, `${CARD}?grade=bgs-9.5`]) {
    await page.goto(path)
    // A mobile browser widens (zooms out) the layout viewport when content
    // overflows, so innerWidth growing past the device width is the symptom.
    const width = await page.evaluate(() => window.innerWidth)
    expect(width, path).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
})

test('rankings lead with the market price and show PSA 10 beside it', async ({ page }) => {
  await page.goto('/')
  const head = page.locator('table.dt thead th')
  await expect(head.nth(2)).toContainText('Market price (A$)')
  await expect(head.filter({ hasText: 'PSA 10 (A$)' })).toHaveCount(1)
  await expect(page.getByRole('navigation', { name: 'Grade' }).getByRole('link').first()).toHaveText('Market price')
  await expect(page.locator('tbody td[data-col="psa10"]').first()).toHaveText(/\d/)
  // The PSA 10 view keeps population and market cap.
  await page.goto('/?grade=psa-10')
  await expect(page.locator('table.dt thead th').filter({ hasText: 'PSA pop' })).toHaveCount(1)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})
