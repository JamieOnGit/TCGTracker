'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { currentUserWithRole, supabaseForRequest } from '@/lib/supabase/server'
import { OUTCOME_MESSAGE, outcomeOf, sightingError, sightingSchema, type SightingOutcome } from '@/lib/account/sightings'
import type { ActionResult } from './result'

// Everything runs as the signed-in member: report_sighting() and the
// sighting_votes policies/triggers enforce every rule; zod only gives nicer
// messages before the round trip.

// Schema keys -> the form's field ids, so errors land next to the right input.
const FORM_FIELD: Record<string, string> = { retailerSlug: 'retailer', storeName: 'store', priceAud: 'price', purchaseLimit: 'limit', photoPath: 'photo' }

/** Report stock seen in a store or online. */
export async function reportSighting(input: unknown): Promise<ActionResult<{ id: number; outcome: SightingOutcome }>> {
  const parsed = sightingSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const key = issue?.path[0]?.toString()
    return { ok: false, error: issue?.message ?? 'Check the form.', field: key ? (FORM_FIELD[key] ?? key) : undefined }
  }
  const v = parsed.data
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in again to report a sighting.' }
  if (v.photoPath && !v.photoPath.startsWith(`${auth.user.id}/`)) return { ok: false, error: 'Upload the photo again and resend.', field: 'photo' }
  const inStore = v.channel === 'in_store'
  const { data, error } = await sb.rpc('report_sighting', {
    p_retailer_slug: v.retailerSlug,
    p_channel: v.channel,
    p_game: v.game,
    p_product: v.product,
    p_state: inStore ? v.state : null,
    p_suburb: inStore ? v.suburb : null,
    p_store_name: inStore ? (v.storeName ?? null) : null,
    p_price_aud: v.priceAud ?? null,
    p_quantity: v.quantity ?? null,
    p_url: inStore ? null : v.url,
    p_photo_path: v.photoPath ?? null,
    p_note: v.note ?? null,
    p_seen_minutes_ago: v.seenMinutesAgo,
    p_purchase_limit: v.purchaseLimit ?? null,
  })
  if (error) return { ok: false, error: sightingError(error.message), field: error.message.includes('link') ? 'url' : error.message.includes('store name') ? 'store' : undefined }
  const row = (Array.isArray(data) ? data[0] : data) as { sighting_id: number; merged: boolean; status: string } | undefined
  if (!row) return { ok: false, error: 'Something went wrong. Please try again.' }
  const outcome = outcomeOf(row)
  revalidatePath('/account/sightings/')
  return { ok: true, data: { id: row.sighting_id, outcome }, message: OUTCOME_MESSAGE[outcome] }
}

const voteSchema = z.object({ sightingId: z.number().int().positive(), vote: z.enum(['confirm', 'gone', 'fake']) })

/** Confirm / Sold out / Looks fake. One vote of each kind per member (primary key). */
export async function voteSighting(sightingId: number, vote: 'confirm' | 'gone' | 'fake'): Promise<ActionResult> {
  const parsed = voteSchema.safeParse({ sightingId, vote })
  if (!parsed.success) return { ok: false, error: 'Choose a report.' }
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in again to vote.' }
  const { error } = await sb.from('sighting_votes').insert({ sighting_id: parsed.data.sightingId, user_id: auth.user.id, vote: parsed.data.vote })
  revalidatePath('/account/sightings/')
  if (error) {
    if (error.code === '23505') return { ok: true, message: 'You’ve already voted on this one.' }
    return { ok: false, error: sightingError(error.message) }
  }
  const msg = { confirm: 'Confirmed — thanks for checking.', gone: 'Marked as sold out. Thanks!', fake: 'Flagged for a moderator. Thanks!' }[parsed.data.vote]
  return { ok: true, message: msg }
}

// ------------------------------------------------------------------ staff

const reviewSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(['confirm', 'reject', 'gone']),
  reason: z.string().trim().max(200).nullable(),
})

/** Moderator review via public.review_sighting (reject withdraws the alert). */
export async function reviewSighting(id: number, action: 'confirm' | 'reject' | 'gone', reason: string | null = null): Promise<ActionResult> {
  const me = await currentUserWithRole()
  if (!me || !(me.role === 'admin' || me.role === 'moderator')) return { ok: false, error: 'Moderators only.' }
  const parsed = reviewSchema.safeParse({ id, action, reason })
  if (!parsed.success) return { ok: false, error: 'Keep the reason under 200 characters.' }
  if (parsed.data.action === 'reject' && !parsed.data.reason) return { ok: false, error: 'Give a reason.' }
  const sb = await supabaseForRequest()
  const { error } = await sb.rpc('review_sighting', { p_sighting: parsed.data.id, p_action: parsed.data.action, p_reason: parsed.data.reason })
  revalidatePath('/admin/sightings/')
  if (error) return { ok: false, error: error.message.includes('moderators only') ? 'Moderators only.' : 'Something went wrong. Please try again.' }
  return { ok: true, message: { confirm: 'Confirmed — alert sent.', reject: 'Rejected. Any alert was withdrawn.', gone: 'Marked sold out.' }[parsed.data.action] }
}

export async function rejectSightingForm(id: number, form: FormData): Promise<ActionResult> {
  return reviewSighting(id, 'reject', String(form.get('reason') ?? '').trim() || null)
}
