import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseForRequest, supabaseService } from '@/lib/supabase/server'
import { quotaResetsAt } from '@/lib/domain/quota'
import { rulesFromSettings, type Rules } from '@/lib/domain/rules'
import type { ListingStatus, ListingType } from './format'

/**
 * Server-side reads for the member area. Every query runs as the signed-in
 * member (RLS decides what they can see); the service role is only used to
 * sign message-attachment URLs after RLS has shown the message to them.
 */

export interface Account {
  userId: string
  email: string | null
  username: string
  displayName: string | null
  locationState: string | null
  memberSince: string
  postcode: string | null
  marketingOptIn: boolean
  timezone: string
  role: string
  tier: 'free' | 'premium'
  sub: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; graceUntil: string | null; hasCustomer: boolean }
  quota: { used: number; limit: number; period: string; resetsAt: Date | null }
  rules: Rules
}

export async function db(): Promise<SupabaseClient> {
  return supabaseForRequest()
}

export async function getAccount(): Promise<Account | null> {
  const sb = await db()
  const { data: auth } = await sb.auth.getUser()
  const user = auth.user
  if (!user) return null
  const [profile, priv, sub, quota, settings] = await Promise.all([
    sb.from('profiles').select('username,display_name,location_state,created_at').eq('id', user.id).single(),
    sb.from('profile_private').select('postcode,marketing_opt_in,timezone,role').eq('user_id', user.id).single(),
    sb.from('subscriptions').select('status,current_period_end,cancel_at_period_end,grace_until,stripe_customer_id').eq('user_id', user.id).maybeSingle(),
    sb.rpc('my_quota'),
    sb.from('site_settings').select('key,value'),
  ])
  const q = (quota.data ?? {}) as { used?: number; limit?: number; tier?: string; period?: string; timezone?: string }
  const tz = q.timezone ?? priv.data?.timezone ?? 'Australia/Melbourne'
  const period = q.period ?? 'calendar_month'
  return {
    userId: user.id,
    email: user.email ?? null,
    username: (profile.data?.username as string) ?? 'member',
    displayName: (profile.data?.display_name as string | null) ?? null,
    locationState: (profile.data?.location_state as string | null) ?? null,
    memberSince: (profile.data?.created_at as string) ?? new Date().toISOString(),
    postcode: (priv.data?.postcode as string | null) ?? null,
    marketingOptIn: Boolean(priv.data?.marketing_opt_in),
    timezone: tz,
    role: (priv.data?.role as string) ?? 'user',
    tier: q.tier === 'premium' ? 'premium' : 'free',
    sub: {
      status: (sub.data?.status as string) ?? 'none',
      currentPeriodEnd: (sub.data?.current_period_end as string | null) ?? null,
      cancelAtPeriodEnd: Boolean(sub.data?.cancel_at_period_end),
      graceUntil: (sub.data?.grace_until as string | null) ?? null,
      hasCustomer: Boolean(sub.data?.stripe_customer_id),
    },
    quota: {
      used: q.used ?? 0,
      limit: q.limit ?? 5,
      period,
      resetsAt: period === 'calendar_month' ? quotaResetsAt(new Date(), tz) : null,
    },
    rules: rulesFromSettings((settings.data ?? []) as { key: string; value: unknown }[]),
  }
}

// ---------------------------------------------------------------- listings

export interface MyListing {
  id: number
  title: string
  listingType: ListingType
  status: ListingStatus
  priceAud: number
  qty: number
  lang: string
  grader: string | null
  grade: number | null
  condition: string | null
  rejectionReason: string | null
  changeRequest: string | null
  expiresAt: string | null
  submittedAt: string | null
  updatedAt: string
  cardName: string | null
  thumbUrl: string | null
  photoCount: number
}

const LISTING_COLS =
  'id,title,listing_type,status,price_aud,qty,lang,grader,grade,condition,rejection_reason,change_request,expires_at,submitted_at,updated_at,' +
  'cards(name,number),sealed_products(name),listing_images(storage_path,kind,position)'

export function publicImageUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/listing-images/${path.split('/').map(encodeURIComponent).join('/')}`
}

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST embed rows */
function toMyListing(r: any): MyListing {
  const imgs = ((r.listing_images ?? []) as { storage_path: string; kind: string; position: number }[]).sort((a, b) => a.position - b.position)
  return {
    id: r.id,
    title: r.title,
    listingType: r.listing_type,
    status: r.status,
    priceAud: Number(r.price_aud),
    qty: r.qty,
    lang: r.lang,
    grader: r.grader,
    grade: r.grade === null ? null : Number(r.grade),
    condition: r.condition,
    rejectionReason: r.rejection_reason,
    changeRequest: r.change_request,
    expiresAt: r.expires_at,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
    cardName: r.cards ? `${r.cards.name} ${r.cards.number}` : (r.sealed_products?.name ?? null),
    thumbUrl: imgs[0] ? publicImageUrl(imgs[0].storage_path) : null,
    photoCount: imgs.filter((i) => i.kind !== 'other').length,
  }
}

export async function myListings(userId: string): Promise<MyListing[]> {
  const sb = await db()
  const { data } = await sb.from('listings').select(LISTING_COLS).eq('seller_id', userId).order('updated_at', { ascending: false }).limit(200)
  return (data ?? []).map(toMyListing)
}

export interface CardOption {
  id: string
  name: string
  number: string
  variant: string
  game: string
  lang: 'en' | 'jp'
  setName: string
  setCode: string
  imageUrl: string | null
}

export function toCardOption(r: any): CardOption {
  return {
    id: r.id,
    name: r.name,
    number: r.number,
    variant: r.variant,
    game: r.game,
    lang: r.lang,
    setName: r.sets?.name ?? '',
    setCode: r.sets?.code ?? '',
    imageUrl: r.image_url ?? null,
  }
}

export const CARD_OPTION_COLS = 'id,name,number,variant,game,lang,image_url,sets(name,code)'

export async function getCardOption(id: string): Promise<CardOption | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const sb = await db()
  const { data } = await sb.from('cards').select(CARD_OPTION_COLS).eq('id', id).maybeSingle()
  return data ? toCardOption(data) : null
}

export interface SealedOption {
  id: string
  name: string
  type: string
  game: string
  lang: 'en' | 'jp'
  rrpAud: number | null
}

export function toSealedOption(r: any): SealedOption {
  return { id: r.id, name: r.name, type: r.type, game: r.game, lang: r.lang, rrpAud: r.rrp_aud === null ? null : Number(r.rrp_aud) }
}

export interface EditableListing {
  id: number
  status: ListingStatus
  listingType: ListingType
  card: CardOption | null
  sealed: SealedOption | null
  lang: 'en' | 'jp'
  grader: string | null
  grade: number | null
  certNumber: string | null
  condition: string | null
  title: string
  description: string
  priceAud: number
  qty: number
  locationState: string
  postcode: string | null
  pickup: boolean
  shippingOptions: { name: string; priceAud: number }[]
  changeRequest: string | null
  images: { id: number; path: string; kind: string; url: string }[]
}

export async function getEditableListing(id: number, userId: string): Promise<EditableListing | null> {
  const sb = await db()
  const { data: r } = await sb
    .from('listings')
    .select(`*,cards(${CARD_OPTION_COLS}),sealed_products(id,name,type,game,lang,rrp_aud),listing_images(id,storage_path,kind,position)`)
    .eq('id', id)
    .eq('seller_id', userId)
    .maybeSingle()
  if (!r) return null
  const imgs = ((r.listing_images ?? []) as { id: number; storage_path: string; kind: string; position: number }[]).sort((a, b) => a.position - b.position)
  const shipping = (r.shipping ?? {}) as { pickup?: boolean; options?: { name: string; priceAud: number }[] }
  return {
    id: r.id,
    status: r.status,
    listingType: r.listing_type,
    card: r.cards ? toCardOption(r.cards) : null,
    sealed: r.sealed_products ? toSealedOption(r.sealed_products) : null,
    lang: r.lang,
    grader: r.grader,
    grade: r.grade === null ? null : Number(r.grade),
    certNumber: r.cert_number,
    condition: r.condition,
    title: r.title,
    description: r.description ?? '',
    priceAud: Number(r.price_aud),
    qty: r.qty,
    locationState: r.location_state,
    postcode: r.postcode,
    pickup: Boolean(shipping.pickup),
    shippingOptions: Array.isArray(shipping.options) ? shipping.options : [],
    changeRequest: r.change_request,
    images: imgs.map((i) => ({ id: i.id, path: i.storage_path, kind: i.kind, url: publicImageUrl(i.storage_path) })),
  }
}

// ---------------------------------------------------------------- messages

export interface InboxRow {
  id: string
  listingId: number
  listingTitle: string | null
  listingPriceAud: number | null
  listingStatus: string | null
  otherId: string
  otherUsername: string
  role: 'buyer' | 'seller'
  lastMessageAt: string | null
  unread: number
  preview: string | null
}

export async function inbox(userId: string): Promise<InboxRow[]> {
  const sb = await db()
  const { data: rows } = await sb.from('my_inbox').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(100)
  const list = (rows ?? []) as { id: string; listing_id: number; buyer_id: string; seller_id: string; last_message_at: string | null; unread_count: number }[]
  if (list.length === 0) return []
  const listingIds = [...new Set(list.map((r) => r.listing_id))]
  const otherIds = [...new Set(list.map((r) => (r.buyer_id === userId ? r.seller_id : r.buyer_id)))]
  const [listings, profiles, previews] = await Promise.all([
    sb.from('listings').select('id,title,price_aud,status').in('id', listingIds),
    sb.from('profiles').select('id,username').in('id', otherIds),
    Promise.all(list.map((r) => sb.from('messages').select('body,sender_id').eq('conversation_id', r.id).order('created_at', { ascending: false }).limit(1).maybeSingle())),
  ])
  const lmap = new Map((listings.data ?? []).map((l: any) => [l.id as number, l]))
  const pmap = new Map((profiles.data ?? []).map((p: any) => [p.id as string, p.username as string]))
  return list.map((r, i) => {
    const other = r.buyer_id === userId ? r.seller_id : r.buyer_id
    const l = lmap.get(r.listing_id)
    const p = previews[i]?.data as { body: string; sender_id: string } | null | undefined
    return {
      id: r.id,
      listingId: r.listing_id,
      listingTitle: l?.title ?? null,
      listingPriceAud: l ? Number(l.price_aud) : null,
      listingStatus: l?.status ?? null,
      otherId: other,
      otherUsername: pmap.get(other) ?? 'member',
      role: r.buyer_id === userId ? 'buyer' : 'seller',
      lastMessageAt: r.last_message_at,
      unread: r.unread_count ?? 0,
      preview: p ? `${p.sender_id === userId ? 'You: ' : ''}${p.body}` : null,
    }
  })
}

export async function unreadMessageCount(): Promise<number> {
  const sb = await db()
  const { data } = await sb.from('my_inbox').select('unread_count')
  return ((data ?? []) as { unread_count: number }[]).reduce((n, r) => n + (r.unread_count ?? 0), 0)
}

export interface ThreadMessage {
  id: number
  senderId: string
  body: string
  createdAt: string
  attachmentPath: string | null
  attachmentUrl: string | null
}

export interface Thread {
  id: string
  role: 'buyer' | 'seller'
  otherId: string
  otherUsername: string
  otherPremium: boolean
  listing: { id: number; title: string | null; priceAud: number | null; status: string | null; lang: string | null; gradeText: string | null; thumbUrl: string | null }
  messages: ThreadMessage[]
  blockedByMe: boolean
  otherLastReadAt: string | null
}

/** Signed URLs for attachments on messages the member can already read (RLS checked by the caller's query). */
export async function signAttachments(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  let client: SupabaseClient
  try {
    client = supabaseService()
  } catch {
    client = await db()
  }
  const { data } = await client.storage.from('message-attachments').createSignedUrls(paths, 60 * 60)
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  return out
}

export async function getThread(conversationId: string, userId: string): Promise<Thread | null> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return null
  const sb = await db()
  const { data: c } = await sb.from('conversations').select('*').eq('id', conversationId).maybeSingle()
  if (!c) return null
  const role: 'buyer' | 'seller' = c.buyer_id === userId ? 'buyer' : 'seller'
  const otherId = role === 'buyer' ? c.seller_id : c.buyer_id
  const [listing, other, msgs, block, otherTier] = await Promise.all([
    sb.from('listings').select('id,title,price_aud,status,lang,grader,grade,listing_images(storage_path,position)').eq('id', c.listing_id).maybeSingle(),
    sb.from('profiles').select('username').eq('id', otherId).maybeSingle(),
    sb.from('messages').select('id,sender_id,body,created_at,attachment_path').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(500),
    sb.from('blocks').select('blocked_id').eq('blocker_id', userId).eq('blocked_id', otherId).maybeSingle(),
    sb.rpc('is_premium', { p_user: otherId }),
  ])
  const rows = (msgs.data ?? []) as { id: number; sender_id: string; body: string; created_at: string; attachment_path: string | null }[]
  const signed = await signAttachments(rows.map((m) => m.attachment_path).filter((p): p is string => Boolean(p)))
  const l = listing.data as any
  const imgs = ((l?.listing_images ?? []) as { storage_path: string; position: number }[]).sort((a, b) => a.position - b.position)
  return {
    id: c.id,
    role,
    otherId,
    otherUsername: (other.data?.username as string) ?? 'member',
    otherPremium: otherTier.data === true,
    listing: {
      id: c.listing_id,
      title: l?.title ?? null,
      priceAud: l ? Number(l.price_aud) : null,
      status: l?.status ?? null,
      lang: l?.lang ?? null,
      gradeText: l ? (l.grader ? `${l.grader} ${Number(l.grade)}` : null) : null,
      thumbUrl: imgs[0] ? publicImageUrl(imgs[0].storage_path) : null,
    },
    messages: rows.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      createdAt: m.created_at,
      attachmentPath: m.attachment_path,
      attachmentUrl: m.attachment_path ? (signed.get(m.attachment_path) ?? null) : null,
    })),
    blockedByMe: Boolean(block.data),
    otherLastReadAt: role === 'buyer' ? c.seller_last_read_at : c.buyer_last_read_at,
  }
}

// ----------------------------------------------------------- notifications

export interface NotificationRow {
  id: number
  type: string
  title: string
  body: string | null
  url: string | null
  readAt: string | null
  createdAt: string
}

export async function notifications(limit = 50): Promise<NotificationRow[]> {
  const sb = await db()
  const { data } = await sb.from('notifications').select('id,type,title,body,url,read_at,created_at').order('created_at', { ascending: false }).limit(limit)
  return ((data ?? []) as any[]).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, readAt: n.read_at, createdAt: n.created_at }))
}

// ------------------------------------------------------------------ alerts

export interface WishlistRow {
  id: number
  cardId: string | null
  label: string
  lang: string | null
  setName: string | null
  gradeKey: string | null
  maxPriceAud: number | null
  lastNotifiedAt: string | null
  createdAt: string
}

export async function wishlist(): Promise<WishlistRow[]> {
  const sb = await db()
  const { data } = await sb
    .from('wishlist_items')
    .select('id,card_id,grade_key,max_price_aud,last_notified_at,created_at,cards(name,number,lang,sets(name)),sealed_products(name,lang)')
    .order('created_at', { ascending: false })
  return ((data ?? []) as any[]).map((w) => ({
    id: w.id,
    cardId: w.card_id,
    label: w.cards ? `${w.cards.name} ${w.cards.number}` : (w.sealed_products?.name ?? 'Item'),
    lang: w.cards?.lang ?? w.sealed_products?.lang ?? null,
    setName: w.cards?.sets?.name ?? null,
    gradeKey: w.grade_key,
    maxPriceAud: w.max_price_aud === null ? null : Number(w.max_price_aud),
    lastNotifiedAt: w.last_notified_at,
    createdAt: w.created_at,
  }))
}

export interface SavedSearchRow {
  id: number
  name: string
  query: Record<string, unknown>
  lastNotifiedAt: string | null
  createdAt: string
}

export async function savedSearches(): Promise<SavedSearchRow[]> {
  const sb = await db()
  const { data } = await sb.from('saved_searches').select('id,name,query,last_notified_at,created_at').order('created_at', { ascending: false })
  return ((data ?? []) as any[]).map((s) => ({ id: s.id, name: s.name, query: s.query ?? {}, lastNotifiedAt: s.last_notified_at, createdAt: s.created_at }))
}

export interface DropFilters {
  games: string[]
  retailerSlugs: string[] | null
  onlyAtOrBelowRrp: boolean
}

export async function dropFilters(): Promise<DropFilters> {
  const sb = await db()
  const { data } = await sb.from('drop_alert_filters').select('games,retailer_slugs,only_at_or_below_rrp').maybeSingle()
  return {
    games: (data?.games as string[] | null) ?? ['pokemon', 'one-piece'],
    retailerSlugs: (data?.retailer_slugs as string[] | null) ?? null,
    onlyAtOrBelowRrp: Boolean(data?.only_at_or_below_rrp),
  }
}

/** Phase-1 retailers (brief 9.1), in display order. Names come from the DB when readable. */
export const RETAILERS: { slug: string; name: string }[] = [
  { slug: 'jb-hi-fi', name: 'JB Hi-Fi' },
  { slug: 'big-w', name: 'BIG W' },
  { slug: 'kmart', name: 'Kmart' },
  { slug: 'target-au', name: 'Target' },
  { slug: 'eb-games', name: 'EB Games' },
  { slug: 'premium-bandai-au', name: 'Premium Bandai AU' },
]

export async function retailers(): Promise<{ slug: string; name: string; enabled: boolean }[]> {
  const sb = await db()
  const { data } = await sb.from('retailers').select('slug,name,enabled')
  const rows = new Map(((data ?? []) as { slug: string; name: string; enabled: boolean }[]).map((r) => [r.slug, r]))
  const known = RETAILERS.map((r) => ({ slug: r.slug, name: rows.get(r.slug)?.name ?? r.name, enabled: rows.get(r.slug)?.enabled ?? false }))
  const extra = [...rows.values()].filter((r) => !RETAILERS.some((k) => k.slug === r.slug))
  return [...known, ...extra]
}

export async function preferenceRows(): Promise<{ alert_type: string; channel: string; enabled: boolean }[]> {
  const sb = await db()
  const { data } = await sb.from('notification_preferences').select('alert_type,channel,enabled')
  return (data ?? []) as { alert_type: string; channel: string; enabled: boolean }[]
}
/* eslint-enable @typescript-eslint/no-explicit-any */
