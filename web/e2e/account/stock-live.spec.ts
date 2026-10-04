import { expect, test } from '@playwright/test'
import { live, signIn, uniq } from './helpers'

// Signing up (free) unlocks live store stock; visitors see it delayed.
test.skip(!live, 'set E2E_SUPABASE=1 with the local Supabase stack running (supabase start)')

test('a free member sees live stock; signed out it is delayed again', async ({ page }) => {
  await page.goto('/stock/')
  await expect(page.getByTestId('stock-delayed')).toBeVisible()
  await signIn(page, `${uniq('e2e')}-stock@example.test`, '/stock/')
  await page.goto('/stock/')
  await expect(page.getByTestId('stock-live')).toBeVisible()
  await expect(page.getByTestId('stock-delayed')).toHaveCount(0)
  await page.context().clearCookies()
  await page.goto('/stock/')
  await expect(page.getByTestId('stock-delayed')).toBeVisible()
})
