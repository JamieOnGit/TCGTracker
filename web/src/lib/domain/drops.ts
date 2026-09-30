/**
 * Pure helpers for the public drops pages: labels for member sightings, the
 * /drops/<slug>/ router (retailer or state) and the thin-page check.
 * Client-safe: no data access here.
 */
import { AU_STATES, type AuState, type DropRow, type SightingInfo } from '@/lib/data/types'

export type DropSource = 'monitor' | 'member'

/** `?source=` on /drops/: anything unknown means "all". */
export function parseDropSource(raw: string | string[] | undefined): DropSource | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === 'monitor' || v === 'member' ? v : undefined
}

/** `/drops/vic/` → 'VIC'. Retailer slugs never collide with state codes. */
export function stateFromSlug(slug: string): AuState | null {
  const up = slug.toUpperCase()
  return slug === slug.toLowerCase() && (AU_STATES as readonly string[]).includes(up) ? (up as AuState) : null
}

/** "Kmart Chadstone, VIC" (in store) or "Kmart, VIC" without a suburb; "Kmart online" for online reports. */
export function sightingPlace(retailerName: string, s: Pick<SightingInfo, 'channel' | 'suburb' | 'state'>): string {
  if (s.channel === 'online') return `${retailerName} online`
  const where = [retailerName, s.suburb?.trim()].filter(Boolean).join(' ')
  return s.state ? `${where}, ${s.state}` : where
}

export const QUANTITY_LABEL: Record<NonNullable<SightingInfo['quantity']>, string> = {
  few: 'A few left',
  some: 'Some on the shelf',
  plenty: 'Plenty on the shelf',
}

export function purchaseLimitLabel(limit: number | null): string | null {
  return limit && limit > 0 ? `Limit ${limit} per customer` : null
}

export function confirmationsLabel(n: number): string | null {
  if (n <= 0) return null
  return `Confirmed by ${n} ${n === 1 ? 'member' : 'members'}`
}

/** 360 → "6 hours", 1440 → "24 hours", 90 → "90 minutes", 60 → "1 hour". */
export function durationLabel(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`
  const h = minutes / 60
  return `${h} ${h === 1 ? 'hour' : 'hours'}`
}

/** Thin-page guard: a state page with nothing in the last `days` is noindex,follow. */
export function hasRecentDrops(rows: Pick<DropRow, 'occurredAt'>[], now: Date, days = 90): boolean {
  const since = now.getTime() - days * 86_400_000
  return rows.some((r) => new Date(r.occurredAt).getTime() >= since)
}
