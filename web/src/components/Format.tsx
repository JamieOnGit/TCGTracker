import { gradeLabel } from '@/lib/domain/grades'
const aud0 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
const aud2 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-AU')

/** A$ everywhere: the "A" makes the currency unambiguous for Australians and search engines alike. */
export const fmtAud = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `A${aud0.format(v)}`)
export const fmtAud2 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `A${aud2.format(v)}`)
export const fmtInt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : int.format(v))
/** Abbreviated: A$10.9B, A$96.5K. Never truncated. */
export function fmtAudShort(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const abs = Math.abs(v)
  const [div, suf] = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e4 ? [1e3, 'K'] : [1, '']
  if (div === 1) return fmtAud(v)
  return `A$${(v / div).toFixed(v / div >= 100 ? 0 : 1)}${suf}`
}

export { gradeLabel }
export const basisLabel = (b: string | null) =>
  b === 'marketplace_ask' ? 'TCGTracker ask' : b === 'external_ask' ? 'Market ask' : b === 'last_sale' ? 'Last sale' : '—'
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Melbourne' }) : '—'

/** Price change: glyph + sign + colour (never colour alone). */
export function Change({ value, chip = false, period }: { value: number | null; chip?: boolean; period?: string }) {
  if (value === null || Number.isNaN(value)) return <span className="chg" data-dir="flat">—</span>
  const dir = value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat'
  const glyph = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—'
  const abs = Math.abs(value)
  const text = `${abs >= 100 ? abs.toFixed(0) : abs.toFixed(1)}%`
  const label = `${dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'unchanged'} ${text}${period ? ` over ${period}` : ''}`
  return (
    <span className={`chg${chip ? ' chg-chip' : ''}`} data-dir={dir} aria-label={label}>
      <span className="g" aria-hidden="true">{glyph}</span>
      {text}
      {period && <span className="muted" style={{ marginLeft: 4 }}>{period}</span>}
    </span>
  )
}

export function LangBadge({ lang }: { lang: string }) {
  return <abbr className="badge badge-lang" title={lang === 'jp' ? 'Japanese printing' : 'English printing'} style={{ textDecoration: 'none' }}>{lang.toUpperCase()}</abbr>
}

export function GradeBadge({ gradeKey }: { gradeKey: string }) {
  if (gradeKey === 'raw') return <span className="badge badge-raw">Raw</span>
  return <span className="badge badge-grade">{gradeLabel(gradeKey)}</span>
}

export function PremiumBadge() {
  return <span className="badge badge-premium">◆ Premium</span>
}
