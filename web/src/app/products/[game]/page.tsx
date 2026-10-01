import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { ProductIndex } from '@/components/ProductIndex'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { GAME_NAMES, isGame, productsPath, type Game } from '@/lib/seo/urls'

export const revalidate = 600
type Props = { params: Promise<{ game: string }> }

const load = cache((game: Game) => getRepo().listSealedProducts({ game, limit: 500 }))

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params
  if (!isGame(game)) return {}
  const rows = await load(game)
  const name = GAME_NAMES[game]
  return buildMetadata({
    path: productsPath(game),
    title: `${name} TCG Sealed Products: Stock & Prices in Australia`,
    description: `${name} TCG booster boxes, bundles and other sealed product: live stock and prices at Australian stores, RRP and restock history for each product.`,
    noindex: rows.length === 0,
  })
}

export default async function GameProducts({ params }: Props) {
  const { game } = await params
  if (!isGame(game)) notFound()
  const repo = getRepo()
  const [rows, rules] = await Promise.all([load(game), repo.getRules()])
  return <ProductIndex game={game} rows={rows} showImages={rules.stockShowRetailerImages} isDemo={repo.isDemo} />
}
