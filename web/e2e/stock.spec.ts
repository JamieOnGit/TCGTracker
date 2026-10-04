import { expect, test } from '@playwright/test'

// Runs against demo data (no Supabase needed): signed out, so Notify me is a sign-in link.
const PRODUCT = '/products/pokemon/en/demo-expansion-elite-trainer-box/'

test('drops activity feed: search, dropdown filters with counts, and rows', async ({ page }) => {
  await page.goto('/drops/')
  const bar = page.getByRole('search', { name: 'Filter and search' })
  const activity = bar.getByLabel('Activity', { exact: true })
  await expect(activity.locator('option')).toHaveText([/^All activity \(\d+\)$/, /^Back in stock \(\d+\)$/, /^New listing \(\d+\)$/, /^Pre-order live \(\d+\)$/, /^Price drop \(\d+\)$/, /^Member sightings \(\d+\)$/])
  await expect(activity).toHaveValue('')
  for (const name of ['Game', 'Language', 'Store', 'State', 'Sort']) await expect(bar.getByLabel(name, { exact: true })).toBeVisible()
  await expect(bar.getByLabel('Sort', { exact: true })).toHaveValue('') // in stock first

  // A price drop row: badge with the percentage, links to the product page, Notify me sends signed-out visitors to log in.
  const drop = page.locator('li[data-status="price-drop"]').first()
  await expect(drop).toContainText('Price drop −12%')
  await expect(drop.getByRole('link', { name: 'Demo expansion Elite Trainer Box', exact: true })).toHaveAttribute('href', PRODUCT)
  await expect(drop.locator('time').first()).toHaveAttribute('datetime', /^2026-/)
  await expect(drop.locator('time').first()).toHaveText(/ago$|^\d{1,2} \w+$/)
  const notify = drop.getByRole('link', { name: 'Notify me about Demo expansion Elite Trainer Box' })
  await expect(notify).toHaveAttribute('href', `/login/?next=${encodeURIComponent(PRODUCT)}`)
  await expect(notify).toHaveAttribute('rel', 'nofollow')

  // Picking from a dropdown applies it straight away, and only that param lands in the URL.
  await activity.selectOption('price-drop')
  await expect(page).toHaveURL(/\/drops\/\?status=price-drop$/)
  await expect(page.locator('li[data-status]')).toHaveCount(1)
  await page.goto('/drops/?status=price-drop')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/drops\/$/)

  await page.goto('/drops/?game=one-piece')
  await expect(page.locator('li[data-status]').first()).toBeVisible()
  await expect(page.locator('li[data-status] .tag-quiet', { hasText: 'Pokémon' })).toHaveCount(0)
  await expect(page.getByLabel('Game', { exact: true })).toHaveValue('one-piece')

  await page.goto('/drops/?status=sighting&sort=oldest')
  const sightings = page.locator('li[data-status]')
  await expect(sightings).toHaveCount(2)
  await expect(sightings.first()).toContainText('BIG W') // oldest first
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('drops search: wildcards, every word, and the language filter', async ({ page }) => {
  await page.goto('/drops/')
  const search = page.getByRole('searchbox', { name: 'Search stock activity by product name' })
  await search.fill('demo*trainer')
  await search.press('Enter')
  await expect(page).toHaveURL(/\/drops\/\?q=demo\*trainer$/)
  const rows = page.locator('li[data-status]')
  await expect(rows.first()).toBeVisible()
  for (const t of await rows.allTextContents()) expect(t.toLowerCase()).toContain('trainer')
  await expect(page.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/drops/')

  await page.goto('/drops/?q=zzzz-nothing')
  await expect(page.getByText('Nothing matches these filters')).toBeVisible()
  await page.goto('/drops/?lang=jp')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('jp')
})

test('in stock now lists products with stores, Notify me and ItemList JSON-LD', async ({ page }) => {
  await page.goto('/drops/in-stock/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('In stock now')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index/)
  const card = page.locator('article[data-product="demo-expansion-elite-trainer-box"]')
  await expect(card).toContainText('In stock at 2 stores')
  await expect(card).toContainText('A$79.00')
  await expect(card.getByRole('list', { name: /Stores with/ }).getByRole('link')).toHaveCount(2)
  await expect(card.getByRole('link', { name: /^Notify me about/ })).toHaveAttribute('href', /^\/login\/\?next=/)
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents()
  expect(jsonLd.some((j) => j.includes('"ItemList"'))).toBe(true)

  await page.getByRole('search').getByLabel('Store', { exact: true }).selectOption({ label: 'Premium Bandai AU' })
  await expect(page).toHaveURL(/\?retailer=premium-bandai-au$/)
  await expect(page.locator('article[data-product]')).toHaveCount(1)
  await page.goto('/drops/in-stock/?retailer=premium-bandai-au') // a fresh load, so the head is the server's
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('product page: store table, Notify me, activity, Product JSON-LD', async ({ page }) => {
  await page.goto(PRODUCT)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo expansion Elite Trainer Box (English)')
  await expect(page.locator('.lead').first()).toHaveText('In stock at 2 stores from A$79.00 (RRP A$89.95).')
  const rows = page.locator('table tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText('Demo Card Shop')
  await expect(rows.first()).toContainText('In stock online')
  await expect(rows.last()).toContainText('Sold out')
  const out = rows.first().getByRole('link', { name: /^View/ })
  await expect(out).toHaveAttribute('rel', 'nofollow noopener')
  await expect(out).toHaveAttribute('target', '_blank')
  await expect(page.getByRole('link', { name: 'Notify me about Demo expansion Elite Trainer Box' }).first()).toHaveAttribute('href', `/login/?next=${encodeURIComponent(PRODUCT)}`)
  await expect(page.locator('li[data-status="price-drop"]')).toBeVisible()
  const jsonLd = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((j) => JSON.parse(j))
  const product = jsonLd.find((j) => j['@type'] === 'Product')
  expect(product.offers).toMatchObject({ '@type': 'AggregateOffer', priceCurrency: 'AUD', lowPrice: '79.00', highPrice: '89.95', offerCount: 3, availability: 'https://schema.org/InStock' })
  expect(jsonLd.some((j) => j['@type'] === 'BreadcrumbList')).toBe(true)
  expect(jsonLd.some((j) => j['@type'] === 'FAQPage')).toBe(true)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${PRODUCT}$`))
})

test('product index pages and unknown products', async ({ page, request }) => {
  await page.goto('/products/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sealed products')
  await expect(page.locator('article[data-product]')).toHaveCount(2)
  await page.goto('/products/one-piece/')
  await expect(page.locator('article[data-product]')).toHaveCount(1)
  expect((await request.get('/products/pokemon/en/no-such-product/')).status()).toBe(404)
  expect((await request.get('/products/magic/')).status()).toBe(404)
})

test('store coverage page explains how each store is covered', async ({ page }) => {
  await page.goto('/drops/')
  await page.getByRole('link', { name: 'Stores we watch' }).first().click()
  await expect(page).toHaveURL(/\/drops\/stores\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stores we watch')
  await expect(page.locator('tr[data-coverage="live"]')).toContainText('Demo Card Shop')
  await expect(page.locator('tr[data-coverage="live"]')).toContainText(/Live · checked/)
  await expect(page.locator('tr[data-coverage="blocked"]')).toContainText('Not reachable (blocked by the store)')
  await expect(page.locator('tr[data-coverage="sightings"]').first()).toContainText('Member sightings only')
})

test('retailer page shows what is in stock there', async ({ page }) => {
  await page.goto('/drops/demo-card-shop/')
  await expect(page.getByRole('heading', { name: 'In stock now at Demo Card Shop' })).toBeVisible()
  await expect(page.locator('article[data-product]')).toHaveCount(2)
})

test('stock pages have no horizontal scroll at phone width', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only')
  for (const path of ['/drops/', '/drops/in-stock/', '/drops/stores/', '/products/', PRODUCT, '/stock/', '/stock/demo-card-shop/']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
    // Mobile browsers zoom out (widen innerWidth) instead of scrolling when content overflows.
    expect(await page.evaluate(() => window.innerWidth), path).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
})

test('stock hub: totals, stores ranked by what is in stock, linked store pages', async ({ page }) => {
  await page.goto('/stock/')
  await expect(page.getByRole('heading', { level: 1, name: 'Pokémon & One Piece card stock in Australia' })).toBeVisible()
  await expect(page.getByText('Listings in stock now')).toBeVisible()
  const rows = page.locator('table tbody tr')
  await expect(rows.first()).toHaveAttribute('data-in-stock', 'yes')
  // Stores show their own logo; one without a logo keeps its monogram.
  await expect(page.locator('img.retailer-logo[src="/retailers/jb-hi-fi.png"]').first()).toBeVisible()
  expect(await page.locator('img.retailer-logo').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  await rows.first().getByRole('link').click()
  await expect(page).toHaveURL(/\/stock\/[a-z0-9-]+\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pokémon & One Piece stock')

  // Jump to a store from the dropdown; search across every store.
  await page.goto('/stock/')
  await page.getByRole('search').getByLabel('Jump to a store').selectOption('demo-card-shop')
  await expect(page).toHaveURL(/\/stock\/demo-card-shop\/$/)
  await page.goto('/stock/?q=demo+etb')
  await expect(page.getByRole('heading', { level: 2, name: /demo etb/ })).toBeVisible()
  await expect(page.locator('article[data-product="demo-expansion-elite-trainer-box"]')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('store stock page: every listing with status, price and a facet that is noindex', async ({ page }) => {
  await page.goto('/stock/demo-card-shop/')
  await expect(page.locator('tr[data-availability]')).toHaveCount(2)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index/)
  // In stock first by default.
  await expect(page.locator('tr[data-availability]').first()).toHaveAttribute('data-availability', /^in_stock/)
  await page.getByRole('search').getByLabel('Stock', { exact: true }).selectOption('in-stock')
  await expect(page).toHaveURL(/\?status=in-stock$/)
  await expect(page.locator('tr[data-availability]')).toHaveCount(2)
  await page.goto('/stock/demo-card-shop/?q=*zzz*')
  await expect(page.locator('tr[data-availability]')).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  // What a crawler gets on a fresh load of the facet.
  await page.goto('/stock/demo-card-shop/?status=sold-out')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  const res = await page.goto('/stock/no-such-store/')
  expect(res?.status()).toBe(404)
})

test('visitors see stock 10 minutes behind, with the free sign-up for live stock', async ({ page }) => {
  for (const path of ['/stock/', '/stock/jb-hi-fi/', '/drops/in-stock/']) {
    await page.goto(path)
    const note = page.getByTestId('stock-delayed')
    await expect(note).toContainText('You’re seeing stock as it was 10 minutes ago')
    const cta = note.getByRole('link', { name: 'Sign up free for live stock' })
    await expect(cta).toHaveAttribute('href', `/login/?next=${encodeURIComponent(path)}`)
    await expect(cta).toHaveAttribute('rel', 'nofollow')
    await expect(page.getByTestId('stock-live')).toHaveCount(0)
  }
  // The pages stay complete and indexable for search engines.
  await page.goto('/stock/')
  await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/)
})

test('a product page tells visitors how fresh its stock is', async ({ page }) => {
  await page.goto(PRODUCT)
  await expect(page.getByTestId('stock-delayed')).toBeVisible()
})
