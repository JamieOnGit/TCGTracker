/**
 * Pure helpers for the member area (account, listings, messages, alerts).
 * No server or browser APIs here, so everything is unit tested
 * (tests/unit/account.test.ts).
 */

export type ListingStatus = 'draft' | 'pending_review' | 'active' | 'rejected' | 'sold' | 'expired' | 'removed'
export type ListingType = 'graded_single' | 'raw_single' | 'sealed'

export const GRADERS = ['PSA', 'BGS', 'CGC', 'SGC', 'TAG'] as const
export type Grader = (typeof GRADERS)[number]
export const CONDITIONS = [
  { value: 'NM', label: 'Near Mint (NM)' },
  { value: 'LP', label: 'Lightly Played (LP)' },
  { value: 'MP', label: 'Moderately Played (MP)' },
  { value: 'HP', label: 'Heavily Played (HP)' },
  { value: 'DMG', label: 'Damaged (DMG)' },
] as const
export type Condition = (typeof CONDITIONS)[number]['value']
export const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const
export type AuState = (typeof AU_STATES)[number]

/** 10, 9.5, 9 … 1 */
export const GRADE_VALUES: number[] = Array.from({ length: 19 }, (_, i) => 10 - i * 0.5)

export const LISTING_TYPE_LABEL: Record<ListingType, string> = {
  graded_single: 'Graded card',
  raw_single: 'Raw card',
  sealed: 'Sealed product',
}

// ------------------------------------------------------------------ grades

/** "psa-10" -> { grader: 'PSA', grade: 10 }; "raw" -> raw; anything else -> null. */
export function parseGradeKey(key: string | null | undefined): { kind: 'graded'; grader: Grader; grade: number } | { kind: 'raw' } | null {
  if (!key) return null
  const k = key.trim().toLowerCase()
  if (k === 'raw') return { kind: 'raw' }
  const m = /^([a-z]+)-(\d{1,2}(?:\.5)?)$/.exec(k)
  if (!m) return null
  const grader = m[1]!.toUpperCase() as Grader
  const grade = Number(m[2])
  if (!(GRADERS as readonly string[]).includes(grader) || grade < 1 || grade > 10) return null
  return { kind: 'graded', grader, grade }
}

/** Mirrors public.grade_key(): "psa-10", "bgs-9.5", "raw". */
export function gradeKeyOf(grader: string | null | undefined, grade: number | null | undefined): string {
  if (!grader || grade === null || grade === undefined) return 'raw'
  return `${grader.toLowerCase()}-${trimNum(grade)}`
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)))
}

export function gradeText(grader: string | null | undefined, grade: number | null | undefined): string {
  if (!grader || grade === null || grade === undefined) return 'Raw'
  return `${grader} ${trimNum(grade)}`
}

// ------------------------------------------------------------------ titles

export interface TitleParts {
  listingType: ListingType
  name?: string | null
  number?: string | null
  setName?: string | null
  lang?: string | null
  grader?: string | null
  grade?: number | null
  condition?: string | null
}

/** Suggested listing title, e.g. "Charizard ex 199 · 151 · EN · PSA 10". Always 3–120 chars when a name is known. */
export function suggestTitle(p: TitleParts): string {
  if (!p.name) return ''
  const bits: string[] = [p.number && p.listingType !== 'sealed' ? `${p.name} ${p.number}` : p.name]
  if (p.setName && p.listingType !== 'sealed') bits.push(p.setName)
  if (p.lang) bits.push(p.lang.toUpperCase())
  if (p.listingType === 'graded_single' && p.grader && p.grade) bits.push(gradeText(p.grader, p.grade))
  else if (p.listingType === 'raw_single') bits.push(p.condition ? `Raw ${p.condition}` : 'Raw')
  else if (p.listingType === 'sealed') bits.push('Sealed')
  let title = bits.join(' · ')
  if (title.length > 120) title = title.slice(0, 119).trimEnd() + '…'
  return title
}

// ----------------------------------------------------------- listing status

export type Tone = 'neutral' | 'accent' | 'up' | 'warn' | 'down'

export interface StatusChip {
  key: ListingStatus | 'changes_requested'
  label: string
  tone: Tone
  note?: string
}

export function listingStatusChip(l: { status: ListingStatus; rejectionReason?: string | null; changeRequest?: string | null }): StatusChip {
  switch (l.status) {
    case 'draft':
      return l.changeRequest
        ? { key: 'changes_requested', label: 'Changes requested', tone: 'warn', note: l.changeRequest }
        : { key: 'draft', label: 'Draft', tone: 'neutral' }
    case 'pending_review':
      return { key: 'pending_review', label: 'Pending review', tone: 'accent' }
    case 'active':
      return { key: 'active', label: 'Active', tone: 'up' }
    case 'sold':
      return { key: 'sold', label: 'Sold', tone: 'neutral' }
    case 'expired':
      return { key: 'expired', label: 'Expired', tone: 'warn' }
    case 'rejected':
      return { key: 'rejected', label: 'Rejected', tone: 'down', note: l.rejectionReason ?? undefined }
    case 'removed':
      return { key: 'removed', label: 'Withdrawn', tone: 'neutral' }
  }
}

export type ListingAction = 'edit' | 'submit' | 'mark_sold' | 'withdraw' | 'renew' | 'view'

/** Which buttons a seller sees. Mirrors the owner transitions in listings_enforce_lifecycle(). */
export function listingActions(l: { status: ListingStatus; expiresAt?: string | null }, now: Date = new Date(), renewWindowDays = 7): ListingAction[] {
  switch (l.status) {
    case 'draft':
      return ['edit', 'submit', 'withdraw']
    case 'pending_review':
      return ['withdraw']
    case 'active': {
      const out: ListingAction[] = ['view', 'mark_sold']
      if (l.expiresAt && new Date(l.expiresAt).getTime() - now.getTime() < renewWindowDays * 86_400_000) out.push('renew')
      out.push('withdraw')
      return out
    }
    case 'expired':
      return ['renew']
    case 'sold':
      return ['view']
    default:
      return []
  }
}

/** Counts per status group for the dashboard summary. */
export function summariseListings(rows: { status: ListingStatus; changeRequest?: string | null }[]) {
  const s = { draft: 0, changes_requested: 0, pending_review: 0, active: 0, sold: 0, expired: 0, rejected: 0, removed: 0 }
  for (const r of rows) {
    if (r.status === 'draft' && r.changeRequest) s.changes_requested++
    else s[r.status]++
  }
  return s
}

// -------------------------------------------------------------------- quota

const shortDate = (d: Date, timeZone: string) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone })

/** "3 of 5 listings used this month · resets 1 Oct" */
export function quotaLine(used: number, limit: number, resetsAt: Date | null, timeZone = 'Australia/Melbourne'): string {
  const base = `${Math.min(used, limit)} of ${limit} listings used this month`
  return resetsAt ? `${base} · resets ${shortDate(resetsAt, timeZone)}` : base
}

/** 0–100 for the meter. */
export function quotaPercent(used: number, limit: number): number {
  if (limit <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
}

// ---------------------------------------------------------------- listings

/** Words the database blocks (public.banned_words, severity=block) or flags. Hints only: the DB is the enforcement. */
const BLOCKED = ['proxy', 'replica', 'orica']
const FLAGGED = ['paypal friends', 'friends and family', 'crypto only', 'western union', 'gift card']

export function bannedWordHints(text: string): { blocked: string[]; flagged: string[] } {
  const t = text.toLowerCase()
  return { blocked: BLOCKED.filter((w) => t.includes(w)), flagged: FLAGGED.filter((w) => t.includes(w)) }
}

/** Contact details in a listing description or message (they're hidden by default; brief 6.1). */
export function looksLikeContactDetails(text: string): boolean {
  return /[\w.+-]+@[\w-]+\.[\w.]+/.test(text) || /(?:\+?61|0)[\s-]?4(?:[\s-]?\d){8}/.test(text)
}

export interface ShippingOption {
  name: string
  priceAud: number
}

/** Parse the price input: "1,234.50", "A$99" -> number; empty/invalid -> null. */
export function parseAud(input: string): number | null {
  const cleaned = input.replace(/a\$|\$|,|\s/gi, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return n > 0 && n < 10_000_000 ? n : null
}

export function isPostcode(v: string): boolean {
  return /^\d{4}$/.test(v)
}

// ------------------------------------------------------------------ images

export const LISTING_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const LISTING_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024

export function checkImageFile(f: { type: string; size: number }, maxBytes: number): string | null {
  if (!(LISTING_IMAGE_TYPES as readonly string[]).includes(f.type)) return 'Use a JPEG, PNG or WebP image.'
  if (f.size > maxBytes) return `That image is over ${Math.round(maxBytes / 1024 / 1024)} MB.`
  if (f.size === 0) return 'That file is empty.'
  return null
}

export function extFor(mime: string): string {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}

/** Scale (w, h) down to fit within max on the long edge. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number; scaled: boolean } {
  const long = Math.max(w, h)
  if (long <= max) return { width: w, height: h, scaled: false }
  const k = max / long
  return { width: Math.round(w * k), height: Math.round(h * k), scaled: true }
}

/** Which photo slots a listing type needs (front/back, or slab photos for graded cards). */
export function photoSlots(t: ListingType): { kind: 'front' | 'back' | 'slab-front' | 'slab-back'; label: string }[] {
  return t === 'graded_single'
    ? [{ kind: 'slab-front', label: 'Slab front' }, { kind: 'slab-back', label: 'Slab back' }]
    : [{ kind: 'front', label: 'Front' }, { kind: 'back', label: 'Back' }]
}

// ---------------------------------------------------------------- catalogue

/** Tokens safe to put in a PostgREST or() filter: letters, digits, dots and hyphens only. */
export function searchTokens(q: string): string[] {
  return q
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s,()/"'*%:\\]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}.-]/gu, ''))
    .filter((t) => t.length > 0)
    .slice(0, 6)
}

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export interface SearchableCard {
  name: string
  number: string
  variant?: string | null
  setName?: string | null
  setCode?: string | null
}

/** Every token must appear in the card name, number, variant or set; ranked by name hits. -1 = no match. */
export function scoreCard(c: SearchableCard, tokens: string[]): number {
  if (tokens.length === 0) return -1
  const name = fold(c.name)
  const hay = fold([c.name, c.number, c.variant ?? '', c.setName ?? '', c.setCode ?? ''].join(' '))
  let score = 0
  for (const raw of tokens) {
    const t = fold(raw)
    if (!hay.includes(t)) return -1
    if (name.startsWith(t)) score += 3
    else if (name.includes(t)) score += 2
    else score += 1
  }
  return score
}

// -------------------------------------------------------------- preferences

export const ALERT_TYPES = [
  { key: 'message', label: 'New messages', hint: 'Batched: at most one email per conversation every 10 minutes.' },
  { key: 'listing_status', label: 'Listing approved, rejected or changes requested' },
  { key: 'listing_expiring', label: 'Listing about to expire' },
  { key: 'wishlist', label: 'Wishlist: a card you want is listed' },
  { key: 'saved_search', label: 'Saved-search matches' },
  { key: 'drop', label: 'Retail drops', hint: 'Premium: instant. Free: 24 hours later.' },
  { key: 'billing', label: 'Billing and receipts' },
  { key: 'weekly_digest', label: 'Weekly market digest', hint: 'Optional, off unless you turn it on.' },
  { key: 'marketing', label: 'News and offers from TCGTracker', hint: 'Opt-in only. Unsubscribe from any email in one click.' },
] as const
export type AlertType = (typeof ALERT_TYPES)[number]['key']
export const CHANNELS = [
  { key: 'email', label: 'Email' },
  { key: 'onsite', label: 'On-site' },
  { key: 'discord', label: 'Discord' },
] as const
export type Channel = (typeof CHANNELS)[number]['key']

/** Mirrors public.notification_default(): marketing and the digest are opt-in; Discord is off until linked. */
export function notificationDefault(type: string, channel: string): boolean {
  if (channel === 'discord') return false
  if (type === 'weekly_digest' || type === 'marketing') return false
  return true
}

/** Full type x channel matrix: stored rows win, otherwise the default. */
export function preferenceMatrix(rows: { alert_type: string; channel: string; enabled: boolean }[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const t of ALERT_TYPES) for (const c of CHANNELS) out[`${t.key}:${c.key}`] = notificationDefault(t.key, c.key)
  for (const r of rows) {
    const k = `${r.alert_type}:${r.channel}`
    if (k in out) out[k] = r.enabled
  }
  return out
}

// --------------------------------------------------------------------- time

/** "just now", "5 min ago", "3 h ago", "yesterday", then a date. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date(), timeZone = 'Australia/Melbourne'): string {
  if (!iso) return ''
  const t = new Date(iso)
  const s = Math.round((now.getTime() - t.getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  if (s < 2 * 86_400) return 'yesterday'
  return t.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone, ...(now.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) })
}

/** Message timestamp inside a thread: "3:42 pm" today, else "28 Sep, 3:42 pm". */
export function messageTime(iso: string, now: Date = new Date(), timeZone = 'Australia/Melbourne'): string {
  const t = new Date(iso)
  const day = (d: Date) => d.toLocaleDateString('en-AU', { timeZone })
  const time = t.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone })
  return day(t) === day(now) ? time : `${t.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone })}, ${time}`
}

/** A `next` redirect target that can't leave the site. */
export function safeNext(next: string | null | undefined, fallback = '/account/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next.slice(0, 300)
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,29}$/

/** 1299 -> "A$12.99" */
export function audFromCents(cents: number): string {
  return `A$${(cents / 100).toFixed(2)}`
}

/** Human summary of a saved-search query: "Pokémon · JP · PSA 10 · under A$500 · “charizard”". */
export function describeSearch(q: Record<string, unknown>): string {
  const bits: string[] = []
  if (q.game === 'pokemon') bits.push('Pokémon')
  if (q.game === 'one-piece') bits.push('One Piece')
  if (q.lang === 'en') bits.push('English')
  if (q.lang === 'jp') bits.push('Japanese')
  if (typeof q.grade_key === 'string') bits.push(q.grade_key === 'raw' ? 'Raw' : q.grade_key.toUpperCase().replace('-', ' '))
  if (q.listing_type === 'graded_single') bits.push('Graded')
  if (q.listing_type === 'raw_single') bits.push('Raw singles')
  if (q.listing_type === 'sealed') bits.push('Sealed')
  if (typeof q.state === 'string') bits.push(q.state)
  if (typeof q.price_min === 'number' && typeof q.price_max === 'number') bits.push(`A$${q.price_min}–A$${q.price_max}`)
  else if (typeof q.price_max === 'number') bits.push(`under A$${q.price_max}`)
  else if (typeof q.price_min === 'number') bits.push(`over A$${q.price_min}`)
  if (typeof q.q === 'string' && q.q) bits.push(`“${q.q}”`)
  return bits.length ? bits.join(' · ') : 'All new listings'
}
