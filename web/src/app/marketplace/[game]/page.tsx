import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AntiScam } from '@/components/AntiScam'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ListingTile } from '@/components/ListingTile'
import { Filters, parseMarketplaceQuery } from '@/components/MarketplaceFilters'
import { Pagination } from '@/components/Pagination'
import { EmptyState, PageIntro, SegLinks } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata, type SearchParams } from '@/lib/seo/metadata'
import { GAMES, GAME_NAMES, isGame, marketplacePath, sellPath } from '@/lib/seo/urls'

export const revalidate = 120
type Props = { params: Promise<{ game: string }>; searchParams: Promise<SearchParams> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { game } = await params
  if (!isGame(game)) return {}
  return buildMetadata({
    path: marketplacePath(game),
    title: `${GAME_NAMES[game]} Cards for Sale in Australia – Graded, Raw & Sealed`,
    description: `${GAME_NAMES[game]} graded slabs, raw singles and sealed product for sale from Australian sellers, English and Japanese, priced in AUD.`,
    searchParams: await searchParams,
  })
}

export default async function GameMarketplace({ params, searchParams }: Props) {
  const { game } = await params
  if (!isGame(game)) notFound()
  const query = parseMarketplaceQuery(await searchParams, game)
  const result = await getRepo().marketplace(query)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Marketplace', path: '/marketplace/' }, { name: GAME_NAMES[game], path: marketplacePath(game) }]} /></div>
      <PageIntro eyebrow="Marketplace · Australia" title={`${GAME_NAMES[game]} cards for sale`} lead={`${result.total.toLocaleString('en-AU')} listed by Australian collectors, in AUD.`}>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <SegLinks label="Game" options={[{ href: '/marketplace/', label: 'All', current: false }, ...GAMES.map((g) => ({ href: marketplacePath(g), label: GAME_NAMES[g], current: g === game }))]} />
          <Link href={sellPath()} className="btn btn-primary btn-sm" rel="nofollow">Sell a card</Link>
        </div>
      </PageIntro>
      <div className="grid gap-10 lg:grid-cols-[264px_1fr]">
        <aside>
          <details className="lg:hidden"><summary className="btn btn-secondary w-full">Filters</summary><div className="mt-4"><Filters action={marketplacePath(game)} current={query} /></div></details>
          <div className="hidden lg:block"><Filters action={marketplacePath(game)} current={query} /></div>
        </aside>
        <div>
          {result.rows.length === 0 ? <EmptyState title="Nothing listed here yet." body="Be the first: list a card in minutes." action={<Link href={sellPath()} className="btn btn-secondary" rel="nofollow">Sell a card</Link>} /> : <div className="grid-tiles">{result.rows.map((l) => <ListingTile key={l.id} l={l} />)}</div>}
          <Pagination basePath={marketplacePath(game)} page={result.page} total={result.total} pageSize={result.pageSize} />
          <div className="mt-8"><AntiScam /></div>
        </div>
      </div>
    </div>
  )
}
