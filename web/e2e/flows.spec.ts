import { test } from '@playwright/test'

/**
 * Flows from brief 15 that need a real Supabase project (auth, RLS, storage)
 * and Stripe test mode. They are skipped until E2E_SUPABASE=1 and the UI for
 * each step exists (built after wireframe approval). The database half of each
 * flow is already covered by supabase/tests/rls.test.sql.
 */
const live = process.env.E2E_SUPABASE === '1'

test.describe('full flows (need Supabase + Stripe test mode)', () => {
  test.skip(!live, 'set E2E_SUPABASE=1 with a test Supabase project and Stripe test keys')
  test('signup', async () => {})
  test('create listing -> pending review', async () => {})
  test('admin approves -> listing live -> Buy button routes to it', async () => {})
  test('message a seller', async () => {})
  test('subscribe to Premium (Stripe test card) -> tier becomes premium via webhook', async () => {})
})
