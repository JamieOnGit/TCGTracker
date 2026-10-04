import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { ProductIndex } from '@/components/ProductIndex'
import { getRepo } from '@/lib/data'
import { GRID_PAGE_SIZE, pastLastPage } from '@/lib/paging'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { GAME_NAMES, isGame, productsPath, type Game } from '@/lib/seo/urls'
import { isSignedIn } from '@/lib/supabase/server'

export const revalidate = 600
type Props = { params: Promise<{ game: string }>; searchParams: Promise<SearchParams> }

const load = cache((game: Game, live = false) => getRepo().listSealedProducts({ game, limit: 500, live }))

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { game } = await params
  if (!isGame(game)) return {}
  const rows = await load(game)
  const name = GAME_NAMES[game]
  return buildMetadata({
    path: productsPath(game),
    title: `${name} TCG Sealed Products: Stock & Prices in Australia`,
    description: `${name} TCG booster boxes, bundles and other sealed product: live stock and prices at Australian stores, RRP and restock history for each product.`,
    noindex: rows.length === 0,
    searchParams: await searchParams,
  })
}

export default async function GameProducts({ params, searchParams }: Props) {
  const { game } = await params
  if (!isGame(game)) notFound()
  const repo = getRepo()
  const [rows, rules] = await Promise.all([load(game, await isSignedIn()), repo.getRules()])
  const page = pageNumber(await searchParams)
  if (pastLastPage(page, rows.length, GRID_PAGE_SIZE)) notFound()
  return <ProductIndex game={game} rows={rows} page={page} showImages={rules.stockShowRetailerImages} isDemo={repo.isDemo} />
}
