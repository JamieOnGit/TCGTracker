import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { Change, fmtAud, fmtAudShort } from '@/components/Format'
import { JsonLd } from '@/components/JsonLd'
import { MarketCapTable, parseMarketQuery } from '@/components/MarketCapTable'
import { Eyebrow, Stat, StatStrip } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { formatAud } from '@/lib/domain/rules'
import { dataset } from '@/lib/seo/jsonld'
import { buildMetadata, titles, type SearchParams } from '@/lib/seo/metadata'
import { cardPath, marketCapPath, setPath } from '@/lib/seo/urls'

export const revalidate = 300

type Props = { searchParams: Promise<SearchParams> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildMetadata({
    path: '/',
    title: titles.home(),
    description: 'Graded Pokémon and One Piece card prices in Australian dollars: PSA 10 values, market cap and 7/30-day moves for JP and EN cards, plus drop alerts.',
    searchParams: await searchParams,
  })
}

export default async function Home({ searchParams }: Props) {
  const repo = getRepo()
  const rules = await repo.getRules()
  const query = parseMarketQuery(await searchParams, {}, rules.primaryGrade)
  const [all, drops, sets] = await Promise.all([
    repo.marketCap({ ...query, sort: 'market_cap', order: 'desc', page: 1, pageSize: 1000, q: undefined }),
    repo.drops({ limit: 5 }),
    repo.listSets(),
  ])
  const rows = all.rows
  const totalValue = rows.reduce((s, r) => s + (r.marketCapAud ?? 0), 0)
  const rising = rows.filter((r) => (r.change7d ?? 0) > 0).length
  const withChange = rows.filter((r) => r.change7d !== null)
  const avg7d = withChange.length ? withChange.reduce((s, r) => s + r.change7d!, 0) / withChange.length : null
  const up = [...withChange].sort((a, b) => b.change7d! - a.change7d!).slice(0, 5)
  const down = [...withChange].sort((a, b) => a.change7d! - b.change7d!).slice(0, 5)
  const setValue = new Map<string, number>()
  for (const r of rows) setValue.set(r.card.setId, (setValue.get(r.card.setId) ?? 0) + (r.marketCapAud ?? r.floorAud))
  const leaders = sets.filter((s) => setValue.has(s.id)).sort((a, b) => setValue.get(b.id)! - setValue.get(a.id)!).slice(0, 6)

  return (
    <>
      <div className="container-x">
        <div className="pt-6"><Breadcrumbs items={[]} /></div>
        <section className="pb-10 pt-8 md:pt-14">
          <Eyebrow>Australian graded card market · AUD</Eyebrow>
          <h1 className="mt-3" style={{ fontSize: 'var(--text-3xl)' }}>The graded card market, measured.</h1>
          <p className="lead mt-4">
            {avg7d === null ? 'Pokémon and One Piece, English and Japanese, priced in Australian dollars.' : (
              <>
                {avg7d >= 0 ? 'Up' : 'Down'} {Math.abs(avg7d).toFixed(1)}% on average this week; {Math.round((rising / Math.max(1, withChange.length)) * 100)}% of tracked cards are rising.
              </>
            )}
          </p>
        </section>

        <StatStrip>
          <Stat label="Tracked market cap" value={totalValue ? fmtAudShort(totalValue) : '—'} sub={totalValue ? fmtAud(totalValue) : 'Population data pending licence'} />
          <Stat label="Average 7d move" value={avg7d === null ? '—' : <span style={{ color: avg7d >= 0 ? 'var(--up)' : 'var(--down)' }}>{avg7d >= 0 ? '+' : '−'}{Math.abs(avg7d).toFixed(1)}%</span>} sub={`${rising} of ${withChange.length} cards rising`} />
          <Stat label="Cards tracked" value={all.total.toLocaleString('en-AU')} sub="PSA 10 · Pokémon & One Piece · EN & JP" />
          <Stat label="Premium" value={formatAud(rules.premiumMonthlyCents).replace('$', 'A$')} sub={<>per month incl. GST · <Link href="/premium/" className="prose-link">instant drop alerts</Link></>} />
        </StatStrip>

        <section className="pt-14">
          <MarketCapTable query={query} basePath="/" caption="Graded cards ranked by market cap, in AUD" />
        </section>
      </div>

      <div className="container-x section">
        <div className="grid gap-12 lg:grid-cols-2">
          <section aria-labelledby="movers-h">
            <h2 id="movers-h">Movers this week</h2>
            <div className="mt-6 grid grid-cols-2 gap-8">
              {[['Rising', up], ['Falling', down] as const].map(([label, list]) => (
                <div key={label as string}>
                  <p className="eyebrow">{label as string}</p>
                  <ol className="mt-3 grid gap-3">
                    {(list as typeof up).map((r) => (
                      <li key={r.card.id + r.gradeKey} className="flex items-baseline justify-between gap-3 text-sm">
                        <Link href={cardPath(r.card)} className="prose-link truncate" style={{ textDecorationColor: 'transparent' }}>
                          {r.card.name} <span className="muted">{r.card.lang.toUpperCase()}</span>
                        </Link>
                        <Change value={r.change7d} />
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
          <section aria-labelledby="drops-h">
            <div className="flex items-baseline justify-between">
              <h2 id="drops-h">Latest retail drops</h2>
              <Link href="/drops/" className="btn-ghost text-sm">All drops</Link>
            </div>
            <p className="muted mt-2 text-sm">JB Hi-Fi, BIG W, Kmart, Target and more. Premium members are alerted instantly; everyone else 5 minutes later.</p>
            <div className="mt-4"><DropFeed rows={drops} compact /></div>
          </section>
        </div>
      </div>

      <div className="container-x">
        <section aria-labelledby="sets-h">
          <div className="flex items-baseline justify-between">
            <h2 id="sets-h">Most valuable sets</h2>
            <Link href="/cards/" className="btn-ghost text-sm">Browse all sets</Link>
          </div>
          <div className="table-wrap mt-6">
            <table className="dt">
              <thead><tr><th scope="col">Set</th><th scope="col">Language</th><th scope="col" className="n">Tracked value</th><th scope="col" className="n hide-sm">Rankings</th></tr></thead>
              <tbody>
                {leaders.map((s) => (
                  <tr key={s.id}>
                    <th scope="row"><Link href={setPath(s)} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{s.name}</Link> <span className="muted text-xs">{s.game === 'pokemon' ? 'Pokémon' : 'One Piece'}</span></th>
                    <td>{s.lang.toUpperCase()}</td>
                    <td className="n">{fmtAudShort(setValue.get(s.id))}</td>
                    <td className="n hide-sm"><Link href={marketCapPath(s.game, s.lang, s.slug)} className="prose-link">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section grid gap-8 md:grid-cols-[1fr_auto] md:items-end" aria-labelledby="premium-h" style={{ borderTop: '1px solid var(--line)', marginTop: 96 }}>
          <div>
            <p className="eyebrow">Premium · {formatAud(rules.premiumMonthlyCents).replace('$', 'A$')} a month</p>
            <h2 id="premium-h" className="mt-3" style={{ fontSize: 'var(--text-2xl)' }}>Know the moment stock lands.</h2>
            <ul className="muted mt-4 grid gap-2 text-sm">
              <li>Instant restock and pre-order alerts from Australian retailers, by email and on-site</li>
              <li>List up to {rules.premiumQuota} cards a month on the marketplace (Free: {rules.freeQuota})</li>
              <li>Premium badge on your profile and listings</li>
            </ul>
          </div>
          <Link href="/premium/" className="btn btn-secondary">See Premium</Link>
        </section>
      </div>

      <JsonLd data={dataset({ name: 'Graded card market cap rankings (AUD)', description: 'Daily rankings of graded Pokémon and One Piece cards: value, market cap and changes, in Australian dollars.', path: '/', dateModified: all.asOf ?? new Date().toISOString().slice(0, 10), downloadUrl: '/data/' })} />
    </>
  )
}
