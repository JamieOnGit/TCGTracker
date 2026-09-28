import Link from 'next/link'

/** Crawlable ?page=N links (brief 3.2, 7.2). */
export function Pagination({ basePath, page, total, pageSize, params }: { basePath: string; page: number; total: number; pageSize: number; params?: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages === 1) return null
  const href = (n: number) => {
    const p = new URLSearchParams(params)
    if (n > 1) p.set('page', String(n))
    const q = p.toString()
    return q ? `${basePath}?${q}` : basePath
  }
  return (
    <nav aria-label="Pagination" className="pager">
      <span>{page > 1 ? <Link href={href(page - 1)} rel="prev">← Previous</Link> : null}</span>
      <span className="num">Page {page} of {pages}</span>
      <span>{page < pages ? <Link href={href(page + 1)} rel="next">Next →</Link> : null}</span>
    </nav>
  )
}
