import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { AntiScam, ListingList } from '@/components/ListingList'
import { Pagination } from '@/components/Pagination'
import { Filters, parseMarketplaceQuery } from '@/components/MarketplaceFilters'
import { getRepo } from '@/lib/data'
import { buildMetadata, type SearchParams } from '@/lib/seo/metadata'
import { GAMES, GAME_NAMES, marketplacePath, sellPath } from '@/lib/seo/urls'

export const revalidate = 120
type Props = { searchParams: Promise<SearchParams> }
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildMetadata({
    path: '/marketplace/',
    title: 'Pokémon & One Piece Cards for Sale in Australia – Graded, Raw & Sealed',
    description: 'Buy graded slabs, raw singles and sealed product from Australian collectors. Every listing is reviewed before it goes live.',
    searchParams: await searchParams,
  })
}

export default async function Marketplace({ searchParams }: Props) {
  const query = parseMarketplaceQuery(await searchParams)
  const result = await getRepo().marketplace(query)
  return (
    <>
      <Breadcrumbs items={[{ name: 'Marketplace', path: '/marketplace/' }]} />
      <h1>Marketplace</h1>
      <p><Link href={sellPath()} rel="nofollow">Sell a card</Link> · {GAMES.map((g) => <Link key={g} href={marketplacePath(g)}>{GAME_NAMES[g]} </Link>)}</p>
      <AntiScam />
      <Filters action="/marketplace/" />
      <ListingList rows={result.rows} />
      <Pagination basePath="/marketplace/" page={result.page} total={result.total} pageSize={result.pageSize} />
    </>
  )
}
