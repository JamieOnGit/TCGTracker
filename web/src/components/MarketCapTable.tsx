import Link from 'next/link'
import { getRepo, type MarketQuery, type MarketSort } from '@/lib/data'
import { resolveBuyButton } from '@/lib/domain/buyButton'
import type { SearchParams } from '@/lib/seo/metadata'
import { cardPath, GAMES, GAME_NAMES, LANGS, marketCapPath, type Game, type Lang } from '@/lib/seo/urls'
import { basisLabel, Change, fmtAud, fmtInt, gradeLabel, LangBadge } from './Format'
import { DataNotice } from './DataNotice'
import { Pagination } from './Pagination'

const SORTS: { key: MarketSort; label: string }[] = [
  { key: 'market_cap', label: 'Market cap' },
  { key: 'population', label: 'PSA pop' },
  { key: 'floor', label: 'Floor' },
  { key: 'change_7d', label: '7d' },
  { key: 'change_30d', label: '30d' },
]
const GRADE_OPTIONS = ['psa-10', 'psa-9', 'all']
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export function parseMarketQuery(sp: SearchParams, scope: { game?: Game; lang?: Lang; setId?: string }, primaryGrade: string): MarketQuery {
  const sort = (SORTS.find((s) => s.key === one(sp.sort))?.key ?? 'market_cap') as MarketSort
  const grade = one(sp.grade)
  const page = Math.max(1, Number(one(sp.page)) || 1)
  return {
    ...scope,
    gradeKey: grade && GRADE_OPTIONS.includes(grade) ? grade : primaryGrade,
    sort,
    order: one(sp.order) === 'asc' ? 'asc' : 'desc',
    page,
    pageSize: 50,
    q: one(sp.q)?.slice(0, 80),
  }
}

/**
 * The market cap table. Server-rendered so the top rows are in the initial
 * HTML for search engines and AI crawlers (brief 3.2). Unstyled skeleton:
 * visual design follows the approved wireframes.
 */
export async function MarketCapTable({ query, basePath, caption }: { query: MarketQuery; basePath: string; caption: string }) {
  const repo = getRepo()
  const [result, rules] = await Promise.all([repo.marketCap(query), repo.getRules()])
  const stats = await repo.listingStats(result.rows.map((r) => r.card.id))
  const gradeForBuy = query.gradeKey === 'all' ? null : query.gradeKey
  const sortHref = (key: MarketSort) => {
    const p = new URLSearchParams({ sort: key, ...(query.gradeKey !== rules.primaryGrade ? { grade: query.gradeKey } : {}) })
    if (key === query.sort && query.order === 'desc') p.set('order', 'asc')
    return `${basePath}?${p.toString()}`
  }

  return (
    <section aria-labelledby="market-table-caption">
      <div className="toggles">
        <nav aria-label="Game">
          <Link href={marketCapPath(undefined, undefined)} aria-current={!query.game ? 'page' : undefined}>All</Link>
          {GAMES.map((g) => (
            <Link key={g} href={marketCapPath(g)} aria-current={query.game === g ? 'page' : undefined}>{GAME_NAMES[g]}</Link>
          ))}
        </nav>
        {query.game && (
          <nav aria-label="Language">
            <Link href={marketCapPath(query.game)} aria-current={!query.lang ? 'page' : undefined}>All</Link>
            {LANGS.map((l) => (
              <Link key={l} href={marketCapPath(query.game, l)} aria-current={query.lang === l ? 'page' : undefined}>{l.toUpperCase()}</Link>
            ))}
          </nav>
        )}
        <nav aria-label="Grade">
          {GRADE_OPTIONS.map((g) => (
            <Link key={g} href={g === rules.primaryGrade ? basePath : `${basePath}?grade=${g}`} aria-current={query.gradeKey === g ? 'page' : undefined}>
              {gradeLabel(g)}
            </Link>
          ))}
        </nav>
        <form action={basePath} role="search">
          <label htmlFor="market-q">Search cards</label>
          <input id="market-q" name="q" type="search" defaultValue={query.q} />
          <button type="submit">Search</button>
        </form>
      </div>

      <div className="table-scroll">
        <table>
          <caption id="market-table-caption">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Card</th>
              <th scope="col">Set</th>
              <th scope="col">No.</th>
              <th scope="col">Lang</th>
              <th scope="col">Grade</th>
              <th scope="col"><Link href={sortHref('population')}>PSA pop</Link></th>
              <th scope="col"><Link href={sortHref('floor')}>Floor (AUD)</Link></th>
              <th scope="col"><Link href={sortHref('market_cap')}>Market cap</Link></th>
              <th scope="col"><Link href={sortHref('change_7d')}>7d</Link></th>
              <th scope="col"><Link href={sortHref('change_30d')}>30d</Link></th>
              <th scope="col">Listings</th>
              <th scope="col"><span className="sr-only">Buy</span></th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => {
              const buy = resolveBuyButton({ card: r.card, gradeKey: gradeForBuy ?? r.gradeKey, stats, externalFallback: rules.externalBuyFallback })
              const count = stats.filter((s) => s.cardId === r.card.id && s.gradeKey === r.gradeKey).reduce((n, s) => n + s.activeCount, 0)
              return (
                <tr key={`${r.card.id}-${r.gradeKey}`} data-card-id={r.card.id} data-grade={r.gradeKey}>
                  <td>{r.rank}</td>
                  <th scope="row"><Link href={cardPath(r.card)}>{r.card.name}</Link></th>
                  <td>{r.card.setName}</td>
                  <td>{r.card.printedTotal ? `${r.card.number}/${r.card.printedTotal}` : r.card.number}</td>
                  <td><LangBadge lang={r.card.lang} /></td>
                  <td>{gradeLabel(r.gradeKey)}</td>
                  <td>{fmtInt(r.population)}</td>
                  <td>{fmtAud(r.floorAud)} <small>{basisLabel(r.basis)}</small></td>
                  <td>{fmtAud(r.marketCapAud)}</td>
                  <td><Change value={r.change7d} /></td>
                  <td><Change value={r.change30d} /></td>
                  <td>{count}</td>
                  <td>
                    {buy.kind === 'listings' ? (
                      <Link className="btn" href={buy.href} data-buy="listings">{buy.label}</Link>
                    ) : (
                      <span data-buy="none">
                        {buy.label} · <Link href={buy.setAlertHref} rel="nofollow">Set alert</Link> ·{' '}
                        <Link href={buy.sellHref} rel="nofollow">Sell yours</Link>
                        {buy.external && (
                          <> · <a href={buy.external.href} rel="sponsored nofollow">{buy.external.label}</a></>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {result.rows.length === 0 && <p>No ranked cards yet for this view.</p>}
      <Pagination basePath={basePath} page={result.page} total={result.total} pageSize={result.pageSize} />
      <DataNotice asOf={result.asOf} sources="PSA population (pending licence) · pricing source (pending approval) · our marketplace" demo={repo.isDemo} />
    </section>
  )
}
