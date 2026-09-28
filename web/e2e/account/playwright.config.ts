import { defineConfig, devices } from '@playwright/test'

/**
 * Member-area flows against a live local Supabase stack (see helpers.ts).
 *   cd web && E2E_SUPABASE=1 npx playwright test -c e2e/account/playwright.config.ts
 * Uses its own dev server on :3401 (NEXT_DIST_DIR=.next-account) so it doesn't clash with others.
 */
const PORT = Number(process.env.E2E_ACCOUNT_PORT ?? 3401)
const chromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/account',
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath: chromium },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: process.env.CI ? `NEXT_DIST_DIR=.next-account npx next build && NEXT_DIST_DIR=.next-account npx next start -p ${PORT}` : `NEXT_DIST_DIR=.next-account npx next dev -p ${PORT}`,
    cwd: '../..',
    port: PORT,
    reuseExistingServer: true,
    timeout: 300_000,
  },
})
