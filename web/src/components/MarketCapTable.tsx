import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getRepo, type MarketQuery, type MarketRow, type MarketSort } from '@/lib/data'
import { resolveBuyButton } from '@/lib/domain/buyButton'
import { EBAY_DISCLOSURE, ebaySearchUrl } from '@/lib/domain/ebay'
import type { Rules } from '@/lib/domain/rules'
import type { SearchParams } from '@/lib/seo/metadata'
import { cardPath, GAMES, GAME_NAMES, LANGS, marketCapPath, type Game, type Lang } from '@/lib/seo/urls'
import { Sparkline } from './Charts'
import { DataNotice } from './DataNotice'
import { Change, fmtAud, fmtAudShort, fmtInt, gradeLabel, LangBadge } from './Format'
import { Pagination } from './Pagination'
import { pastLastPage, TABLE_PAGE_SIZE } from '@/lib/paging'
import { SegLinks, Thumb } from './ui'

const SORTS: MarketSort[] = ['market_cap', 'population', 'floor', 'change_7d', 'change_30d']
/** Raw (the ungraded card's market price from recent sales) is the main view; PSA grades carry population and market cap. */
const GRADE_OPTIONS = ['raw', 'psa-10', 'psa-9', 'all']
const viewLabel = (g: string) => (g === 'raw' ? 'Market price' : gradeLabel(g))
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * The default view: the configured primary grade, unless that is raw and no
 * raw market prices exist yet (a new install, or before the first raw import),
 * when the rankings fall back to PSA 10 rather than showing an empty table.
 */
export const effectivePrimaryGrade = cache(async (configured: string): Promise<string> => {
  if (configured !== 'raw') return configured
  const probe = await getRepo().marketCap({ gradeKey: 'raw', sort: 'market_cap', order: 'desc', page: 1, pageSize: 1 })
  return probe.total > 0 ? 'raw' : 'psa-10'
})

export function parseMarketQuery(sp: SearchParams, scope: { game?: Game; lang?: Lang; setId?: string }, primaryGrade: string): MarketQuery {
  const sort = (SORTS.find((s) => s === one(sp.sort)) ?? 'market_cap') as MarketSort
  const grade = one(sp.grade)
  const lang = one(sp.lang)
  return {
    ...scope,
    lang: scope.lang ?? (lang === 'en' || lang === 'jp' ? lang : undefined),
    gradeKey: grade && GRADE_OPTIONS.includes(grade) ? grade : primaryGrade,
    sort,
    order: one(sp.order) === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, Math.min(5000, Number(one(sp.page)) || 1)),
    pageSize: TABLE_PAGE_SIZE,
    q: one(sp.q)?.trim().slice(0, 80) || undefined,
  }
}

function BuyCell({ row, rules, stats }: { row: MarketRow; rules: Rules; stats: Parameters<typeof resolveBuyButton>[0]['stats'] }) {
  const ebay = rules.externalBuyFallback
    ? ebaySearchUrl({ cardId: row.card.id, name: row.card.name, number: row.card.number, setName: row.card.setName, lang: row.card.lang, game: row.card.game, gradeKey: row.gradeKey }, rules.ebay)
    : null
  const buy = resolveBuyButton({ card: row.card, gradeKey: row.gradeKey, stats, externalFallback: Boolean(ebay), externalUrl: ebay })
  if (buy.kind === 'listings') {
    return (
      <Link className="btn btn-secondary btn-sm" href={buy.href} data-buy="listings" aria-label={`${buy.count} listed on TCGTracker from ${fmtAud(buy.fromAud)}`}>
        Buy · {buy.count} from {fmtAudShort(buy.fromAud)}
      </Link>
    )
  }
  return (
    <span data-buy="none" className="buy-links flex flex-wrap items-center justify-end gap-x-2 text-xs">
      {buy.external && (
        <a href={buy.external.href} rel="sponsored nofollow noopener" target="_blank" className="prose-link" data-buy="ebay">
          eBay ↗
        </a>
      )}
      {buy.external && rules.ebay.affiliateEnabled && <span className="subtle" title={EBAY_DISCLOSURE}>Ad</span>}
      <Link href={buy.setAlertHref} rel="nofollow" className="prose-link">Alert me</Link>
      <Link href={buy.sellHref} rel="nofollow" className="prose-link">Sell</Link>
    </span>
  )
}

/**
 * The rankings table (docs/research/06 §2.2, §4.7). Server-rendered so the
 * top rows are in the initial HTML for search engines and AI crawlers.
 */
export async function MarketCapTable({
  query,
  basePath,
  caption,
  showControls = true,
  paginate = true,
}: {
  query: MarketQuery
  basePath: string
  caption: string
  showControls?: boolean
  /** false: a top-N preview on a page whose ?page= belongs to another list. */
  paginate?: boolean
}) {
  const repo = getRepo()
  const [result, loaded] = await Promise.all([repo.marketCap(query), repo.getRules()])
  if (paginate && pastLastPage(query.page, result.total, query.pageSize)) notFound()
  const primaryGrade = await effectivePrimaryGrade(loaded.primaryGrade)
  const rules = { ...loaded, primaryGrade }
  const gradeOptions = GRADE_OPTIONS.filter((g) => g !== 'raw' || primaryGrade === 'raw' || query.gradeKey === 'raw')
  const stats = await repo.listingStats(result.rows.map((r) => r.card.id))
  const priceMode = result.rows.some((r) => r.population === null)
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams()
    if (query.gradeKey !== rules.primaryGrade) p.set('grade', query.gradeKey)
    if (query.q) p.set('q', query.q)
    for (const [k, v] of Object.entries(extra)) p.set(k, v)
    const s = p.toString()
    return s ? `${basePath}?${s}` : basePath
  }
  const sortHref = (key: MarketSort) => keep({ sort: key, ...(key === query.sort && query.order === 'desc' ? { order: 'asc' } : {}) })
  const sortAttr = (key: MarketSort) => (query.sort === key ? (query.order === 'asc' ? 'ascending' : 'descending') : undefined)
  const arrow = (key: MarketSort) => (query.sort === key ? (query.order === 'asc' ? ' ▴' : ' ▾') : '')
  const gradeCol = query.gradeKey === 'raw' ? 'Market price' : query.gradeKey === 'all' ? 'Value' : `${gradeLabel(query.gradeKey)} value`
  // PSA 10 sits beside the market price; population and market cap only mean something for PSA grades.
  const showPsa10 = query.gradeKey !== 'psa-10'
  const showPop = query.gradeKey.startsWith('psa-') || query.gradeKey === 'all'

  return (
    <section aria-labelledby="rankings-caption" id="rankings" className="scroll-mt-24">
      {showControls && (
        <div className="flex flex-wrap items-center gap-3 pb-4">
          <SegLinks
            label="Game"
            options={[
              { href: marketCapPath(), label: 'All', current: !query.game },
              ...GAMES.map((g) => ({ href: marketCapPath(g), label: GAME_NAMES[g], current: query.game === g })),
            ]}
          />
          <SegLinks
            label="Language"
            options={[
              { href: query.game ? marketCapPath(query.game) : '/', label: 'All', current: !query.lang },
              ...LANGS.map((l) => ({
                href: query.game ? marketCapPath(query.game, l) : `/?lang=${l}`,
                label: l.toUpperCase(),
                current: query.lang === l,
                rel: query.game ? undefined : 'nofollow',
              })),
            ]}
          />
          <SegLinks
            label="Grade"
            options={gradeOptions.map((g) => ({ href: g === rules.primaryGrade ? basePath : `${basePath}?grade=${g}`, label: viewLabel(g), current: query.gradeKey === g, rel: g === rules.primaryGrade ? undefined : 'nofollow' }))}
          />
          <form action={basePath} role="search" className="w-full sm:ml-auto sm:w-64">
            <label htmlFor="rank-q" className="sr-only">Search the rankings</label>
            <input id="rank-q" name="q" type="search" className="search-field" placeholder="Search card or set" defaultValue={query.q} />
          </form>
        </div>
      )}

      <div className="table-wrap">
        <table className="dt">
          <caption id="rankings-caption" className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="rank">#</th>
              <th scope="col" className="sticky-col">Card</th>
              <th scope="col" className="n" aria-sort={sortAttr('floor')}><Link href={sortHref('floor')} rel="nofollow">{gradeCol} (A$){arrow('floor')}</Link></th>
              <th scope="col" className="n hide-md">24h</th>
              <th scope="col" className="n" aria-sort={sortAttr('change_7d')}><Link href={sortHref('change_7d')} rel="nofollow">7d{arrow('change_7d')}</Link></th>
              <th scope="col" className="n hide-sm" aria-sort={sortAttr('change_30d')}><Link href={sortHref('change_30d')} rel="nofollow">30d{arrow('change_30d')}</Link></th>
              <th scope="col" className="hide-md"><span className="sr-only">7-day trend</span></th>
              {showPsa10 && <th scope="col" className="n hide-sm">PSA 10 (A$)</th>}
              {showPop && <th scope="col" className="n hide-sm" aria-sort={sortAttr('market_cap')}><Link href={sortHref('market_cap')} rel="nofollow">Market cap{arrow('market_cap')}</Link></th>}
              {showPop && <th scope="col" className="n hide-sm" aria-sort={sortAttr('population')}><Link href={sortHref('population')} rel="nofollow">PSA pop{arrow('population')}</Link></th>}
              <th scope="col" className="n"><span className="sr-only">Buy</span></th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={`${r.card.id}-${r.gradeKey}`} data-card-id={r.card.id} data-grade={r.gradeKey}>
                <td className="rank num">{r.rank}</td>
                <th scope="row" className="sticky-col">
                  <div className="card-cell">
                    <Thumb name={r.card.name} src={r.card.imageUrl} />
                    <div>
                      <Link href={cardPath(r.card)}>{r.card.name}</Link>
                      <div className="card-meta">
                        <span>{r.card.setName} · #{r.card.printedTotal ? `${r.card.number}/${r.card.printedTotal}` : r.card.number}</span>
                        <LangBadge lang={r.card.lang} />
                        {query.gradeKey === 'all' && <span className="tag-quiet">{gradeLabel(r.gradeKey)}</span>}
                      </div>
                    </div>
                  </div>
                </th>
                <td className="n" title={r.gradeKey === 'raw' ? 'Market price from recent sales (ungraded, Near Mint)' : r.basis === 'last_sale' ? 'Recent sales' : 'Lowest current ask'}>{fmtAud(r.floorAud).replace('A$', '')}</td>
                <td className="n hide-md"><Change value={r.change1d} /></td>
                <td className="n"><Change value={r.change7d} /></td>
                <td className="n hide-sm"><Change value={r.change30d} /></td>
                <td className="hide-md"><Sparkline points={r.spark7d} /></td>
                {showPsa10 && <td className="n hide-sm" data-col="psa10">{r.psa10Aud === null ? <span className="subtle">—</span> : fmtAud(r.psa10Aud).replace('A$', '')}</td>}
                {showPop && <td className="n hide-sm">{r.marketCapAud === null ? <span className="subtle" title="Awaiting licensed PSA population data">—</span> : fmtAudShort(r.marketCapAud)}</td>}
                {showPop && <td className="n hide-sm">{fmtInt(r.population)}</td>}
                <td className="n"><BuyCell row={r} rules={rules} stats={stats} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rows.length === 0 && <p className="muted py-10 text-center">No cards match this view yet.</p>}
      {paginate && <Pagination
        basePath={basePath}
        page={result.page}
        total={result.total}
        pageSize={result.pageSize}
        params={{
          grade: query.gradeKey !== rules.primaryGrade ? query.gradeKey : undefined,
          q: query.q,
          sort: query.sort !== 'market_cap' ? query.sort : undefined,
          order: query.order === 'asc' ? 'asc' : undefined,
        }}
        anchor="rankings"
        noun="cards"
      />}
      <DataNotice
        asOf={result.asOf}
        demo={repo.isDemo}
        scope={`${result.total.toLocaleString('en-AU')} cards · ${query.gradeKey === 'raw' ? 'ranked by market price (ungraded, Near Mint, from recent sales)' : `${gradeLabel(query.gradeKey)}${priceMode ? ' · ranked by value until licensed PSA population data is connected' : ''}`}`}
        sources="JustTCG market prices from recent sales (raw and graded, converted from USD), TCGTracker marketplace asks"
      />
    </section>
  )
}
