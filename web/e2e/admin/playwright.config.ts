import { defineConfig } from '@playwright/test'

/**
 * Admin console e2e: needs the local Supabase stack (see README) and a dev
 * server on :3402, e.g. `NEXT_DIST_DIR=.next-admin npx next dev -p 3402`.
 * Run: E2E_SUPABASE=1 npx playwright test -c e2e/admin/playwright.config.ts
 */
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env.ADMIN_BASE_URL ?? 'http://localhost:3402',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'admin' }],
  webServer: {
    command: process.env.CI ? 'npx next build && npx next start -p 3402' : 'npx next dev -p 3402',
    cwd: '../..',
    port: 3402,
    reuseExistingServer: true,
    timeout: 300_000,
    env: { NEXT_DIST_DIR: '.next-admin', NEXT_PUBLIC_SITE_URL: 'http://localhost:3402' },
  },
})
