'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { supabaseForRequest } from '@/lib/supabase/server'
import { friendlyError, type ActionResult } from './result'

async function uid() {
  const sb = await supabaseForRequest()
  const { data } = await sb.auth.getUser()
  return { sb, id: data.user?.id ?? null }
}

/** "Set alert" on a card: email me when it's listed (optionally a grade and max price). */
export async function addWishlist(cardId: string, gradeKey: string | null, maxPriceAud?: number): Promise<ActionResult> {
  if (!z.uuid().safeParse(cardId).success) return { ok: false, error: 'Choose a card.' }
  if (gradeKey !== null && !/^(raw|[a-z]{2,4}-\d{1,2}(\.5)?)$/.test(gradeKey)) return { ok: false, error: 'Choose a grade.', field: 'grade' }
  if (maxPriceAud !== undefined && !(maxPriceAud > 0 && maxPriceAud < 10_000_000)) return { ok: false, error: 'Enter a price in dollars, or leave it blank.', field: 'maxPrice' }
  const { sb, id } = await uid()
  if (!id) return { ok: false, error: 'Sign in to set an alert.' }
  const { error } = await sb.from('wishlist_items').insert({ user_id: id, card_id: cardId, grade_key: gradeKey, max_price_aud: maxPriceAud ?? null })
  if (error && !error.message.includes('duplicate')) return { ok: false, error: friendlyError(error.message) }
  revalidatePath('/account/alerts/')
  return { ok: true, message: error ? 'You already have this alert.' : "Alert set. We'll email you when it's listed." }
}

export async function removeWishlist(id: number): Promise<ActionResult> {
  const { sb } = await uid()
  const { error } = await sb.from('wishlist_items').delete().eq('id', id)
  revalidatePath('/account/alerts/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

const searchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.object({
    game: z.enum(['pokemon', 'one-piece']).optional(), lang: z.enum(['en', 'jp']).optional(), card_id: z.uuid().optional(),
    set_id: z.uuid().optional(), grade_key: z.string().max(12).optional(), listing_type: z.enum(['graded_single', 'raw_single', 'sealed']).optional(),
    state: z.string().max(3).optional(), price_min: z.number().optional(), price_max: z.number().optional(), q: z.string().max(80).optional(),
  }),
})

export async function saveSearch(input: unknown): Promise<ActionResult> {
  const parsed = searchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Give your search a name.' }
  const { sb, id } = await uid()
  if (!id) return { ok: false, error: 'Sign in to save searches.' }
  const { error } = await sb.from('saved_searches').insert({ user_id: id, name: parsed.data.name, query: parsed.data.query })
  revalidatePath('/account/alerts/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: "Saved. We'll email you new matches." }
}

export async function deleteSearch(id: number): Promise<ActionResult> {
  const { sb } = await uid()
  const { error } = await sb.from('saved_searches').delete().eq('id', id)
  revalidatePath('/account/alerts/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

const TYPES = ['message', 'listing_status', 'listing_expiring', 'saved_search', 'wishlist', 'drop', 'billing', 'weekly_digest', 'marketing'] as const
const CHANNELS = ['email', 'onsite', 'discord'] as const

/** Notification preference centre: every alert type x channel. */
export async function savePreferences(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { sb, id } = await uid()
  if (!id) return { ok: false, error: 'Sign in again.' }
  const rows = TYPES.flatMap((t) => CHANNELS.map((c) => ({ user_id: id, alert_type: t, channel: c, enabled: form.get(`${t}:${c}`) === 'on', updated_at: new Date().toISOString() })))
  const { error } = await sb.from('notification_preferences').upsert(rows)
  if (!error) {
    await sb.from('profile_private').update({ marketing_opt_in: form.get('marketing:email') === 'on' }).eq('user_id', id)
  }
  revalidatePath('/account/settings/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Preferences saved.' }
}

export async function markNotificationsRead(): Promise<void> {
  const { sb, id } = await uid()
  if (id) await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', id).is('read_at', null)
}
