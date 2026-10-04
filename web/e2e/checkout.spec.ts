import { expect, test } from '@playwright/test'

// One-tap checkout: the store's own link puts the item in the cart and opens checkout.
test('in-stock offers with a store checkout link show "Add to cart"; sold-out ones do not', async ({ page }) => {
  await page.goto('/products/pokemon/en/demo-expansion-elite-trainer-box/')
  const jb = page.locator('tr[data-availability="in_stock_online"]', { hasText: 'JB Hi-Fi' })
  const button = jb.locator('a[data-checkout]')
  await expect(button).toHaveAttribute('href', 'https://www.jbhifi.com.au/cart/40429703233737:1')
  await expect(button).toHaveAttribute('rel', /nofollow/)
  await expect(button).toHaveAttribute('target', '_blank')
  await expect(page.locator('tr[data-availability="out_of_stock"] a[data-checkout]')).toHaveCount(0)
  // Stores without a known checkout link keep "View at store" only.
  await expect(page.locator('tr', { hasText: 'Demo Card Shop' }).locator('a[data-checkout]')).toHaveCount(0)
})
