import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/server'

/*
 * Read helpers for the admin console. Each runs as the signed-in staff member
 * (RLS decides what they see) except where noted: a few tables have no staff
 * read policy by design (auth emails, delivery fan-out, reported-thread
 * metadata), and those use the service role only AFTER requireSection().
 */

export interface CardRef {
  id: string
  name: string
  number: string
  variant: string
  game: 'pokemon' | 'one-piece'
  lang: 'en' | 'jp'
  slug?: string
  set: { name: string; code: string; slug?: string } | null
}

const CARD_COLS = 'id,name,number,variant,game,lang,slug,set:sets(name,code,slug)'

export function listingImageUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/listing-images/${path.split('/').map(encodeURIComponent).join('/')}`
}

async function count(q: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count: n } = await q
  return n ?? 0
}

// ------------------------------------------------------------------ overview
export interface PipelineRun {
  id: number
  job: string
  status: 'running' | 'succeeded' | 'failed'
  started_at: string
  finished_at: string | null
  error: string | null
  stats: Record<string, unknown>
}

export async function latestPipelineRuns(sb: SupabaseClient): Promise<PipelineRun[]> {
  const { data } = await sb.from('pipeline_runs').select('id,job,status,started_at,finished_at,error,stats').order('started_at', { ascending: false }).limit(300)
  const seen = new Set<string>()
  const out: PipelineRun[] = []
  for (const r of (data ?? []) as unknown as PipelineRun[]) {
    if (seen.has(r.job)) continue
    seen.add(r.job)
    out.push(r)
  }
  return out.sort((a, b) => a.job.localeCompare(b.job))
}

export async function overviewCounts(sb: SupabaseClient, role: string) {
  const isAdmin = role === 'admin'
  const isMod = isAdmin || role === 'moderator'
  const [pending, reports, mapping, failedEmails, drafts, sightings] = await Promise.all([
    isMod ? count(sb.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'pending_review')) : Promise.resolve(null),
    isMod ? count(sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')) : Promise.resolve(null),
    isAdmin ? count(sb.from('mapping_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending')) : Promise.resolve(null),
    isAdmin ? count(sb.from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'failed')) : Promise.resolve(null),
    role === 'editor' || isAdmin ? count(sb.from('articles').select('id', { count: 'exact', head: true }).in('status', ['draft', 'in_review'])) : Promise.resolve(null),
    // Member sightings waiting on a person: pending, or flagged as fake while still live.
    isMod ? count(sb.from('sightings').select('id', { count: 'exact', head: true }).or('status.eq.pending,and(flag_count.gt.0,status.eq.confirmed,gone_at.is.null)')) : Promise.resolve(null),
  ])
  return { pending, reports, mapping, failedEmails, drafts, sightings }
}

// ------------------------------------------------------------------ retailers
export interface RetailerRow {
  id: string
  slug: string
  name: string
  base_url: string
  adapter: string
  enabled: boolean
  watch_interval_seconds: number
  discovery_interval_seconds: number
  last_success_at: string | null
  last_error_at: string | null
  last_error: string | null
  consecutive_errors: number
  zero_product_cycles: number
}

export async function retailers(sb: SupabaseClient): Promise<RetailerRow[]> {
  const { data } = await sb.from('retailers').select('id,slug,name,base_url,adapter,enabled,watch_interval_seconds,discovery_interval_seconds,last_success_at,last_error_at,last_error,consecutive_errors,zero_product_cycles').order('name')
  return (data ?? []) as unknown as RetailerRow[]
}

export async function settingValues(sb: SupabaseClient, keys: string[]): Promise<Record<string, unknown>> {
  const { data } = await sb.from('site_settings').select('key,value').in('key', keys)
  return Object.fromEntries(((data ?? []) as unknown as { key: string; value: unknown }[]).map((r) => [r.key, r.value]))
}

// ------------------------------------------------------------------ listings
export interface QueueListing {
  id: number
  title: string
  description: string
  listing_type: 'graded_single' | 'raw_single' | 'sealed'
  lang: 'en' | 'jp'
  grader: string | null
  grade: number | null
  grade_key: string
  cert_number: string | null
  cert_verified: boolean
  cert_mismatch: boolean
  condition: string | null
  price_aud: number
  location_state: string
  submitted_at: string | null
  created_at: string
  seller_id: string
  card: CardRef | null
  sealed: { name: string; type: string } | null
  images: { storage_path: string; kind: string; position: number }[]
  floor: number | null
  flags: { word: string; severity: string }[]
  seller: { username: string; created_at: string; listings: number; rejected: number; reports: number }
}

export async function pendingQueue(sb: SupabaseClient): Promise<QueueListing[]> {
  const { data } = await sb
    .from('listings')
    .select(`id,title,description,listing_type,lang,grader,grade,grade_key,cert_number,cert_verified,cert_mismatch,condition,price_aud,location_state,submitted_at,created_at,seller_id,card:cards(${CARD_COLS}),sealed:sealed_products(name,type),images:listing_images(storage_path,kind,position)`)
    .eq('status', 'pending_review')
    .order('submitted_at', { ascending: true, nullsFirst: true })
    .limit(50)
  type Raw = Omit<QueueListing, 'floor' | 'flags' | 'seller'> & { card_id?: string }
  const rows = (data ?? []) as unknown as Raw[]
  if (!rows.length) return []
  const sellerIds = [...new Set(rows.map((r) => r.seller_id))]
  const cardIds = [...new Set(rows.map((r) => r.card?.id).filter((x): x is string => Boolean(x)))]
  const [floors, profiles, sellerListings, flags] = await Promise.all([
    cardIds.length ? sb.from('floor_prices').select('card_id,grade_key,floor_aud').in('card_id', cardIds) : Promise.resolve({ data: [] }),
    sb.from('profiles').select('id,username,created_at').in('id', sellerIds),
    sb.from('listings').select('id,seller_id,status').in('seller_id', sellerIds).limit(5000),
    Promise.all(rows.map((r) => sb.rpc('listing_banned_words', { p_text: `${r.title} ${r.description}` }))),
  ])
  const sl = (sellerListings.data ?? []) as unknown as { id: number; seller_id: string; status: string }[]
  const listingIds = sl.map((l) => String(l.id))
  const { data: reps } = await sb
    .from('reports')
    .select('target_type,target_id')
    .or(`and(target_type.eq.user,target_id.in.(${sellerIds.join(',')})),and(target_type.eq.listing,target_id.in.(${listingIds.join(',') || '0'}))`)
  const reportsBySeller = new Map<string, number>()
  const listingSeller = new Map(sl.map((l) => [String(l.id), l.seller_id]))
  for (const r of (reps ?? []) as unknown as { target_type: string; target_id: string }[]) {
    const sid = r.target_type === 'user' ? r.target_id : listingSeller.get(r.target_id)
    if (sid) reportsBySeller.set(sid, (reportsBySeller.get(sid) ?? 0) + 1)
  }
  const floorMap = new Map(((floors.data ?? []) as unknown as { card_id: string; grade_key: string; floor_aud: number }[]).map((f) => [`${f.card_id}|${f.grade_key}`, Number(f.floor_aud)]))
  const profMap = new Map(((profiles.data ?? []) as unknown as { id: string; username: string; created_at: string }[]).map((p) => [p.id, p]))
  return rows.map((r, i) => {
    const mine = sl.filter((l) => l.seller_id === r.seller_id)
    const p = profMap.get(r.seller_id)
    return {
      ...r,
      price_aud: Number(r.price_aud),
      images: [...(r.images ?? [])].sort((a, b) => a.position - b.position),
      floor: r.card ? floorMap.get(`${r.card.id}|${r.grade_key}`) ?? null : null,
      flags: ((flags[i]?.data ?? []) as unknown as { word: string; severity: string }[]),
      seller: {
        username: p?.username ?? 'unknown',
        created_at: p?.created_at ?? '',
        listings: mine.length,
        rejected: mine.filter((l) => l.status === 'rejected').length,
        reports: reportsBySeller.get(r.seller_id) ?? 0,
      },
    }
  })
}

export interface LiveListing {
  id: number
  title: string
  status: string
  lang: 'en' | 'jp'
  grade_key: string
  price_aud: number
  approved_at: string | null
  expires_at: string | null
  featured_until: string | null
  card: CardRef | null
  seller: { username: string } | null
  featured: boolean
}

export async function liveListings(sb: SupabaseClient, q: string | undefined, status: string): Promise<LiveListing[]> {
  let query = sb
    .from('listings')
    .select(`id,title,status,lang,grade_key,price_aud,approved_at,expires_at,featured_until,card:cards(${CARD_COLS}),seller:profiles!listings_seller_id_fkey(username)`)
    .eq('status', status)
    .order('approved_at', { ascending: false, nullsFirst: false })
    .limit(50)
  const term = q?.trim()
  if (term) {
    if (/^\d+$/.test(term)) query = query.eq('id', Number(term))
    else query = query.ilike('title', `%${term.replace(/[%_,()]/g, ' ')}%`)
  }
  const { data } = await query
  return ((data ?? []) as unknown as LiveListing[]).map((l) => ({
    ...l,
    price_aud: Number(l.price_aud),
    featured: Boolean(l.featured_until && Date.parse(l.featured_until) > Date.now()),
  }))
}

// ------------------------------------------------------------------ mapping
export interface MappingItem {
  id: number
  source: string
  external_id: string
  payload: Record<string, unknown>
  game: 'pokemon' | 'one-piece' | null
  lang: 'en' | 'jp' | null
  confidence: number | null
  reasons: unknown
  created_at: string
  suggested: CardRef | null
}

export async function mappingQueue(sb: SupabaseClient): Promise<MappingItem[]> {
  const { data } = await sb
    .from('mapping_queue')
    .select(`id,source,external_id,payload,game,lang,confidence,reasons,created_at,suggested:cards!mapping_queue_suggested_card_id_fkey(${CARD_COLS})`)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)
  return ((data ?? []) as unknown as MappingItem[]).map((m) => ({ ...m, confidence: m.confidence === null ? null : Number(m.confidence) }))
}

// ------------------------------------------------------------------ users
export interface UserRow {
  id: string
  username: string
  display_name: string | null
  created_at: string
  email: string | null
  priv: { role: string; status: string; suspended_until: string | null; tier_override: string | null; quota_override: number | null; trusted_seller: boolean } | null
}

/** Email lookup through the Auth admin API (service role, server only, after the role check). */
async function authUsersByEmail(q: string): Promise<{ id: string; email: string }[]> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=50&filter=${encodeURIComponent(q)}`
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return []
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' })
  if (!res.ok) return []
  const body = (await res.json()) as { users?: { id: string; email?: string }[] }
  const needle = q.toLowerCase()
  // Older GoTrue versions ignore `filter`, so match here as well.
  return (body.users ?? []).filter((u) => u.email?.toLowerCase().includes(needle)).map((u) => ({ id: u.id, email: u.email ?? '' }))
}

export async function emailsFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!ids.length) return out
  const svc = supabaseService()
  await Promise.all(
    ids.slice(0, 50).map(async (id) => {
      const { data } = await svc.auth.admin.getUserById(id)
      if (data.user?.email) out.set(id, data.user.email)
    }),
  )
  return out
}

export async function searchUsers(sb: SupabaseClient, q: string | undefined): Promise<UserRow[]> {
  const term = (q ?? '').trim().slice(0, 80)
  let ids: string[] = []
  const emailHits = new Map<string, string>()
  if (term) {
    const [byName, byEmail] = await Promise.all([
      sb.from('profiles').select('id').ilike('username', `%${term.replace(/[%_,()]/g, '')}%`).limit(25),
      authUsersByEmail(term),
    ])
    ids = ((byName.data ?? []) as unknown as { id: string }[]).map((r) => r.id)
    for (const u of byEmail) {
      emailHits.set(u.id, u.email)
      if (!ids.includes(u.id)) ids.push(u.id)
    }
    if (!ids.length) return []
  }
  let query = sb.from('profiles').select('id,username,display_name,created_at').order('created_at', { ascending: false }).limit(25)
  if (term) query = query.in('id', ids.slice(0, 50))
  const { data } = await query
  const profiles = (data ?? []) as unknown as Omit<UserRow, 'email' | 'priv'>[]
  const pids = profiles.map((p) => p.id)
  const [{ data: privs }, emails] = await Promise.all([
    sb.from('profile_private').select('user_id,role,status,suspended_until,tier_override,quota_override,trusted_seller').in('user_id', pids.length ? pids : ['00000000-0000-0000-0000-000000000000']),
    emailsFor(pids.filter((id) => !emailHits.has(id))),
  ])
  const privMap = new Map(((privs ?? []) as unknown as (UserRow['priv'] & { user_id: string })[]).map((p) => [p!.user_id, p]))
  return profiles.map((p) => ({ ...p, email: emailHits.get(p.id) ?? emails.get(p.id) ?? null, priv: privMap.get(p.id) ?? null }))
}

export async function userDetail(sb: SupabaseClient, id: string, isAdmin: boolean) {
  const [{ data: profile }, { data: priv }, sub, { data: listings }, emails, quotaUsed, quotaLimit] = await Promise.all([
    sb.from('profiles').select('id,username,display_name,location_state,bio,created_at').eq('id', id).maybeSingle(),
    sb.from('profile_private').select('role,status,suspended_until,tier_override,quota_override,trusted_seller,timezone,staff_notes,premium_until').eq('user_id', id).maybeSingle(),
    isAdmin ? sb.from('subscriptions').select('tier,status,current_period_end,cancel_at_period_end,grace_until').eq('user_id', id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('listings').select('id,title,status,price_aud,lang,grade_key,submitted_at,rejection_reason').eq('seller_id', id).order('created_at', { ascending: false }).limit(30),
    emailsFor([id]),
    sb.rpc('quota_used', { p_user: id }),
    sb.rpc('quota_limit', { p_user: id }),
  ])
  if (!profile) return null
  const listingIds = ((listings ?? []) as unknown as { id: number }[]).map((l) => String(l.id))
  const [{ data: against }, { data: filed }] = await Promise.all([
    sb.from('reports').select('id,target_type,target_id,reason,details,status,created_at').or(`and(target_type.eq.user,target_id.eq.${id}),and(target_type.eq.listing,target_id.in.(${listingIds.join(',') || '0'}))`).order('created_at', { ascending: false }).limit(50),
    sb.from('reports').select('id,target_type,target_id,reason,status,created_at').eq('reporter_id', id).order('created_at', { ascending: false }).limit(20),
  ])
  return {
    profile: profile as { id: string; username: string; display_name: string | null; location_state: string | null; bio: string | null; created_at: string },
    priv: priv as { role: string; status: string; suspended_until: string | null; tier_override: 'free' | 'premium' | null; quota_override: number | null; trusted_seller: boolean; timezone: string; staff_notes: string | null; premium_until: string | null } | null,
    sub: sub.data as { tier: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean; grace_until: string | null } | null,
    email: emails.get(id) ?? null,
    listings: (listings ?? []) as unknown as { id: number; title: string; status: string; price_aud: number; lang: string; grade_key: string; submitted_at: string | null; rejection_reason: string | null }[],
    reportsAgainst: (against ?? []) as unknown as { id: number; target_type: string; target_id: string; reason: string; details: string | null; status: string; created_at: string }[],
    reportsFiled: (filed ?? []) as unknown as { id: number; target_type: string; target_id: string; reason: string; status: string; created_at: string }[],
    quota: { used: (quotaUsed.data as number | null) ?? null, limit: (quotaLimit.data as number | null) ?? null },
  }
}

// ------------------------------------------------------------------ reports
export interface ReportRow {
  id: number
  target_type: 'listing' | 'user' | 'conversation' | 'message'
  target_id: string
  reason: string
  details: string | null
  status: string
  created_at: string
  resolved_at: string | null
  resolution_note: string | null
  reporter: { username: string } | null
  preview: { title: string; href?: string; meta?: string; conversationId?: string }
}

export async function reportsList(sb: SupabaseClient, status: string): Promise<ReportRow[]> {
  const { data } = await sb
    .from('reports')
    .select('id,target_type,target_id,reason,details,status,created_at,resolved_at,resolution_note,reporter:profiles!reports_reporter_id_fkey(username)')
    .eq('status', status)
    .order('created_at', { ascending: status === 'open' })
    .limit(100)
  const rows = (data ?? []) as unknown as Omit<ReportRow, 'preview'>[]
  const ids = (t: string) => [...new Set(rows.filter((r) => r.target_type === t).map((r) => r.target_id))]
  const listingIds = ids('listing').filter((x) => /^\d+$/.test(x))
  const userIds = ids('user')
  const convIds = ids('conversation')
  const msgIds = ids('message').filter((x) => /^\d+$/.test(x))
  const [{ data: ls }, { data: us }] = await Promise.all([
    listingIds.length ? sb.from('listings').select('id,title,status,seller:profiles!listings_seller_id_fkey(username)').in('id', listingIds) : Promise.resolve({ data: [] }),
    userIds.length ? sb.from('profiles').select('id,username').in('id', userIds) : Promise.resolve({ data: [] }),
  ])
  // Moderators cannot read conversations through RLS (participants only).
  // Only the metadata of REPORTED threads is looked up here, never message bodies.
  const svc = convIds.length || msgIds.length ? supabaseService() : null
  const msgConv = new Map<string, string>()
  if (svc && msgIds.length) {
    const { data: ms } = await svc.from('messages').select('id,conversation_id').in('id', msgIds)
    for (const m of (ms ?? []) as unknown as { id: number; conversation_id: string }[]) msgConv.set(String(m.id), m.conversation_id)
  }
  const allConv = [...new Set([...convIds, ...msgConv.values()])]
  const convMeta = new Map<string, { listing: string; buyer: string; seller: string }>()
  if (svc && allConv.length) {
    const { data: cs } = await svc.from('conversations').select('id,listing:listings(title),buyer:profiles!conversations_buyer_id_fkey(username),seller:profiles!conversations_seller_id_fkey(username)').in('id', allConv)
    for (const c of (cs ?? []) as unknown as { id: string; listing: { title: string } | null; buyer: { username: string } | null; seller: { username: string } | null }[]) {
      convMeta.set(c.id, { listing: c.listing?.title ?? 'listing', buyer: c.buyer?.username ?? '?', seller: c.seller?.username ?? '?' })
    }
  }
  const lMap = new Map(((ls ?? []) as unknown as { id: number; title: string; status: string; seller: { username: string } | null }[]).map((l) => [String(l.id), l]))
  const uMap = new Map(((us ?? []) as unknown as { id: string; username: string }[]).map((u) => [u.id, u.username]))
  return rows.map((r) => {
    let preview: ReportRow['preview'] = { title: `${r.target_type} ${r.target_id}` }
    if (r.target_type === 'listing') {
      const l = lMap.get(r.target_id)
      preview = l ? { title: l.title, href: `/marketplace/listing/${l.id}/`, meta: `#${l.id} · ${l.status} · seller ${l.seller?.username ?? '?'}` } : { title: `Listing #${r.target_id}`, meta: 'not found' }
    } else if (r.target_type === 'user') {
      const u = uMap.get(r.target_id)
      preview = { title: u ? `@${u}` : 'Unknown user', href: `/admin/users/${r.target_id}/`, meta: 'member' }
    } else {
      const conv = r.target_type === 'conversation' ? r.target_id : msgConv.get(r.target_id)
      const m = conv ? convMeta.get(conv) : undefined
      preview = {
        title: m ? `Thread about “${m.listing}”` : 'Message thread',
        meta: m ? `buyer @${m.buyer} · seller @${m.seller}${r.target_type === 'message' ? ` · message #${r.target_id}` : ''}` : undefined,
        conversationId: conv,
      }
    }
    return { ...r, preview }
  })
}

// ------------------------------------------------------------------ drops
export interface DropEventRow {
  id: number
  event_type: string
  price_aud: number | null
  rrp_tag: string
  rrp_delta_pct: number | null
  occurred_at: string
  public_at: string
  suppressed: boolean
  suppressed_reason: string | null
  manual: boolean
  product: { title: string; url: string; retailer: { name: string } | null } | null
}

export async function dropsData(sb: SupabaseClient) {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const svc = supabaseService()
  const channels = ['email', 'onsite', 'discord'] as const
  const statuses = ['queued', 'sent', 'failed'] as const
  const [events, rrp, watch, products, stats] = await Promise.all([
    sb.from('drop_events').select('id,event_type,price_aud,rrp_tag,rrp_delta_pct,occurred_at,public_at,suppressed,suppressed_reason,manual,product:retail_products(title,url,retailer:retailers(name))').order('occurred_at', { ascending: false }).limit(30),
    sb.from('rrp_reference').select('id,game,lang,product_type,set_code,rrp_aud,notes,updated_at').order('game').order('product_type').limit(300),
    sb.from('watchlist').select('id,kind,value,game,priority,enabled,retailer:retailers(name)').order('kind').order('value').limit(500),
    sb.from('retail_products').select('id,title,sku,game,product_type,set_code,retailer:retailers(name)').order('last_seen_at', { ascending: false }).limit(300),
    // drop_alert_deliveries is owner-read under RLS; the admin totals use the service role.
    Promise.all(
      channels.flatMap((ch) =>
        statuses.map(async (st) => {
          const { count: n } = await svc.from('drop_alert_deliveries').select('id', { count: 'exact', head: true }).eq('channel', ch).eq('status', st).gte('deliver_at', since)
          return { channel: ch, status: st, n: n ?? 0 }
        }),
      ),
    ),
  ])
  return {
    events: ((events.data ?? []) as unknown as DropEventRow[]).map((e) => ({ ...e, price_aud: e.price_aud === null ? null : Number(e.price_aud) })),
    rrp: (rrp.data ?? []) as unknown as { id: number; game: string; lang: string | null; product_type: string; set_code: string | null; rrp_aud: number; notes: string | null; updated_at: string }[],
    watch: (watch.data ?? []) as unknown as { id: number; kind: string; value: string; game: string | null; priority: boolean; enabled: boolean; retailer: { name: string } | null }[],
    products: (products.data ?? []) as unknown as { id: number; title: string; sku: string; game: string | null; product_type: string | null; set_code: string | null; retailer: { name: string } | null }[],
    stats,
  }
}

// ------------------------------------------------------------------ emails, audit, subs
export interface OutboxRow {
  id: number
  to_email: string
  template: string
  status: string
  attempts: number
  last_error: string | null
  send_after: string
  sent_at: string | null
  created_at: string
}

export async function outbox(sb: SupabaseClient, status: string | undefined, page: number) {
  const size = 50
  let q = sb.from('email_outbox').select('id,to_email,template,status,attempts,last_error,send_after,sent_at,created_at', { count: 'exact' }).order('created_at', { ascending: false }).range((page - 1) * size, page * size - 1)
  if (status) q = q.eq('status', status)
  const { data, count: total } = await q
  return { rows: (data ?? []) as unknown as OutboxRow[], total: total ?? 0, size }
}

export interface AuditRow {
  id: number
  actor_id: string | null
  actor_role: string | null
  action: string
  target_type: string
  target_id: string | null
  before: unknown
  after: unknown
  created_at: string
  actor: { username: string } | null
}

export async function auditLog(sb: SupabaseClient, f: { actor?: string; target?: string; page: number }) {
  const size = 50
  let q = sb.from('admin_audit_log').select('id,actor_id,actor_role,action,target_type,target_id,before,after,created_at,actor:profiles(username)', { count: 'exact' }).order('created_at', { ascending: false }).range((f.page - 1) * size, f.page * size - 1)
  if (f.actor) q = q.eq('actor_id', f.actor)
  if (f.target) q = q.eq('target_type', f.target)
  const { data, count: total } = await q
  return { rows: (data ?? []) as unknown as AuditRow[], total: total ?? 0, size }
}

export async function staffMembers(sb: SupabaseClient) {
  const { data } = await sb.from('profile_private').select('user_id,role,profile:profiles(username)').neq('role', 'user').limit(200)
  return ((data ?? []) as unknown as { user_id: string; role: string; profile: { username: string } | null }[]).map((r) => ({ id: r.user_id, role: r.role, username: r.profile?.username ?? r.user_id.slice(0, 8) }))
}

export interface SubscriptionRow {
  user_id: string
  tier: string
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  grace_until: string | null
  updated_at: string
  profile: { username: string } | null
}

export async function subscriptions(sb: SupabaseClient) {
  const { data } = await sb.from('subscriptions').select('user_id,tier,status,current_period_end,cancel_at_period_end,grace_until,updated_at,profile:profiles(username)').neq('status', 'none').order('updated_at', { ascending: false }).limit(1000)
  return (data ?? []) as unknown as SubscriptionRow[]
}

export async function articles(sb: SupabaseClient) {
  const { data } = await sb.from('articles').select('id,slug,category,title,status,published_at,updated_at').order('updated_at', { ascending: false }).limit(100)
  return (data ?? []) as unknown as { id: string; slug: string; category: string; title: string; status: string; published_at: string | null; updated_at: string }[]
}
