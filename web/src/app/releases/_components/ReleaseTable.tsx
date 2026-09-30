import Link from 'next/link'
import type { ReleaseRow, SetRow } from '@/lib/data/types'
import { CONFIDENCE_LABEL, formatReleaseDateShort, KIND_LABEL } from '@/lib/releases'
import { GAME_NAMES, releasePath, setPath } from '@/lib/seo/urls'

const CONFIDENCE_BADGE: Record<ReleaseRow['confidence'], string> = { official: 'badge badge-live', retailer: 'badge badge-lang', unconfirmed: 'badge badge-warn' }

export function ConfidenceBadge({ confidence }: { confidence: ReleaseRow['confidence'] }) {
  return <span className={CONFIDENCE_BADGE[confidence]}>{CONFIDENCE_LABEL[confidence]}</span>
}

/** One table per group on the calendar pages. Every row links to its detail page. */
export function ReleaseTable({ rows, caption, showGame }: { rows: ReleaseRow[]; caption: string; showGame?: boolean }) {
  return (
    <div className="table-wrap mt-4">
      <table className="dt">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Release</th>
            {showGame && <th scope="col">Game</th>}
            <th scope="col">Lang</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="num whitespace-nowrap">{r.releaseDate && r.datePrecision === 'day' ? <time dateTime={r.releaseDate}>{formatReleaseDateShort(r)}</time> : formatReleaseDateShort(r)}</td>
              <th scope="row">
                <Link href={releasePath(r.game, r.slug)} className="prose-link">{r.title}</Link>
                {r.kind !== 'set_release' && <span className="muted"> · {KIND_LABEL[r.kind]}</span>}
              </th>
              {showGame && <td>{GAME_NAMES[r.game]}</td>}
              <td><span className="badge badge-lang">{r.lang.toUpperCase()}</span></td>
              <td><ConfidenceBadge confidence={r.confidence} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Fallback while the release calendar is empty: set release dates from the catalogue. */
export function SetDateTable({ sets, caption, showGame }: { sets: SetRow[]; caption: string; showGame?: boolean }) {
  return (
    <div className="table-wrap mt-4">
      <table className="dt">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Set</th>
            {showGame && <th scope="col">Game</th>}
            <th scope="col">Lang</th>
          </tr>
        </thead>
        <tbody>
          {sets.map((s) => (
            <tr key={s.id}>
              <td className="num whitespace-nowrap">{s.releaseDate ? <time dateTime={s.releaseDate.slice(0, 10)}>{formatReleaseDateShort({ releaseDate: s.releaseDate.slice(0, 10), datePrecision: 'day' })}</time> : 'TBC'}</td>
              <th scope="row"><Link href={setPath(s)} className="prose-link">{s.name}</Link></th>
              {showGame && <td>{GAME_NAMES[s.game]}</td>}
              <td><span className="badge badge-lang">{s.lang.toUpperCase()}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
