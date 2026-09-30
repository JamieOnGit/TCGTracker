/**
 * Minimal iCalendar (RFC 5545) writer for the release calendar feeds: all-day
 * VEVENTs only, CRLF line endings, TEXT escaping and 75-octet line folding.
 */

export interface IcsEvent {
  uid: string // globally unique and stable, e.g. "<id>@tcgtrade.com.au"
  date: string // YYYY-MM-DD, all-day
  summary: string
  description?: string
  url?: string
  updatedAt?: string // ISO timestamp; used for DTSTAMP/LAST-MODIFIED so the feed is stable
}

export interface IcsCalendar {
  name: string
  description?: string
  events: IcsEvent[]
}

/** Escapes a TEXT value: backslash, semicolon, comma and newlines. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
}

/** Folds a content line to at most 75 octets per line without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const limit = out.length === 0 ? 75 : 74 // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += n
  }
  out.push(current)
  return out.join('\r\n ')
}

const compactDate = (d: string) => d.replace(/-/g, '')

function stamp(iso: string | undefined, now: Date): string {
  const d = iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso) : now
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function buildIcs(cal: IcsCalendar, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TCG Trade//Release calendar//EN-AU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(cal.name)}`,
    ...(cal.description ? [`X-WR-CALDESC:${escapeText(cal.description)}`] : []),
    'X-WR-TIMEZONE:Australia/Melbourne',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ]
  for (const e of cal.events) {
    const ts = stamp(e.updatedAt, now)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${ts}`,
      `LAST-MODIFIED:${ts}`,
      `DTSTART;VALUE=DATE:${compactDate(e.date)}`,
      `DTEND;VALUE=DATE:${compactDate(nextDay(e.date))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
