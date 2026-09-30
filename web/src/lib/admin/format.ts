/** Pure formatting and calculation helpers for the admin console (unit tested). */

/** "jamie@example.com" → "ja***@e***.com". Enough to recognise, not enough to harvest. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '—'
  const at = email.lastIndexOf('@')
  if (at < 1) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  const host = dot > 0 ? domain.slice(0, dot) : domain
  const tld = dot > 0 ? domain.slice(dot) : ''
  const keep = local.length <= 2 ? 1 : 2
  return `${local.slice(0, keep)}***@${host.slice(0, 1)}***${tld}`
}

export interface DiffRow {
  key: string
  before: unknown
  after: unknown
}

/** Columns that change on every write and only add noise to a diff. */
const NOISE = new Set(['updated_at', 'updated_by', 'search'])

/**
 * Compact before/after diff for the audit log: only changed top-level keys.
 * Inserts list every (non-null) field as added; deletes list every field as removed.
 */
export function jsonDiff(before: unknown, after: unknown, limit = 40): DiffRow[] {
  const b = isObj(before) ? before : null
  const a = isObj(after) ? after : null
  if (!b && !a) return []
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].filter((k) => !NOISE.has(k))
  const rows: DiffRow[] = []
  for (const k of keys) {
    const bv = b ? b[k] : undefined
    const av = a ? a[k] : undefined
    if (b && a) {
      if (JSON.stringify(bv) !== JSON.stringify(av)) rows.push({ key: k, before: bv, after: av })
    } else if (a && av !== null && av !== undefined) {
      rows.push({ key: k, before: undefined, after: av })
    } else if (b && bv !== null && bv !== undefined) {
      rows.push({ key: k, before: bv, after: undefined })
    }
  }
  return rows.slice(0, limit)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Short, single-line rendering of a JSON value for diff cells. */
export function shortJson(v: unknown, max = 80): string {
  if (v === undefined) return '∅'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export type Health = 'ok' | 'warn' | 'down' | 'off'

export interface RetailerHealthInput {
  enabled: boolean
  last_success_at: string | null
  last_error_at: string | null
  consecutive_errors: number
  zero_product_cycles: number
  watch_interval_seconds: number
}

/**
 * Health dot for a retailer adapter. Down: 3+ consecutive errors, or no success
 * for 10 watch intervals. Warn: any recent error streak, or empty cycles past
 * the configured threshold (drops.zero_product_alert_cycles).
 */
export function retailerHealth(r: RetailerHealthInput, zeroCycleThreshold = 5, now = Date.now()): Health {
  if (!r.enabled) return 'off'
  const stale = !r.last_success_at || now - Date.parse(r.last_success_at) > r.watch_interval_seconds * 1000 * 10
  if (r.consecutive_errors >= 3 || (stale && r.last_error_at)) return 'down'
  if (r.consecutive_errors > 0 || r.zero_product_cycles >= zeroCycleThreshold || stale) return 'warn'
  return 'ok'
}

export const HEALTH_LABEL: Record<Health, string> = { ok: 'Healthy', warn: 'Degraded', down: 'Failing', off: 'Disabled' }

export function fmtDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—'
  const ms = Date.parse(endIso) - Date.parse(startIso)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  if (m < 60) return `${m}m ${rs}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** "3m ago", "2h ago", "5d ago". */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const s = Math.round((now - Date.parse(iso)) / 1000)
  if (!Number.isFinite(s)) return '—'
  if (s < 0) return `in ${fmtSpan(-s)}`
  if (s < 45) return 'just now'
  return `${fmtSpan(s)} ago`
}

function fmtSpan(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400 * 2) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/** Ask vs current floor, as a signed percent (null when no floor). */
export function pctVsFloor(price: number, floor: number | null | undefined): number | null {
  if (!floor || floor <= 0) return null
  return ((price - floor) / floor) * 100
}

/** A price this far from the floor is probably a typo worth a second look. */
export function priceLooksOff(pct: number | null): boolean {
  return pct !== null && (pct <= -60 || pct >= 300)
}

export interface SubRow {
  tier: string
  status: string
  cancel_at_period_end: boolean
  updated_at: string
}

export interface SubMetrics {
  activePremium: number
  pastDue: number
  cancelingAtPeriodEnd: number
  canceled30d: number
  mrrCents: number
  churnPct: number | null
}

/**
 * MRR = paying Premium members × monthly price. Churn (30d) = members who
 * cancelled in the last 30 days ÷ (active now + those who cancelled).
 */
export function subscriptionMetrics(rows: SubRow[], priceCents: number, now = Date.now()): SubMetrics {
  const since = now - 30 * 86_400_000
  const paying = rows.filter((r) => r.status === 'active' || r.status === 'trialing' || r.status === 'past_due')
  const activePremium = rows.filter((r) => r.status === 'active' || r.status === 'trialing').length
  const pastDue = rows.filter((r) => r.status === 'past_due').length
  const canceled30d = rows.filter((r) => r.status === 'canceled' && Date.parse(r.updated_at) >= since).length
  const denom = activePremium + canceled30d
  return {
    activePremium,
    pastDue,
    cancelingAtPeriodEnd: paying.filter((r) => r.cancel_at_period_end).length,
    canceled30d,
    mrrCents: activePremium * priceCents,
    churnPct: denom ? (canceled30d / denom) * 100 : null,
  }
}

export type RrpTag = 'AT_RRP' | 'BELOW_RRP' | 'ABOVE_RRP' | 'UNKNOWN'

/** Brief 9.4: AT RRP within the tolerance, else BELOW or ABOVE (+x%). */
export function rrpTag(price: number | null, rrp: number | null, tolerancePct = 2): { tag: RrpTag; deltaPct: number | null } {
  if (!price || !rrp || rrp <= 0) return { tag: 'UNKNOWN', deltaPct: null }
  const delta = ((price - rrp) / rrp) * 100
  const rounded = Math.round(delta * 100) / 100
  if (Math.abs(delta) <= tolerancePct) return { tag: 'AT_RRP', deltaPct: rounded }
  return { tag: delta < 0 ? 'BELOW_RRP' : 'ABOVE_RRP', deltaPct: rounded }
}

/** Parse an A$ amount typed by a person ("12.99", "$12.99", "A$1,299") into cents. */
export function audToCents(input: string): number | null {
  const s = input.replace(/[A$\s,]/gi, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s) * 100)
}

export function centsToAud(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2)
}

/** Positive integer from a query-string value, clamped. */
export function pageParam(v: string | string[] | undefined, max = 1000): number {
  const raw = Array.isArray(v) ? v[0] : v
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : 1
}
