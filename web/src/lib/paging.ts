/** Rows per page, site-wide: short enough that the next page's links are
 * always in view without endless scrolling (tables), and a multiple of the
 * 2/3/4-column card grids. */
export const TABLE_PAGE_SIZE = 10
export const GRID_PAGE_SIZE = 12

export const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size))

/** One page of rows already in memory (1-based page). */
export function slicePage<T>(rows: T[], page: number, size: number): T[] {
  return rows.slice((page - 1) * size, page * size)
}

/** A ?page past the last one: the page should 404 rather than render an
 * empty, indexable duplicate. Page 1 always exists (it shows the empty state). */
export const pastLastPage = (page: number, total: number, size: number) => page > 1 && page > pageCount(total, size)

/** Page numbers to show: first, last, and two either side of the current
 * one, with null for a gap ("1 … 4 5 6 7 8 … 25"). */
export function pageWindow(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages))
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | null)[] = []
  for (const n of sorted) {
    const prev = out.at(-1)
    if (typeof prev === 'number' && n - prev === 2) out.push(n - 1)
    else if (typeof prev === 'number' && n - prev > 2) out.push(null)
    out.push(n)
  }
  return out
}

/** Card numbers in printed order: '2' < '10' < 'TG01', 'OP05-119' by set then number. */
export function byCardNumber(a: { number: string }, b: { number: string }): number {
  return a.number.localeCompare(b.number, 'en', { numeric: true, sensitivity: 'base' })
}
