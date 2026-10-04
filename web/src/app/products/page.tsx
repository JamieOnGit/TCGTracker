import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { ProductIndex } from '@/components/ProductIndex'
import { getRepo } from '@/lib/data'
import { GRID_PAGE_SIZE, pastLastPage } from '@/lib/paging'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { productsPath } from '@/lib/seo/urls'
import { isSignedIn } from '@/lib/supabase/server'

export const revalidate = 600

const load = cache((live = false) => getRepo().listSealedProducts({ limit: 500, live }))

// Empty until the first store lists a product: noindex,follow until then.
type Props = { searchParams: Promise<SearchParams> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const rows = await load()
  return buildMetadata({
    path: productsPath(),
    title: 'Pokémon & One Piece Sealed Products in Australia',
    description: 'Pokémon TCG and One Piece Card Game booster boxes, Elite Trainer Boxes and bundles, with live stock and prices at Australian stores, RRP and restock history.',
    noindex: rows.length === 0,
    searchParams: await searchParams,
  })
}

export default async function Products({ searchParams }: Props) {
  const repo = getRepo()
  const [rows, rules] = await Promise.all([load(await isSignedIn()), repo.getRules()])
  const page = pageNumber(await searchParams)
  if (pastLastPage(page, rows.length, GRID_PAGE_SIZE)) notFound()
  return <ProductIndex rows={rows} page={page} showImages={rules.stockShowRetailerImages} isDemo={repo.isDemo} />
}
