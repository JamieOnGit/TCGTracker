'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { validCampaignId } from '@/lib/domain/ebay'
import { currentUserWithRole, supabaseForRequest, supabaseService, type AppRole } from '@/lib/supabase/server'
import { findField, parseSettingInput } from '@/lib/admin/settings'
import { SETTING_VALIDATORS } from '@/lib/admin/settingValidators'
import { rrpTag } from '@/lib/admin/format'
import { adapterFor, buildStoreConfig, newStoreSchema, readConfigFields, readNewStore, storeSettingsSchema, storeSlug } from '@/lib/admin/stores'
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
  if (!ids.length) return { ok: false, error: 'Select at least one listing.' }
  const { data, error } = await s.sb.from('listings').update({ status: 'active' }).in('id', ids).eq('status', 'pending_review').select('id')
  revalidatePath('/admin/listings/')
  if (error) return { ok: false, error: friendlyError(error.message) }
  const n = data?.length ?? 0
  return { ok: true, message: n === ids.length ? `Approved ${n}.` : `Approved ${n} of ${ids.length} (the rest were already handled).` }
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


export async function updateSetting(key: string, value: unknown): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const v = SETTING_VALIDATORS[key]
  if (!v) return { ok: false, error: 'That setting is not editable here.' }
  const parsed = v.safeParse(value)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid value', field: key }
  // Via RPC so a cleared setting is stored as a real JSON null (PostgREST would send SQL NULL).
  const { error } = await s.sb.rpc('admin_set_setting', { p_key: key, p_value: JSON.stringify(parsed.data) })
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
    ['ebay.custom_id', String(form.get('custom_id') ?? 'tcgtracker').trim() || 'tcgtracker'],
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
    const { error } = await s.sb.from('mapping_queue').update({ status: 'rejected', reviewed_by: s.me.id, reviewed_at: new Date().toISOString() }).eq('id', queueId)
    revalidatePath('/admin/mapping/')
    return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Rejected.' }
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

// ---------------------------------------------------------------------------
// Admin console additions (web/src/app/admin/).

/** Saves one grouped settings form. Only changed keys are written, so the audit log stays meaningful. */
export async function saveSettings(form: FormData): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const keys = String(form.get('keys') ?? '').split(',').filter(Boolean)
  const { data: current } = await s.sb.from('site_settings').select('key,value').in('key', keys)
  const now = new Map(((current ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, JSON.stringify(r.value)]))
  let changed = 0
  for (const key of keys) {
    const field = findField(key)
    if (!field) return { ok: false, error: 'That setting is not editable here.' }
    const raw = form.get(key)
    const parsed = parseSettingInput(field.kind, typeof raw === 'string' ? raw : null)
    if (!parsed.ok) return { ok: false, error: `${field.label}: ${parsed.error}`, field: key }
    const was = now.get(key)
    if (was === JSON.stringify(parsed.value) || (parsed.value === null && (was === '""' || was === 'null'))) continue
    const r = await updateSetting(key, parsed.value)
    if (!r.ok) return { ok: false, error: `${field.label}: ${r.error}`, field: key }
    changed++
  }
  revalidatePath('/admin/settings/')
  return { ok: true, message: changed ? `Saved ${changed} change${changed === 1 ? '' : 's'}.` : 'Nothing changed.' }
}

async function auditServiceWrite(me: { id: string; role: AppRole }, action: string, targetType: string, targetId: string, before: unknown, after: unknown) {
  // Writes made with the service role bypass the audit trigger, so log them here.
  await supabaseService().from('admin_audit_log').insert({ actor_id: me.id, actor_role: me.role, action, target_type: targetType, target_id: targetId, before, after })
}

/** Re-queue a failed email. email_outbox has no staff write policy, so this uses the service role after the admin check. */
export async function retryEmail(id: number): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const svc = supabaseService()
  const { data: before } = await svc.from('email_outbox').select('id,status,attempts,last_error').eq('id', id).maybeSingle()
  if (!before) return { ok: false, error: 'Not found.' }
  if (before.status !== 'failed') return { ok: false, error: 'Only failed emails can be retried.' }
  const patch = { status: 'queued', attempts: 0, last_error: null, send_after: new Date().toISOString() }
  const { error } = await svc.from('email_outbox').update(patch).eq('id', id).eq('status', 'failed')
  if (error) return { ok: false, error: friendlyError(error.message) }
  await auditServiceWrite(s.me, 'email_outbox.retry', 'email_outbox', String(id), before, { ...before, ...patch })
  revalidatePath('/admin/emails/')
  return { ok: true, message: 'Queued for another attempt.' }
}

export async function featureListing(id: number, days: number): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  const until = days > 0 ? new Date(Date.now() + Math.min(days, 90) * 86_400_000).toISOString() : null
  const { error } = await s.sb.from('listings').update({ featured_until: until }).eq('id', id).eq('status', 'active')
  revalidatePath('/admin/listings/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: until ? `Featured for ${days} days.` : 'No longer featured.' }
}

export async function extendListing(id: number, days: number): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: 'Choose 1–365 days.' }
  const { data: l } = await s.sb.from('listings').select('expires_at,status').eq('id', id).maybeSingle()
  if (!l || l.status !== 'active') return { ok: false, error: 'Only active listings can be extended.' }
  const base = Math.max(Date.now(), l.expires_at ? Date.parse(l.expires_at) : 0)
  const { error } = await s.sb.from('listings').update({ expires_at: new Date(base + days * 86_400_000).toISOString() }).eq('id', id)
  revalidatePath('/admin/listings/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: `Extended by ${days} days.` }
}

export async function expireListing(id: number): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  const { error } = await s.sb.from('listings').update({ status: 'expired', expires_at: new Date().toISOString() }).eq('id', id).eq('status', 'active')
  revalidatePath('/admin/listings/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Expired.' }
}

/** Moves a listing to the right catalogue card. The card must be the same game AND language (JP and EN are separate cards). */
export async function reassignListingCard(id: number, cardId: string): Promise<ActionResult> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  const [{ data: l }, { data: c }] = await Promise.all([
    s.sb.from('listings').select('lang,card_id,card:cards(game)').eq('id', id).maybeSingle(),
    s.sb.from('cards').select('id,game,lang').eq('id', cardId).maybeSingle(),
  ])
  if (!l || !l.card_id) return { ok: false, error: 'Listing not found, or it is a sealed product.' }
  if (!c) return { ok: false, error: 'Card not found.' }
  const game = (l.card as unknown as { game: string } | null)?.game
  if (c.lang !== l.lang || (game && c.game !== game)) return { ok: false, error: 'That card is a different game or language. JP and EN are separate cards.' }
  const { error } = await s.sb.from('listings').update({ card_id: cardId }).eq('id', id)
  revalidatePath('/admin/listings/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Card reassigned.' }
}

export interface CardSearchHit {
  id: string
  name: string
  number: string
  variant: string
  game: string
  lang: string
  setName: string
  setCode: string
}

const cardSearchSchema = z.object({ q: z.string().trim().min(1).max(60), game: z.enum(['pokemon', 'one-piece']), lang: z.enum(['en', 'jp']) })

/** Catalogue search for the card pickers, always filtered to one game + language. */
export async function searchCards(input: unknown): Promise<ActionResult<CardSearchHit[]>> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  const p = cardSearchSchema.safeParse(input)
  if (!p.success) return { ok: true, data: [] }
  const term = p.data.q.replace(/[%_,()*."\\]/g, ' ').trim()
  if (!term) return { ok: true, data: [] }
  const { data, error } = await s.sb
    .from('cards')
    .select('id,name,number,variant,game,lang,set:sets(name,code)')
    .eq('game', p.data.game)
    .eq('lang', p.data.lang)
    .or(`name.ilike.%${term}%,number.ilike.%${term}%`)
    .order('name')
    .limit(20)
  if (error) return { ok: false, error: friendlyError(error.message) }
  const hits = ((data ?? []) as unknown as { id: string; name: string; number: string; variant: string; game: string; lang: string; set: { name: string; code: string } | null }[]).map((c) => ({
    id: c.id, name: c.name, number: c.number, variant: c.variant, game: c.game, lang: c.lang, setName: c.set?.name ?? '', setCode: c.set?.code ?? '',
  }))
  return { ok: true, data: hits }
}

export interface ThreadMessage {
  id: number
  sender: string
  body: string
  hasAttachment: boolean
  created_at: string
}

/** Opens a REPORTED thread. The database function refuses unreported threads and writes an audit row on every read. */
export async function readReportedThread(conversationId: string): Promise<ActionResult<ThreadMessage[]>> {
  const s = await staff(['moderator'])
  if (!s) return { ok: false, error: 'Not allowed.' }
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return { ok: false, error: 'Not found.' }
  const { data, error } = await s.sb.rpc('admin_read_reported_thread', { p_conversation: conversationId })
  if (error) return { ok: false, error: error.message.includes('not been reported') ? 'This thread has not been reported.' : friendlyError(error.message) }
  const rows = (data ?? []) as { id: number; sender_id: string; body: string; attachment_path: string | null; created_at: string }[]
  const ids = [...new Set(rows.map((r) => r.sender_id))]
  const { data: profs } = ids.length ? await s.sb.from('profiles').select('id,username').in('id', ids) : { data: [] }
  const names = new Map(((profs ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]))
  revalidatePath('/admin/audit/')
  return { ok: true, data: rows.map((r) => ({ id: r.id, sender: names.get(r.sender_id) ?? 'unknown', body: r.body, hasAttachment: Boolean(r.attachment_path), created_at: r.created_at })) }
}

const intervalsSchema = z.object({ watch: z.coerce.number().int().min(30).max(86400), discovery: z.coerce.number().int().min(300).max(604800) })

export async function setRetailerIntervals(slug: string, form: FormData): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const p = intervalsSchema.safeParse({ watch: form.get('watch'), discovery: form.get('discovery') })
  if (!p.success) return { ok: false, error: 'Watch: 30 s or more. Discovery: 300 s or more.' }
  const { error } = await s.sb.from('retailers').update({ watch_interval_seconds: p.data.watch, discovery_interval_seconds: p.data.discovery }).eq('slug', slug)
  revalidatePath('/admin/drops/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Saved.' }
}

export async function deleteWatch(id: number): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const { error } = await s.sb.from('watchlist').delete().eq('id', id)
  revalidatePath('/admin/drops/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

export async function setWatchEnabled(id: number, enabled: boolean): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const { error } = await s.sb.from('watchlist').update({ enabled }).eq('id', id)
  revalidatePath('/admin/drops/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

export async function deleteRrp(id: number): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const { error } = await s.sb.from('rrp_reference').delete().eq('id', id)
  revalidatePath('/admin/drops/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

/** Form wrappers for the drops page. */
export async function addRrpForm(form: FormData): Promise<ActionResult> {
  const setCode = String(form.get('set_code') ?? '').trim()
  return upsertRrp({ game: form.get('game'), productType: String(form.get('product_type') ?? '').trim(), setCode: setCode || null, rrpAud: Number(form.get('rrp_aud')) })
}

const WATCH_KINDS = ['include_keyword', 'exclude_keyword', 'set_code', 'sku', 'url'] as const

export async function addWatchForm(form: FormData): Promise<ActionResult> {
  const kind = WATCH_KINDS.find((k) => k === form.get('kind'))
  const value = String(form.get('value') ?? '').trim()
  const game = String(form.get('game') ?? '')
  if (!kind) return { ok: false, error: 'Pick a type.' }
  if (!value) return { ok: false, error: 'Enter a value.', field: 'value' }
  if (kind === 'url' && !/^https:\/\//.test(value)) return { ok: false, error: 'URLs must start with https://', field: 'value' }
  return upsertWatch(kind, value, game === 'pokemon' || game === 'one-piece' ? game : null)
}

const manualSchema = z.object({
  productId: z.coerce.number().int().positive(),
  eventType: z.enum(['NEW_LISTING', 'PREORDER_OPEN', 'IN_STOCK', 'PRICE_CHANGE', 'QUEUE_LIVE']),
  price: z.union([z.literal(''), z.coerce.number().positive().max(100000)]),
})

/** Manual "send alert": inserts a drop_events row (manual=true); the enqueue trigger fans it out like any other event. */
export async function sendManualAlert(form: FormData): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const p = manualSchema.safeParse({ productId: form.get('product_id'), eventType: form.get('event_type'), price: String(form.get('price') ?? '').trim() })
  if (!p.success) return { ok: false, error: 'Pick a retail product and an event type.' }
  const { data: prod } = await s.sb.from('retail_products').select('id,game,product_type,set_code').eq('id', p.data.productId).maybeSingle()
  if (!prod) return { ok: false, error: 'Retail product not found.' }
  const price = p.data.price === '' ? null : p.data.price
  let rrp: number | null = null
  if (prod.game && prod.product_type) {
    const { data: refs } = await s.sb.from('rrp_reference').select('rrp_aud,set_code').eq('game', prod.game).eq('product_type', prod.product_type)
    const list = (refs ?? []) as { rrp_aud: number; set_code: string | null }[]
    const hit = list.find((r) => r.set_code && r.set_code === prod.set_code) ?? list.find((r) => !r.set_code)
    rrp = hit ? Number(hit.rrp_aud) : null
  }
  const { data: tol } = await s.sb.from('site_settings').select('value').eq('key', 'drops.rrp_tolerance_pct').maybeSingle()
  const tag = rrpTag(price, rrp, typeof tol?.value === 'number' ? tol.value : 2)
  const now = new Date().toISOString()
  const { error } = await s.sb.from('drop_events').insert({
    retail_product_id: prod.id, event_type: p.data.eventType, price_aud: price, rrp_aud: rrp, rrp_tag: tag.tag, rrp_delta_pct: tag.deltaPct,
    dedupe_key: `manual:${prod.id}:${p.data.eventType}:${Date.now()}`, occurred_at: now, manual: true, created_by: s.me.id,
  })
  revalidatePath('/admin/drops/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Alert sent to the delivery queue.' }
}

/** Admin-only overrides from the user page form. Empty fields clear the override. */
export async function saveUserOverridesForm(userId: string, form: FormData): Promise<ActionResult> {
  const tierRaw = String(form.get('tier') ?? '')
  const tier = tierRaw === 'free' || tierRaw === 'premium' ? tierRaw : null
  const quotaRaw = String(form.get('quota') ?? '').trim()
  if (quotaRaw && !/^\d{1,5}$/.test(quotaRaw)) return { ok: false, error: 'Quota must be a whole number.', field: 'quota' }
  const roleRaw = String(form.get('role') ?? '')
  const role = (['user', 'editor', 'moderator', 'admin'] as const).find((r) => r === roleRaw)
  const me = await currentUserWithRole()
  if (me && me.id === userId && role && role !== 'admin') return { ok: false, error: 'You cannot remove your own admin role.' }
  const r = await setUserOverrides(userId, tier, quotaRaw ? Number(quotaRaw) : null, role)
  return r.ok ? { ok: true, message: 'Saved.' } : r
}

export async function suspendUserForm(userId: string, form: FormData): Promise<ActionResult> {
  const days = Number(form.get('days'))
  if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: 'Choose 1–365 days.', field: 'days' }
  const r = await setUserStatus(userId, 'suspended', days)
  return r.ok ? { ok: true, message: `Suspended for ${days} days.` } : r
}

export async function resolveReportForm(id: number, form: FormData): Promise<ActionResult> {
  const status = form.get('status') === 'actioned' ? 'actioned' : 'dismissed'
  const note = String(form.get('note') ?? '').trim()
  if (!note) return { ok: false, error: 'Add a short note for the record.', field: 'note' }
  const r = await resolveReport(id, status, note)
  return r.ok ? { ok: true, message: status === 'actioned' ? 'Marked actioned.' : 'Dismissed.' } : r
}

export async function removeListingForm(id: number, form: FormData): Promise<ActionResult> {
  const reason = String(form.get('reason') ?? '').trim()
  if (!reason) return { ok: false, error: 'Give a reason.', field: 'reason' }
  const r = await removeListing(id, reason)
  return r.ok ? { ok: true, message: 'Removed.' } : r
}

// ---------------------------------------------------------------------------
// Stores (live stock monitor). Generic Shopify / WooCommerce stores are read
// from the catalogue they publish openly; a store that blocks automated access
// gets a blocked_reason and is covered by member sightings instead.

/** "Add a store": admin only, validated with zod; the audit trigger records the insert. */
export async function addStore(form: FormData): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const p = newStoreSchema.safeParse(readNewStore(form))
  if (!p.success) {
    const issue = p.error.issues[0]
    return { ok: false, error: issue?.message ?? 'Check the store fields.', field: issue?.path[0] === 'baseUrl' ? 'base_url' : String(issue?.path[0] ?? '') }
  }
  const d = p.data
  const slug = storeSlug(d.name)
  if (!slug) return { ok: false, error: 'That name clashes with a page or state code; add a word (e.g. the suburb).', field: 'name' }
  const adapter = adapterFor(d.platform)
  if (d.enabled && adapter === 'none') return { ok: false, error: 'Only Shopify and WooCommerce stores can be monitored straight away. Custom stores need an adapter first.', field: 'enabled' }
  const { data: iv } = await s.sb.from('site_settings').select('value').eq('key', 'stock.default_interval_seconds').maybeSingle()
  const interval = typeof iv?.value === 'number' && iv.value >= 30 ? iv.value : 120
  const { error } = await s.sb.from('retailers').insert({
    slug, name: d.name, base_url: d.baseUrl, adapter, platform: d.platform, config: buildStoreConfig(d), kind: d.kind || null, state: d.state || null,
    enabled: d.enabled, watch_interval_seconds: interval,
  })
  revalidatePath('/admin/drops/')
  revalidatePath('/drops/stores/')
  if (error) return { ok: false, error: error.code === '23505' ? 'A store with that name already exists.' : friendlyError(error.message) }
  return { ok: true, message: `Added ${d.name} (/drops/${slug}/).` }
}

/** Platform, collections/categories, keywords, games, kind, state and blocked reason for an existing store. */
export async function saveStoreSettings(slug: string, form: FormData): Promise<ActionResult> {
  const s = await staff([])
  if (!s) return { ok: false, error: 'Admins only.' }
  const p = storeSettingsSchema.safeParse({ ...readConfigFields(form), blockedReason: String(form.get('blocked_reason') ?? '') })
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Check the store fields.' }
  const { data: cur } = await s.sb.from('retailers').select('adapter,config,enabled').eq('slug', slug).maybeSingle()
  if (!cur) return { ok: false, error: 'Store not found.' }
  const d = p.data
  const adapter = adapterFor(d.platform, cur.adapter)
  const { error } = await s.sb
    .from('retailers')
    .update({
      platform: d.platform, adapter, config: buildStoreConfig(d, (cur.config ?? {}) as Record<string, unknown>), kind: d.kind || null, state: d.state || null,
      blocked_reason: d.blockedReason || null,
      // A store without an adapter can't stay switched on (retailers_enable_needs_adapter).
      ...(adapter === 'none' ? { enabled: false } : {}),
    })
    .eq('slug', slug)
  revalidatePath('/admin/drops/')
  revalidatePath('/drops/stores/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: adapter === 'none' && cur.enabled ? 'Saved. Monitoring is off: this store has no adapter.' : 'Saved.' }
}
