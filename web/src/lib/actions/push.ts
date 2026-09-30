'use server'
import { z } from 'zod'
import { supabaseForRequest } from '@/lib/supabase/server'
import { pushSubscriptionSchema } from '@/lib/account/push'
import { friendlyError, type ActionResult } from './result'

// push_subscriptions is owner-only (RLS), so these run as the member. The
// workers send the notifications with the VAPID private key.

/** Save this browser's subscription (upsert on the endpoint: re-subscribing refreshes the keys). */
export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  const parsed = pushSubscriptionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'This browser returned an unusable push subscription. Try again, or use another browser.' }
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in again to turn on push alerts.' }
  const s = parsed.data
  const { error } = await sb.from('push_subscriptions').upsert(
    { user_id: auth.user.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, user_agent: s.userAgent?.slice(0, 300) ?? null, failures: 0 },
    { onConflict: 'endpoint' },
  )
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Push alerts are on for this device.' }
}

export async function deletePushSubscription(endpoint: string): Promise<ActionResult> {
  if (!z.url().max(1000).safeParse(endpoint).success) return { ok: false, error: 'Unknown device.' }
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in again.' }
  const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', auth.user.id)
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Push alerts are off for this device.' }
}
