'use server'
import { revalidatePath } from 'next/cache'
import { supabaseForRequest, supabaseService } from '@/lib/supabase/server'
import { parseAud } from '@/lib/account/format'
import { DROP_CHANNELS, dropSetupSchema, parseKeywords } from '@/lib/account/sightings'
import { friendlyError, type ActionResult } from './result'

/**
 * The drop-alert setup wizard (/account/alerts/drops/). Takes plain FormData
 * so the page works as one ordinary form without JavaScript; the client
 * adds keyword chips and step-by-step sections on top.
 */
export async function saveDropSetup(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  const id = auth.user?.id
  if (!id) return { ok: false, error: 'Sign in again.' }

  const strings = (k: string) => form.getAll(k).map(String)
  const maxRaw = String(form.get('max_price') ?? '').trim()
  const maxPrice = maxRaw ? parseAud(maxRaw) : null
  if (maxRaw && maxPrice === null) return { ok: false, error: 'Enter a maximum price in dollars, or leave it blank.', field: 'max_price' }
  const parsed = dropSetupSchema.safeParse({
    games: strings('game'),
    retailerSlugs: form.get('all_retailers') === 'on' ? null : strings('retailer'),
    states: form.get('all_states') === 'on' ? null : strings('state'),
    keywords: parseKeywords(strings('keyword'), String(form.get('keywords_text') ?? '')),
    maxPriceAud: maxPrice,
    onlyAtOrBelowRrp: form.get('rrp') === 'on',
    includeSightings: form.get('include_sightings') === 'on',
    channels: Object.fromEntries(DROP_CHANNELS.map((c) => [c, form.get(`channel_${c}`) === 'on'])),
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: issue?.message ?? 'Check the form.', field: issue?.path[0]?.toString() }
  }
  const v = parsed.data

  const [{ data: existing }, { data: premium }] = await Promise.all([
    sb.from('drop_alert_filters').select('onboarded_at').eq('user_id', id).maybeSingle(),
    sb.rpc('is_premium', { p_user: id }),
  ])
  const now = new Date().toISOString()
  const { error } = await sb.from('drop_alert_filters').upsert({
    user_id: id,
    games: v.games,
    retailer_slugs: v.retailerSlugs,
    states: v.states,
    keywords: v.keywords.length ? v.keywords : null,
    max_price_aud: v.maxPriceAud,
    only_at_or_below_rrp: v.onlyAtOrBelowRrp,
    include_sightings: v.includeSightings,
    onboarded_at: (existing?.onboarded_at as string | null) ?? now,
    updated_at: now,
  })
  if (error) return { ok: false, error: friendlyError(error.message) }

  // Discord drop alerts are a Premium feature.
  const channels = { ...v.channels, discord: v.channels.discord && premium === true }
  const { error: prefErr } = await sb
    .from('notification_preferences')
    .upsert(DROP_CHANNELS.map((c) => ({ user_id: id, alert_type: 'drop', channel: c, enabled: channels[c], updated_at: now })))
  revalidatePath('/account/alerts/')
  revalidatePath('/account/')
  if (prefErr) return { ok: false, error: friendlyError(prefErr.message) }
  return { ok: true, message: 'Drop alerts saved. We’ll let you know when stock matching this turns up.' }
}

/**
 * "Send me a test alert": an on-site notification for the member only.
 * Members can't insert notifications themselves (RLS), so this uses the
 * service role, scoped to the signed-in member's own id.
 */
export async function sendTestAlert(): Promise<ActionResult> {
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  const id = auth.user?.id
  if (!id) return { ok: false, error: 'Sign in again.' }
  let svc
  try {
    svc = supabaseService()
  } catch {
    return { ok: false, error: 'Test alerts aren’t available on this server yet.' }
  }
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await svc.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', id).contains('data', { test: true }).gt('created_at', since)
  if ((count ?? 0) > 0) return { ok: false, error: 'We just sent one. Check your notifications, or try again in a minute.' }
  const { error } = await svc.from('notifications').insert({
    user_id: id,
    type: 'system',
    title: 'Test alert: your drop alerts are working',
    body: 'This is what a restock or member sighting alert looks like. Tap it to adjust your drop alerts.',
    url: '/account/alerts/drops/',
    data: { test: true },
  })
  revalidatePath('/account/notifications/')
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Sent — check Notifications (the bell at the top).' }
}
