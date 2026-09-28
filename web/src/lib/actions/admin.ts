'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { validCampaignId } from '@/lib/domain/ebay'
import { currentUserWithRole, supabaseForRequest, type AppRole } from '@/lib/supabase/server'
import { friendlyError, type ActionResult } from './result'

// Every write here runs as the signed-in staff member, so RLS decides what
// they may change and the audit trigger records who did it.
async function staff(roles: AppRole[]) {
  const me = await currentUserWithRole()
  if (!me || !(me.role === 'admin' || roles.includes(me.role))) return null
  return { me, sb: await supabaseForRequest() }
}

export async function approveListings(ids: number[]): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  const { error } = await s.sb.from('listings').update({ status: 'active' }).in('id', ids).eq('status', 'pending_review')
  revalidatePath('/admin/listings/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: `Approved ${ids.length}.` }
}

export async function rejectListing(id: number, reason: string): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  if (!reason.trim()) return { ok: false, error: 'Give a reason.' }
  const { error } = await s.sb.from('listings').update({ status: 'rejected', rejection_reason: reason.trim().slice(0, 500) }).eq('id', id)
  revalidatePath('/admin/listings/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

export async function requestChanges(id: number, note: string): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  if (!note.trim()) return { ok: false, error: 'Say what needs changing.' }
  const { error } = await s.sb.from('listings').update({ status: 'draft', change_request: note.trim().slice(0, 500) }).eq('id', id)
  revalidatePath('/admin/listings/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

export async function removeListing(id: number, reason: string): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  const { error } = await s.sb.from('listings').update({ status: 'removed', removed_reason: reason.slice(0, 500) }).eq('id', id)
  revalidatePath('/admin/listings/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

/** Settings editable in the console, with per-key validation. */
const SETTING_VALIDATORS: Record<string, z.ZodType> = {
  'billing.premium_monthly_cents': z.number().int().min(100).max(100000),
  'billing.premium_annual_cents': z.number().int().min(100).max(1000000).nullable(),
  'billing.founder_monthly_cents': z.number().int().min(100).max(100000).nullable(),
  'billing.grace_period_days': z.number().int().min(0).max(30),
  'quota.free_per_period': z.number().int().min(0).max(1000),
  'quota.premium_per_period': z.number().int().min(0).max(10000),
  'quota.period': z.enum(['calendar_month', 'rolling_30_days']),
  'quota.count_rejected': z.boolean(),
  'listings.expiry_days': z.number().int().min(7).max(365),
  'listings.auto_approve_trusted': z.boolean(),
  'market.outlier_min_ratio': z.number().min(0).max(1),
  'market.floor_refresh_hours': z.number().min(1).max(48),
  'drops.public_delay_minutes': z.number().int().min(0).max(10080),
  'drops.free_delay_minutes': z.number().int().min(0).max(10080),
  'drops.free_delayed_alerts': z.boolean(),
  'drops.suppress_above_rrp_pct': z.number().min(0).max(1000),
  'features.external_buy_fallback': z.boolean(),
  'ebay.enabled': z.boolean(),
  'ebay.affiliate_enabled': z.boolean(),
  'ebay.campaign_id': z.string().refine(validCampaignId, 'An EPN campaign id is 10 digits').nullable(),
  'ebay.custom_id': z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Letters, numbers, - and _ only'),
  'site.announcement': z.string().max(200).nullable(),
}

export async function updateSetting(key: string, value: unknown): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const v = SETTING_VALIDATORS[key]
  if (!v) return { ok: false, error: 'That setting is not editable here.' }
  const parsed = v.safeParse(value)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid value', field: key }
  const { error } = await s.sb.from('site_settings').update({ value: parsed.data, updated_by: s.me.id, updated_at: new Date().toISOString() }).eq('key', key)
  revalidatePath('/', 'layout')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Saved.' }
}

/** eBay Partner Network details: applied to every card's eBay link at once. */
export async function saveEbayAffiliate(form: FormData): Promise<ActionResult> {
  const campaign = String(form.get('campaign_id') ?? '').trim() || null
  const enabled = form.get('affiliate_enabled') === 'on'
  if (enabled && !validCampaignId(campaign)) return { ok: false, error: 'Enter your 10-digit EPN campaign id to switch tracking on.', field: 'campaign_id' }
  for (const [k, v] of [
    ['ebay.campaign_id', campaign],
    ['ebay.custom_id', String(form.get('custom_id') ?? 'tcgtrade').trim() || 'tcgtrade'],
    ['ebay.affiliate_enabled', enabled],
    ['ebay.enabled', form.get('ebay_enabled') === 'on'],
  ] as const) {
    const r = await updateSetting(k, v)
    if (!r.ok) return r
  }
  return { ok: true, message: enabled ? 'Affiliate tracking is on for every card link.' : 'Saved. Affiliate tracking is off.' }
}

export async function resolveMapping(queueId: number, action: 'approve' | 'pick' | 'reject', cardId?: string): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const { data: row } = await s.sb.from('mapping_queue').select('*').eq('id', queueId).single()
  if (!row) return { ok: false, error: 'Not found.' }
  if (action === 'reject') {
    await s.sb.from('mapping_queue').update({ status: 'rejected', reviewed_by: s.me.id, reviewed_at: new Date().toISOString() }).eq('id', queueId)
    return { ok: true }
  }
  const target = action === 'approve' ? row.suggested_card_id : cardId
  if (!target) return { ok: false, error: 'Pick a card.' }
  const { error } = await s.sb.from('card_external_ids').insert({
    card_id: target, source: row.source, external_id: row.external_id, lang: row.lang, variant: row.payload?.variant ?? null,
    match_confidence: row.confidence, match_method: 'admin', verified_by: s.me.id, verified_at: new Date().toISOString(),
  })
  if (error) return { ok: false, error: error.message.includes('language') ? 'That card is in the other language. JP and EN are separate cards.' : friendlyError(error.message) }
  await s.sb.from('mapping_queue').update({ status: 'approved', resolved_card_id: target, reviewed_by: s.me.id, reviewed_at: new Date().toISOString() }).eq('id', queueId)
  revalidatePath('/admin/mapping/')
  return { ok: true }
}

export async function resolveReport(id: number, status: 'actioned' | 'dismissed', note: string): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  const { error } = await s.sb.from('reports').update({ status, resolution_note: note.slice(0, 1000), resolved_by: s.me.id, resolved_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/admin/reports/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

export async function setUserStatus(userId: string, status: 'active' | 'suspended' | 'banned', days?: number): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  const { error } = await s.sb.from('profile_private').update({
    status, suspended_until: status === 'suspended' && days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
  }).eq('user_id', userId)
  revalidatePath('/admin/users/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

export async function setUserOverrides(userId: string, tier: 'free' | 'premium' | null, quota: number | null, role?: AppRole): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const patch: Record<string, unknown> = { tier_override: tier, quota_override: quota }
  if (role) patch.role = role
  const { error } = await s.sb.from('profile_private').update(patch).eq('user_id', userId)
  revalidatePath('/admin/users/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

export async function setRetailerEnabled(slug: string, enabled: boolean): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const { error } = await s.sb.from('retailers').update({ enabled }).eq('slug', slug)
  revalidatePath('/admin/drops/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

const rrpSchema = z.object({ game: z.enum(['pokemon', 'one-piece']), productType: z.string().min(2).max(40), setCode: z.string().max(12).nullable(), rrpAud: z.number().positive().max(10000) })

export async function upsertRrp(input: unknown): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const p = rrpSchema.safeParse(input)
  if (!p.success) return { ok: false, error: 'Check the RRP fields.' }
  const { error } = await s.sb.from('rrp_reference').insert({ game: p.data.game, product_type: p.data.productType, set_code: p.data.setCode, rrp_aud: p.data.rrpAud })
  revalidatePath('/admin/drops/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

export async function upsertWatch(kind: 'include_keyword' | 'exclude_keyword' | 'set_code' | 'sku' | 'url', value: string, game: string | null): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const { error } = await s.sb.from('watchlist').insert({ kind, value: value.trim().slice(0, 200), game })
  revalidatePath('/admin/drops/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}
