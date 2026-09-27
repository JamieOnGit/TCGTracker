import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketCapTable, parseMarketQuery } from '@/components/MarketCapTable'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
import { fmtAud } from '@/components/Format'
import { getRepo } from '@/lib/data'
import { dataset } from '@/lib/seo/jsonld'
import { buildMetadata, titles, type SearchParams } from '@/lib/seo/metadata'
import { cardPath, dropsPath } from '@/lib/seo/urls'

export const revalidate = 300

type Props = { searchParams: Promise<SearchParams> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildMetadata({
    path: '/',
    title: titles.home(),
    description: 'Live market cap rankings for graded Pokémon and One Piece cards in Australia: PSA population × floor price, JP and EN, in AUD.',
    searchParams: await searchParams,
  })
}

export default async function Home({ searchParams }: Props) {
  const repo = getRepo()
  const rules = await repo.getRules()
  const query = parseMarketQuery(await searchParams, {}, rules.primaryGrade)
  const [top, drops] = await Promise.all([
    repo.marketCap({ ...query, sort: 'market_cap', order: 'desc', page: 1, pageSize: 500 }),
    repo.drops({ limit: 1 }),
  ])
  const total = top.rows.reduce((s, r) => s + r.marketCapAud, 0)
  const movers = [...top.rows].filter((r) => r.change7d !== null).sort((a, b) => Math.abs(b.change7d!) - Math.abs(a.change7d!)).slice(0, 3)

  return (
    <>
      {repo.isDemo && <p className="demo-banner">Demo data: the database isn&apos;t connected, so every number on this site is synthetic.</p>}
      <Breadcrumbs items={[]} />
      <h1>Graded card market cap rankings</h1>
      <section aria-label="Summary">
        <dl>
          <dt>Total tracked market cap ({query.gradeKey.toUpperCase()})</dt>
          <dd>{fmtAud(total)}</dd>
          <dt>Biggest 7d movers</dt>
          <dd>
            {movers.map((m) => (
              <span key={m.card.id}><Link href={cardPath(m.card)}>{m.card.name} ({m.card.lang.toUpperCase()})</Link> {m.change7d}% · </span>
            ))}
          </dd>
          <dt>Newest listings</dt>
          <dd><Link href="/marketplace/?sort=newest">See the newest listings</Link></dd>
          <dt>Latest retail drop</dt>
          <dd>{drops[0] ? <Link href={dropsPath()}>{drops[0].title} at {drops[0].retailerName}</Link> : '—'}</dd>
        </dl>
      </section>
      <MarketCapTable query={query} basePath="/" caption="Cards ranked by market cap (population × floor price, AUD)" />
      <JsonLd data={dataset({ name: 'Graded card market cap rankings (AUD)', description: 'Daily market cap = graded population × floor price for Pokémon and One Piece cards, JP and EN.', path: '/', dateModified: top.asOf ?? new Date().toISOString().slice(0, 10), downloadUrl: '/data/' })} />
    </>
  )
}
