import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pagination } from '@/components/Pagination'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
import { ProductCard } from '@/components/ProductCard'
import { FilterBar } from '@/components/FilterBar'
import { EmptyState, PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { isInStock } from '@/lib/data/drops'
import { parseLang, parseProductSort, parseSearch, parseTier, PRODUCT_SORT_LABEL, PRODUCT_SORTS, productTier, searchRows, searchText, sortProducts, TYPE_TIERS } from '@/lib/domain/search'
import { parseGame, parseSlug } from '@/lib/domain/stock'
import { itemList } from '@/lib/seo/jsonld'
import { GRID_PAGE_SIZE, pastLastPage, slicePage } from '@/lib/paging'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { dropsPath, GAME_NAMES, GAMES, inStockPath, LANG_NAMES, LANGS, productPath, productsPath, stockPath, storesPath } from '@/lib/seo/urls'
import type { SealedProductRow } from '@/lib/data/types'

export const revalidate = 300
type Props = { searchParams: Promise<SearchParams> }

// ?q= / ?game= / ?lang= / ?retailer= / ?type= / ?sort= facets are noindex,follow and canonicalise here.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildMetadata({
    path: inStockPath(),
    title: 'Pokémon & One Piece Cards In Stock Now in Australia',
    description: 'Pokémon TCG and One Piece sealed product in stock or on pre-order right now at Australian stores, with the lowest price against RRP and where to buy.',
    searchParams: await searchParams,
  })
}

const live = (o: SealedProductRow['offers'][number]) => isInStock(o.availability) || o.availability === 'preorder'

/** Products in stock or on pre-order anywhere we watch: in stock and the sought-after types first. */
export default async function InStock({ searchParams }: Props) {
  const sp = await searchParams
  const game = parseGame(sp.game)
  const lang = parseLang(sp.lang)
  const query = parseSearch(sp.q)
  const retailer = parseSlug(sp.retailer)
  const tier = parseTier(sp.type)
  const sort = parseProductSort(sp.sort)
  const repo = getRepo()
  const [all, rules] = await Promise.all([repo.inStock({ game, limit: 300 }), repo.getRules()])
  // Store options: every store with something live in this view.
  const stores = new Map<string, string>()
  for (const p of all) for (const o of p.offers) if (live(o)) stores.set(o.retailerSlug, o.retailerName)
  const filtered = searchRows(all, query, (p) => searchText(p.name, p.set?.name, p.type.replace(/-/g, ' '))).filter(
    (p) =>
      (!lang || p.lang === lang) &&
      (tier === undefined || productTier(p.name, p.type) === tier) &&
      (!retailer || p.offers.some((o) => o.retailerSlug === retailer && live(o))),
  )
  const rows = sortProducts(filtered, sort)
  const page = pageNumber(sp)
  if (pastLastPage(page, rows.length, GRID_PAGE_SIZE)) notFound()
  const shown = slicePage(rows, page, GRID_PAGE_SIZE)
  const storeName = retailer ? stores.get(retailer) : undefined

  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: dropsPath() }, { name: 'In stock now', path: inStockPath() }]} /></div>
      <PageIntro
        eyebrow="Live stock · Australia"
        title="In stock now"
        lead="Pokémon and One Piece sealed product that Australian stores list as in stock or on pre-order right now, grouped by product, with the lowest price we see against RRP. Tap Notify me and we’ll alert you the next time a product comes back anywhere."
      >
        <div className="mt-6">
          <FilterBar
            action={inStockPath()}
            search={{ value: query, placeholder: 'Search products, e.g. 151 etb or *booster box', label: 'Search products in stock by name' }}
            selects={[
              { name: 'game', label: 'Game', value: game ?? '', options: [{ value: '', label: 'All games' }, ...GAMES.map((g) => ({ value: g, label: GAME_NAMES[g] }))] },
              { name: 'lang', label: 'Language', value: lang ?? '', options: [{ value: '', label: 'English & Japanese' }, ...LANGS.map((l) => ({ value: l, label: `${LANG_NAMES[l]} (${l.toUpperCase()})` }))] },
              { name: 'type', label: 'Product type', value: tier === undefined ? '' : (TYPE_TIERS[tier]?.slug ?? ''), options: [{ value: '', label: 'All products' }, ...TYPE_TIERS.map((t) => ({ value: t.slug, label: t.label }))] },
              { name: 'retailer', label: 'Store', value: retailer ?? '', options: [{ value: '', label: 'All stores' }, ...[...stores].sort((a, b) => a[1].localeCompare(b[1])).map(([slug, name]) => ({ value: slug, label: name }))] },
              { name: 'sort', label: 'Sort', value: sort === 'recommended' ? '' : sort, options: PRODUCT_SORTS.map((k) => ({ value: k === 'recommended' ? '' : k, label: PRODUCT_SORT_LABEL[k] })) },
            ]}
            summary={
              <span data-result-count={rows.length}>
                {rows.length} {rows.length === 1 ? 'product' : 'products'}
                {storeName ? ` at ${storeName}` : ''}
                {query ? ` matching “${query}”` : ''}. Prices in AUD as listed by each store.
              </span>
            }
          />
        </div>
      </PageIntro>

      <section className="scroll-mt-24 pb-16" aria-labelledby="list-h" id="products">
        <h2 id="list-h" className="sr-only">{storeName ? `In stock at ${storeName}` : 'Products in stock'}</h2>
        {rows.length === 0 ? (
          <EmptyState title={query || lang || tier !== undefined || retailer ? 'Nothing matches these filters' : 'Nothing in stock right now'} body="Stock comes and goes within minutes. Set a Notify me on a product, or turn on drop alerts, and we’ll tell you when it lands." action={<Link href={productsPath()} className="btn btn-secondary btn-sm">Browse all products</Link>} />
        ) : (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => <ProductCard key={p.id} p={p} showImages={rules.stockShowRetailerImages} />)}
          </div>
        )}
        <Pagination basePath={inStockPath()} page={page} total={rows.length} pageSize={GRID_PAGE_SIZE} params={{ q: query, game, lang, type: tier === undefined ? undefined : TYPE_TIERS[tier]?.slug, retailer, sort: sort === 'recommended' ? undefined : sort }} anchor="products" noun="products" />
        <p className="mt-10 flex flex-wrap gap-4 text-sm">
          <Link href={dropsPath()} className="prose-link">Stock activity feed</Link>
          <Link href={productsPath()} className="prose-link">All products</Link>
          <Link href={stockPath()} className="prose-link">Live stock by store</Link>
          <Link href={storesPath()} className="prose-link">Stores we watch</Link>
        </p>
        {repo.isDemo && <p className="provenance">Preview data.</p>}
      </section>
      {shown.length > 0 && <JsonLd data={itemList(shown.map((p) => ({ name: p.name, path: productPath(p) })))} />}
    </div>
  )
}
