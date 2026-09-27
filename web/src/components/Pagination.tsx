import Link from 'next/link'

/** Crawlable ?page=N links (brief 3.2, 7.2). */
export function Pagination({ basePath, page, total, pageSize }: { basePath: string; page: number; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages === 1) return null
  const href = (n: number) => (n === 1 ? basePath : `${basePath}?page=${n}`)
  return (
    <nav aria-label="Pagination" className="pagination">
      {page > 1 && <Link href={href(page - 1)} rel="prev">Previous</Link>}
      <span>
        Page {page} of {pages}
      </span>
      {page < pages && <Link href={href(page + 1)} rel="next">Next</Link>}
    </nav>
  )
}
