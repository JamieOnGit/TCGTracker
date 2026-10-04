import Link from 'next/link'
import type { ReactNode } from 'react'
import type { ReleaseRow } from '@/lib/data/types'
import { TABLE_PAGE_SIZE } from '@/lib/paging'
import { CONFIDENCE_LABEL, formatReleaseDateShort, KIND_LABEL } from '@/lib/releases'
import { GAME_NAMES, releasePath } from '@/lib/seo/urls'

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

/** A long table: the first rows, then the rest behind "Show N more" (still in
 * the HTML, so every row stays crawlable without a ?page= duplicate). */
export function Collapsed<T>({ rows, render, noun }: { rows: T[]; render: (rows: T[]) => ReactNode; noun: string }) {
  if (rows.length <= TABLE_PAGE_SIZE) return <>{render(rows)}</>
  return (
    <>
      {render(rows.slice(0, TABLE_PAGE_SIZE))}
      <details className="more mt-2">
        <summary className="btn btn-secondary btn-sm">Show {rows.length - TABLE_PAGE_SIZE} more {noun}</summary>
        {render(rows.slice(TABLE_PAGE_SIZE))}
      </details>
    </>
  )
}
