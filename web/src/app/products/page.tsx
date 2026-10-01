import type { Metadata } from 'next'
import { cache } from 'react'
import { ProductIndex } from '@/components/ProductIndex'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { productsPath } from '@/lib/seo/urls'

export const revalidate = 600

const load = cache(() => getRepo().listSealedProducts({ limit: 500 }))

// Empty until the first store lists a product: noindex,follow until then.
export async function generateMetadata(): Promise<Metadata> {
  const rows = await load()
  return buildMetadata({
    path: productsPath(),
    title: 'Pokémon & One Piece Sealed Products in Australia',
    description: 'Pokémon TCG and One Piece Card Game booster boxes, Elite Trainer Boxes and bundles, with live stock and prices at Australian stores, RRP and restock history.',
    noindex: rows.length === 0,
  })
}

export default async function Products() {
  const repo = getRepo()
  const [rows, rules] = await Promise.all([load(), repo.getRules()])
  return <ProductIndex rows={rows} showImages={rules.stockShowRetailerImages} isDemo={repo.isDemo} />
}
