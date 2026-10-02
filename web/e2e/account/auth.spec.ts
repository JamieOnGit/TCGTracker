import { expect, test } from '@playwright/test'
import { live, uniq, waitForMagicLink, waitForSignInCode } from './helpers'

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

test('asking on a computer and opening the link on a phone signs the computer in once the phone approves', async ({ browser }) => {
  const email = `${uniq('e2e')}-handoff@example.test`
  const desktop = await (await browser.newContext()).newPage()
  const started = Date.now()
  await desktop.goto('/login/?next=/account/')
  await desktop.getByLabel('Email address').fill(email)
  await desktop.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(desktop.getByTestId('login-sent')).toBeVisible()

  const link = await waitForMagicLink(email, started)
  // The request id rides in the link's redirect address.
  const r = new URL(new URL(link).searchParams.get('redirect_to') ?? '').searchParams.get('r')
  expect(r).toMatch(/^[0-9a-f-]{36}$/)
  const res = await fetch(link, { redirect: 'manual' })
  const hash = new URL(res.headers.get('location') ?? '').hash
  expect(hash).toContain('access_token=')

  // The phone: a separate browser with none of the computer's cookies.
  const phoneCtx = await browser.newContext()
  const phone = await phoneCtx.newPage()
  await phone.goto(`/auth/confirm/?next=${encodeURIComponent('/account/')}&r=${r}${hash}`)
  await phone.waitForURL((u) => u.pathname.startsWith('/auth/approve/'), { timeout: 30_000 })
  await expect(phone.getByRole('heading', { name: 'Sign in your other device too?' })).toBeVisible()
  await phone.getByRole('button', { name: /^Yes, sign in/ }).click()
  await expect(phone.getByTestId('approve-done')).toBeVisible()

  // The computer, still on "Check your email", signs itself in.
  await desktop.waitForURL((u) => u.pathname.startsWith('/account/'), { timeout: 30_000 })
  await expect(desktop.getByRole('main')).not.toContainText('Sign in or join')

  // The approval can't be replayed.
  await phone.goto(`/auth/approve/?r=${r}&next=/account/`)
  await phone.waitForURL((u) => u.pathname.startsWith('/account/'))
  await phoneCtx.close()
})

test('the code from the email signs in the browser that asked, wherever the email was opened', async ({ page }) => {
  const email = `${uniq('e2e')}-code@example.test`
  const started = Date.now()
  await page.goto('/login/?next=/account/')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByTestId('login-sent')).toBeVisible()

  await page.getByLabel('Sign-in code').fill('000000')
  await page.getByRole('button', { name: 'Sign in with code' }).click()
  await expect(page.locator('#token-error')).toContainText('That code didn’t work')

  const code = await waitForSignInCode(email, started)
  await page.getByLabel('Sign-in code').fill(code)
  await page.getByRole('button', { name: 'Sign in with code' }).click()
  await page.waitForURL((u) => u.pathname.startsWith('/account/'), { timeout: 30_000 })
  await expect(page.getByRole('main')).not.toContainText('Sign in or join')
})

test('a used or broken link lands on the sign-in page with a clear message', async ({ page }) => {
  await page.goto('/auth/confirm/?next=/account/#access_token=nope&refresh_token=nope')
  await page.waitForURL((u) => u.pathname === '/login/')
  await expect(page.getByRole('main')).toContainText("That sign-in link didn't work")
})
