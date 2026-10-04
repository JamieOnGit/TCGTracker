import { expect, test } from '@playwright/test'
import { authUserId, live, rest, signIn, uniq } from './helpers'

/**
 * Premium members' /drops/ is the live feed itself: the same filters and paged
 * table as everyone else, but with drops the moment they happen, and no
 * delayed copy or upgrade panel. Visitors still see the delayed history.
 */
test.skip(!live, 'set E2E_SUPABASE=1 with the local Supabase stack running (supabase start)')

test('a Premium member gets the live table with filters; a visitor gets the delayed one', async ({ page, browser }) => {
  // A drop that happened seconds ago: not public yet (public_at is in the future).
  const title = `${uniq('E2E Live Drop')} Elite Trainer Box`
  const [jb] = await rest<{ id: string }[]>('GET', 'retailers?select=id&slug=eq.jb-hi-fi')
  const [product] = await rest<{ id: number }[]>('POST', 'retail_products', {
    retailer_id: jb!.id, sku: uniq('e2e-live'), url: 'https://www.jbhifi.com.au/products/e2e-live', title, game: 'pokemon',
  })
  await rest('POST', 'drop_events', { retail_product_id: product!.id, event_type: 'IN_STOCK', price_aud: 89.95, dedupe_key: uniq('e2e-live') })

  const email = `${uniq('e2e')}-live@example.test`
  await signIn(page, email, '/account/')
  await rest('PATCH', `profile_private?user_id=eq.${await authUserId(email)}`, { tier_override: 'premium' })

  await page.goto('/drops/')
  await expect(page.getByTestId('drops-live')).toContainText('Live.')
  await expect(page.getByRole('heading', { name: 'Live stock activity' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Live feed/ })).toHaveCount(0) // no separate panel
  // The filters sit right above the live table, and they work on it.
  const search = page.getByLabel('Search stock activity by product name')
  await expect(search).toBeVisible()
  await expect(page.locator('#activity')).toContainText(title)
  await search.fill('nothing-matches-this-xyz')
  await search.press('Enter')
  await expect(page.locator('#activity')).not.toContainText(title)

  // A visitor: the delayed history and the upgrade prompt, without the fresh drop.
  const anon = await browser.newContext()
  const visitor = await anon.newPage()
  await visitor.goto('/drops/')
  await expect(visitor.getByTestId('drops-live')).toHaveCount(0)
  await expect(visitor.getByRole('heading', { name: 'Stock activity' })).toBeVisible()
  await expect(visitor.locator('#activity')).not.toContainText(title)
  await anon.close()
})
