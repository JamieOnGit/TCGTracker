/**
 * Release calendar helpers (client-safe, no data access): date wording by
 * precision, labels, "today" in Australian time and the hub grouping.
 * Dates are plain YYYY-MM-DD calendar dates, so they are formatted in UTC to
 * avoid any time-zone shift.
 */
import type { ReleaseKind, ReleaseRow } from '@/lib/data/types'
import { GAME_NAMES, LANG_NAMES } from '@/lib/seo/urls'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type Dated = Pick<ReleaseRow, 'releaseDate' | 'datePrecision'>

/** Today's calendar date in Melbourne/Sydney time (AEST/AEDT), as YYYY-MM-DD. */
export function todayAu(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return { y, m, d }
}

/** "6 November 2026", "November 2026", "Q4 2026" or "TBC". */
export function formatReleaseDate(r: Dated): string {
  if (!r.releaseDate || r.datePrecision === 'tbc') return 'TBC'
  const { y, m, d } = parts(r.releaseDate)
  if (r.datePrecision === 'day') return `${d} ${MONTHS[m - 1]} ${y}`
  if (r.datePrecision === 'month') return `${MONTHS[m - 1]} ${y}`
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`
}

/** Short form for tables: "6 Nov 2026", "Nov 2026", "Q4 2026", "TBC". */
export function formatReleaseDateShort(r: Dated): string {
  const long = formatReleaseDate(r)
  return long.replace(/(January|February|March|April|May|June|July|August|September|October|November|December)/, (mo) => mo.slice(0, 3))
}

/** Last calendar day the release could fall on (null for TBC). */
export function periodEnd(r: Dated): string | null {
  if (!r.releaseDate || r.datePrecision === 'tbc') return null
  if (r.datePrecision === 'day') return r.releaseDate
  const { y, m } = parts(r.releaseDate)
  const lastMonth = r.datePrecision === 'month' ? m : Math.floor((m - 1) / 3) * 3 + 3
  return new Date(Date.UTC(y, lastMonth, 0)).toISOString().slice(0, 10)
}

export const CONFIDENCE_LABEL: Record<ReleaseRow['confidence'], string> = {
  official: 'Official',
  retailer: 'Retailer listing',
  unconfirmed: 'Unconfirmed',
}

export const CONFIDENCE_HELP: Record<ReleaseRow['confidence'], string> = {
  official: 'Announced by the publisher or its Australian distributor.',
  retailer: 'Taken from an Australian retailer listing. Retailer dates can move.',
  unconfirmed: 'Reported but not yet confirmed by the publisher or a retailer.',
}

export const KIND_LABEL: Record<ReleaseKind, string> = {
  set_release: 'Set release',
  product_release: 'Product release',
  prerelease: 'Prerelease events',
  preorder_open: 'Pre-orders open',
  retailer_date: 'Retailer date',
}

/** Page title: "Mega Evolution Release Date in Australia (EN)". */
export function releasePageTitle(r: Pick<ReleaseRow, 'title' | 'lang' | 'kind'>): string {
  const what = r.kind === 'preorder_open' ? 'Pre-order Date' : r.kind === 'prerelease' ? 'Prerelease Date' : 'Release Date'
  return `${r.title} ${what} in Australia (${r.lang.toUpperCase()})`
}

export function releaseDescription(r: ReleaseRow): string {
  const when = formatReleaseDate(r)
  const date = when === 'TBC' ? 'release date TBC' : `${r.datePrecision === 'day' ? 'releasing' : 'expected'} ${when}`
  const products = r.products.length ? ` Products: ${r.products.slice(0, 3).map((p) => p.name).join(', ')}.` : ''
  return `${r.title} (${GAME_NAMES[r.game]} TCG, ${LANG_NAMES[r.lang]}) in Australia: ${date} (${CONFIDENCE_LABEL[r.confidence].toLowerCase()}).${products} RRP in AUD and where to buy.`.slice(0, 300)
}

export interface ReleaseGroup {
  key: string
  label: string
  rows: ReleaseRow[]
}

/**
 * Hub layout: upcoming grouped by month (quarter-precision entries get their
 * own "Q4 2026" group after that quarter's months), then releases whose date
 * passed in the last `recentDays`, then TBC.
 */
export function groupReleases(rows: ReleaseRow[], today: string, recentDays = 60): { upcoming: ReleaseGroup[]; recent: ReleaseRow[]; tbc: ReleaseRow[] } {
  const since = addDays(today, -recentDays)
  const groups = new Map<string, ReleaseGroup & { sort: string }>()
  const recent: ReleaseRow[] = []
  const tbc: ReleaseRow[] = []
  for (const r of rows) {
    const end = periodEnd(r)
    if (!end || !r.releaseDate) {
      tbc.push(r)
      continue
    }
    if (end < today) {
      if (end >= since) recent.push(r)
      continue
    }
    const { y, m } = parts(r.releaseDate)
    const quarter = r.datePrecision === 'quarter'
    const key = quarter ? `${y}-q${Math.floor((m - 1) / 3) + 1}` : `${y}-${String(m).padStart(2, '0')}`
    // Quarter groups sort after the last month of their quarter.
    const sort = quarter ? `${end.slice(0, 7)}-99` : `${key}-00`
    const label = quarter ? formatReleaseDate(r) : `${MONTHS[m - 1]} ${y}`
    const g = groups.get(key) ?? { key, label, rows: [], sort }
    g.rows.push(r)
    groups.set(key, g)
  }
  const upcoming = [...groups.values()].sort((a, b) => a.sort.localeCompare(b.sort)).map(({ key, label, rows }) => ({ key, label, rows }))
  recent.sort((a, b) => (periodEnd(b) ?? '').localeCompare(periodEnd(a) ?? ''))
  return { upcoming, recent, tbc }
}

/** True until the last day the release could fall on has passed (TBC counts as upcoming). */
export function isUpcoming(r: Dated, today: string): boolean {
  const end = periodEnd(r)
  return end === null || end >= today
}
