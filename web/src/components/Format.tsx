const aud0 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
const int = new Intl.NumberFormat('en-AU')

export const fmtAud = (v: number | null | undefined) => (v === null || v === undefined ? '—' : aud0.format(v))
export const fmtInt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : int.format(v))
export const gradeLabel = (key: string) => (key === 'raw' ? 'Raw' : key === 'all' ? 'All grades' : key.toUpperCase().replace('-', ' '))
export const basisLabel = (b: string | null) =>
  b === 'marketplace_ask' ? 'ask (ours)' : b === 'external_ask' ? 'ask' : b === 'last_sale' ? 'last sale' : '—'

/** Price-change chip: sign and arrow, never colour alone (accessibility). */
export function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="chip">—</span>
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'
  return (
    <span className={`chip chip-${dir}`}>
      <span aria-hidden="true">{arrow}</span> {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  )
}

export function LangBadge({ lang }: { lang: string }) {
  return (
    <abbr className="badge" title={lang === 'jp' ? 'Japanese' : 'English'}>
      {lang.toUpperCase()}
    </abbr>
  )
}
