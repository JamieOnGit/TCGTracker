import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { AntiScam, ListingList } from '@/components/ListingList'
import { Pagination } from '@/components/Pagination'
import { getRepo } from '@/lib/data'
import { buildMetadata, type SearchParams } from '@/lib/seo/metadata'
import { GAME_NAMES, isGame, marketplacePath } from '@/lib/seo/urls'
import { Filters, parseMarketplaceQuery } from '@/components/MarketplaceFilters'

export const revalidate = 120
type Props = { params: Promise<{ game: string }>; searchParams: Promise<SearchParams> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { game } = await params
  if (!isGame(game)) return {}
  return buildMetadata({
    path: marketplacePath(game),
    title: `${GAME_NAMES[game]} Cards for Sale in Australia`,
    description: `${GAME_NAMES[game]} graded slabs, raw singles and sealed product from Australian sellers, EN and JP.`,
    searchParams: await searchParams,
  })
}

export default async function GameMarketplace({ params, searchParams }: Props) {
  const { game } = await params
  if (!isGame(game)) notFound()
  const query = parseMarketplaceQuery(await searchParams, game)
  const result = await getRepo().marketplace(query)
  return (
    <>
      <Breadcrumbs items={[{ name: 'Marketplace', path: '/marketplace/' }, { name: GAME_NAMES[game], path: marketplacePath(game) }]} />
      <h1>{GAME_NAMES[game]} cards for sale</h1>
      <AntiScam />
      <Filters action={marketplacePath(game)} />
      <ListingList rows={result.rows} />
      <Pagination basePath={marketplacePath(game)} page={result.page} total={result.total} pageSize={result.pageSize} />
    </>
  )
}
