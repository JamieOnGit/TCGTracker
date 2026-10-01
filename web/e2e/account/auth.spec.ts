import { expect, test } from '@playwright/test'
import { live, uniq, waitForMagicLink } from './helpers'

/**
 * Magic links must work in a different browser from the one that asked for
 * them: phones open email links in the mail app's own browser (Gmail on iOS),
 * and people request on a laptop then tap the link on their phone.
 */
test.skip(!live, 'set E2E_SUPABASE=1 with the local Supabase stack running (supabase start)')

test('a magic link requested in one browser signs you in from another', async ({ browser }) => {
  const email = `${uniq('e2e')}-xbrowser@example.test`
  const asking = await browser.newContext()
  const page = await asking.newPage()
  const started = Date.now()
  await page.goto('/login/?next=/account/')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByTestId('login-sent')).toBeVisible()
  const link = await waitForMagicLink(email, started)
  await asking.close()

  // Supabase verifies the link and hands the session back in the URL fragment.
  const res = await fetch(link, { redirect: 'manual' })
  const location = res.headers.get('location') ?? ''
  const hash = new URL(location).hash
  expect(hash).toContain('access_token=')

  // A brand-new browser with no cookies from the request.
  const other = await browser.newContext()
  const tap = await other.newPage()
  await tap.goto(`/auth/confirm/?next=${encodeURIComponent('/account/')}${hash}`)
  await tap.waitForURL((u) => u.pathname.startsWith('/account/'), { timeout: 30_000 })
  await expect(tap.getByRole('main')).not.toContainText("That sign-in link didn't work")
  // The tokens don't linger in the address bar.
  expect(new URL(tap.url()).hash).toBe('')
  await other.close()
})

test('a used or broken link lands on the sign-in page with a clear message', async ({ page }) => {
  await page.goto('/auth/confirm/?next=/account/#access_token=nope&refresh_token=nope')
  await page.waitForURL((u) => u.pathname === '/login/')
  await expect(page.getByRole('main')).toContainText("That sign-in link didn't work")
})
