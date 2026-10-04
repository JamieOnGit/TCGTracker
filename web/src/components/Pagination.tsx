import Link from 'next/link'
import { pageCount, pageWindow } from '@/lib/paging'

/** Crawlable ?page=N links (brief 3.2, 7.2): plain <a href> links search
 * engines follow, each page self-canonical. `anchor` brings the reader back
 * to the top of the table rather than the top of the page. */
export function Pagination({
  basePath,
  page,
  total,
  pageSize,
  params,
  anchor,
  noun = 'results',
}: {
  basePath: string
  page: number
  total: number
  pageSize: number
  params?: Record<string, string | undefined>
  anchor?: string
  noun?: string
}) {
  const pages = pageCount(total, pageSize)
  if (pages === 1) return null
  const href = (n: number) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(params ?? {})) if (v) p.set(k, v)
    if (n > 1) p.set('page', String(n))
    const q = p.toString()
    return `${basePath}${q ? `?${q}` : ''}${anchor ? `#${anchor}` : ''}`
  }
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return (
    <nav aria-label="Pagination" className="pager" data-pager>
      <span className="pager-count">
        Showing {first.toLocaleString('en-AU')}–{last.toLocaleString('en-AU')} of {total.toLocaleString('en-AU')} {noun}
      </span>
      <span className="pager-links">
        {page > 1 ? (
          <Link href={href(page - 1)} rel="prev" className="pager-step" aria-label="Previous page">
            ‹ Prev
          </Link>
        ) : (
          <span className="pager-step" aria-hidden="true">‹ Prev</span>
        )}
        {pageWindow(page, pages).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">…</span>
          ) : n === page ? (
            <span key={n} className="pager-num" aria-current="page">{n}</span>
          ) : (
            <Link key={n} href={href(n)} className="pager-num" aria-label={`Page ${n}`}>
              {n}
            </Link>
          ),
        )}
        {page < pages ? (
          <Link href={href(page + 1)} rel="next" className="pager-step" aria-label="Next page">
            Next ›
          </Link>
        ) : (
          <span className="pager-step" aria-hidden="true">Next ›</span>
        )}
      </span>
    </nav>
  )
}
