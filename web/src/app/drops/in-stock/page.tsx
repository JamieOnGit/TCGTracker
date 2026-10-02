import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
import { ProductCard } from '@/components/ProductCard'
import { EmptyState, PageIntro, SegLinks } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { isInStock } from '@/lib/data/drops'
import { feedHref, parseGame, parseSlug } from '@/lib/domain/stock'
import { itemList } from '@/lib/seo/jsonld'
import { buildMetadata, type SearchParams } from '@/lib/seo/metadata'
import { dropsPath, GAME_NAMES, GAMES, inStockPath, productPath, productsPath, stockPath, storesPath } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { searchParams: Promise<SearchParams> }

// ?game= / ?retailer= facets are noindex,follow and canonicalise here.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildMetadata({
    path: inStockPath(),
    title: 'Pokémon & One Piece Cards In Stock Now in Australia',
    description: 'Pokémon TCG and One Piece sealed product in stock or on pre-order right now at Australian stores, with the lowest price against RRP and where to buy.',
    searchParams: await searchParams,
  })
}

/** Products in stock or on pre-order anywhere we watch, most recently changed first. */
export default async function InStock({ searchParams }: Props) {
  const sp = await searchParams
  const game = parseGame(sp.game)
  const retailer = parseSlug(sp.retailer)
  const repo = getRepo()
  const [all, rules] = await Promise.all([repo.inStock({ game, limit: 300 }), repo.getRules()])
  // Store facet: every store with something live in this view.
  const stores = new Map<string, string>()
  for (const p of all) for (const o of p.offers) if (isInStock(o.availability) || o.availability === 'preorder') stores.set(o.retailerSlug, o.retailerName)
  const rows = retailer ? all.filter((p) => p.offers.some((o) => o.retailerSlug === retailer && (isInStock(o.availability) || o.availability === 'preorder'))) : all
  const q = { game, retailer }
  const storeName = retailer ? stores.get(retailer) : undefined

  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: dropsPath() }, { name: 'In stock now', path: inStockPath() }]} /></div>
      <PageIntro
        eyebrow="Live stock · Australia"
        title="In stock now"
        lead="Pokémon and One Piece sealed product that Australian stores list as in stock or on pre-order right now, grouped by product, with the lowest price we see against RRP. Tap Notify me and we’ll alert you the next time a product comes back anywhere."
      >
        <div className="mt-6 grid gap-3">
          <SegLinks label="Game" options={[{ href: feedHref(inStockPath(), { ...q, game: undefined }), label: 'All games', current: !game }, ...GAMES.map((g) => ({ href: feedHref(inStockPath(), { ...q, game: g }), label: GAME_NAMES[g], current: game === g }))]} />
          {stores.size > 0 && (
            <nav aria-label="Store" className="flex flex-wrap items-center gap-2">
              <span className="tag-quiet mr-1">Store</span>
              <Link href={feedHref(inStockPath(), { ...q, retailer: undefined })} className="chip-filter tap" aria-current={!retailer ? 'page' : undefined} scroll={false}>All stores</Link>
              {[...stores].sort((a, b) => a[1].localeCompare(b[1])).map(([slug, name]) => (
                <Link key={slug} href={feedHref(inStockPath(), { ...q, retailer: slug })} className="chip-filter tap" aria-current={retailer === slug ? 'page' : undefined} scroll={false}>{name}</Link>
              ))}
            </nav>
          )}
        </div>
      </PageIntro>

      <section className="pb-16" aria-labelledby="list-h">
        <h2 id="list-h" className="sr-only">{storeName ? `In stock at ${storeName}` : 'Products in stock'}</h2>
        <p className="muted text-sm">{rows.length} {rows.length === 1 ? 'product' : 'products'}{storeName ? ` at ${storeName}` : ''}{game ? ` · ${GAME_NAMES[game]}` : ''}. Prices in AUD as listed by each store.</p>
        {rows.length === 0 ? (
          <EmptyState title="Nothing in stock right now" body="Stock comes and goes within minutes. Set a Notify me on a product, or turn on drop alerts, and we’ll tell you when it lands." action={<Link href={productsPath()} className="btn btn-secondary btn-sm">Browse all products</Link>} />
        ) : (
          <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((p) => <ProductCard key={p.id} p={p} showImages={rules.stockShowRetailerImages} />)}
          </div>
        )}
        <p className="mt-10 flex flex-wrap gap-4 text-sm">
          <Link href={dropsPath()} className="prose-link">Stock activity feed</Link>
          <Link href={productsPath()} className="prose-link">All products</Link>
          <Link href={stockPath()} className="prose-link">Live stock by store</Link>
          <Link href={storesPath()} className="prose-link">Stores we watch</Link>
        </p>
        {repo.isDemo && <p className="provenance">Preview data.</p>}
      </section>
      {rows.length > 0 && <JsonLd data={itemList(rows.map((p) => ({ name: p.name, path: productPath(p) })))} />}
    </div>
  )
}
