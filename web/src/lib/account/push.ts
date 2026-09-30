/**
 * Web push helpers shared by the PushToggle client component, the server
 * action and the unit tests. Delivery itself happens in the workers
 * (VAPID_PRIVATE_KEY never reaches the web app).
 */
import { z } from 'zod'

/** VAPID public keys are URL-safe base64 without padding; PushManager wants bytes. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = globalThis.atob(base64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Browser push services we deliver to (mirrors the push_subscriptions check constraint). */
export const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/

export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/, hostname: PUSH_HOSTS }).max(1000),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
  userAgent: z.string().max(300).nullable(),
})
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>

/**
 * iPhone and iPad only allow web push from a site added to the Home Screen
 * (iOS 16.4+), and then only inside that installed app.
 */
export function needsHomeScreen(ua: string, standalone: boolean): boolean {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))
  return ios && !standalone
}
