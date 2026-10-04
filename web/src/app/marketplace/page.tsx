import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pastLastPage } from '@/lib/paging'
import { AntiScam } from '@/components/AntiScam'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ListingTile } from '@/components/ListingTile'
import { Filters, marketplaceParams, parseMarketplaceQuery } from '@/components/MarketplaceFilters'
import { Pagination } from '@/components/Pagination'
import { EmptyState, PageIntro, SegLinks } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata, type SearchParams } from '@/lib/seo/metadata'
import { GAMES, GAME_NAMES, marketplacePath, sellPath } from '@/lib/seo/urls'

export const revalidate = 120
type Props = { searchParams: Promise<SearchParams> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildMetadata({
    path: '/marketplace/',
    title: 'Pokémon & One Piece Cards for Sale in Australia – Graded, Raw & Sealed',
    description: 'Buy graded slabs, raw singles and sealed Pokémon and One Piece product from Australian collectors, priced in AUD. Every listing is reviewed before it goes live.',
    searchParams: await searchParams,
  })
}

export default async function Marketplace({ searchParams }: Props) {
  const sp = await searchParams
  const query = parseMarketplaceQuery(sp)
  const result = await getRepo().marketplace(query)
  if (pastLastPage(result.page, result.total, result.pageSize)) notFound()
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Marketplace', path: '/marketplace/' }]} /></div>
      <PageIntro eyebrow="Marketplace · Australia" title="Marketplace" lead={`${result.total.toLocaleString('en-AU')} ${result.total === 1 ? 'card' : 'cards'} for sale from Australian collectors, in AUD. Message sellers on-site; every listing is reviewed before it goes live.`}>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <SegLinks label="Game" options={[{ href: '/marketplace/', label: 'All', current: !query.game }, ...GAMES.map((g) => ({ href: marketplacePath(g), label: GAME_NAMES[g], current: false }))]} />
          <Link href={sellPath()} className="btn btn-primary btn-sm" rel="nofollow">Sell a card</Link>
        </div>
      </PageIntro>
      <div className="grid scroll-mt-24 gap-10 lg:grid-cols-[264px_1fr]" id="listings">
        <aside>
          <details className="lg:hidden"><summary className="btn btn-secondary w-full">Filters</summary><div className="mt-4"><Filters action="/marketplace/" current={query} /></div></details>
          <div className="hidden lg:block"><Filters action="/marketplace/" current={query} /></div>
        </aside>
        <div>
          {result.rows.length === 0 ? (
            <EmptyState title="Nothing matches these filters." body="Try fewer filters, or set an alert on the card you want and we'll email you when one is listed." action={<Link href="/marketplace/" className="btn btn-secondary">Clear filters</Link>} />
          ) : (
            <div className="grid-tiles">{result.rows.map((l) => <ListingTile key={l.id} l={l} />)}</div>
          )}
          <Pagination basePath="/marketplace/" page={result.page} total={result.total} pageSize={result.pageSize} params={marketplaceParams(query)} anchor="listings" noun="listings" />
          <div className="mt-8"><AntiScam /></div>
        </div>
      </div>
    </div>
  )
}
