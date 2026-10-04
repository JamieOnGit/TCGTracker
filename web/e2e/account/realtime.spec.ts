import { expect, test } from '@playwright/test'
import { live, signIn, uniq } from './helpers'

/**
 * Realtime connections are a limited resource (Supabase's free plan allows
 * ~200 at once): a visitor who isn't signed in must not open one on any page,
 * while a signed-in member's notification bell does.
 */
test.skip(!live, 'set E2E_SUPABASE=1 with the local Supabase stack running (supabase start)')

test('visitors open no Realtime connection; a signed-in member gets the live bell', async ({ page }) => {
  const sockets: string[] = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  for (const path of ['/', '/drops/', '/about/', '/stock/']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  expect(sockets.filter((u) => u.includes('/realtime/'))).toEqual([])

  await signIn(page, `${uniq('e2e')}-rt@example.test`, '/about/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('link', { name: /^Notifications/ })).toBeVisible()
  await expect.poll(() => sockets.filter((u) => u.includes('/realtime/')).length, { timeout: 10_000 }).toBeGreaterThan(0)
})
