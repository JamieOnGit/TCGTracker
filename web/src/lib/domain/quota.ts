/**
 * Listing quota counting (brief 2). Mirrors public.quota_used() in the
 * database, which is what actually enforces the limit; this copy powers the
 * "3 of 5 listings used this month" indicator.
 *
 * - A listing counts from its FIRST submission (draft -> pending_review),
 *   including if it is later rejected (unless rules.countRejected is false).
 * - Calendar months are in the member's timezone (default
 *   Australia/Melbourne). Unused quota doesn't roll over.
 */
import type { Rules } from './rules'

export interface QuotaListing {
  submittedAt: Date | null
  status: string
}

/** Wall-clock parts of an instant in a given IANA timezone. */
function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** Offset (ms) of a timezone from UTC at an instant. */
function tzOffset(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** Start of the quota period containing `at`. */
export function quotaPeriodStart(at: Date, timeZone: string, period: Rules['quotaPeriod']): Date {
  if (period === 'rolling_30_days') return new Date(at.getTime() - 30 * 24 * 3600 * 1000)
  const p = zonedParts(at, timeZone)
  const guess = Date.UTC(p.year, p.month - 1, 1)
  // Local midnight on the 1st = UTC midnight minus the zone's offset then.
  const offset = tzOffset(new Date(guess), timeZone)
  const start = guess - offset
  // DST can change between the guess and the real instant; re-check once.
  return new Date(guess - tzOffset(new Date(start), timeZone))
}

/** When the next calendar-month quota starts (for "Resets 1 Nov"). */
export function quotaResetsAt(at: Date, timeZone: string): Date {
  const p = zonedParts(at, timeZone)
  const nextMonth = new Date(Date.UTC(p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 0 : p.month, 15))
  return quotaPeriodStart(nextMonth, timeZone, 'calendar_month')
}

export function countQuotaUsage(listings: QuotaListing[], at: Date, timeZone: string, rules: Rules): number {
  const start = quotaPeriodStart(at, timeZone, rules.quotaPeriod)
  return listings.filter(
    (l) =>
      l.submittedAt !== null &&
      l.submittedAt >= start &&
      l.submittedAt <= at &&
      (rules.countRejected || l.status !== 'rejected'),
  ).length
}

export interface QuotaStatus {
  used: number
  limit: number
  remaining: number
  blocked: boolean
  label: string
}

export function quotaStatus(used: number, limit: number): QuotaStatus {
  const remaining = Math.max(0, limit - used)
  return {
    used,
    limit,
    remaining,
    blocked: used >= limit,
    label: `${Math.min(used, limit)} of ${limit} listings used this month`,
  }
}
