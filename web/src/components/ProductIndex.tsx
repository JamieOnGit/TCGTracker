import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
import { Pagination } from '@/components/Pagination'
import { ProductCard } from '@/components/ProductCard'
import { EmptyState, PageIntro } from '@/components/ui'
import type { SealedProductRow } from '@/lib/data/types'
import { GRID_PAGE_SIZE, slicePage } from '@/lib/paging'
import { itemList } from '@/lib/seo/jsonld'
import { dropsPath, GAME_NAMES, GAMES, inStockPath, productPath, productsPath, releasesHubPath, type Game } from '@/lib/seo/urls'

/** /products/ and /products/{game}/: every sealed product page, most recently active first. */
export function ProductIndex({ game, rows, page, showImages, isDemo }: { game?: Game; rows: SealedProductRow[]; page: number; showImages: boolean; isDemo: boolean }) {
  const shown = slicePage(rows, page, GRID_PAGE_SIZE)
  const scope = game ? `${GAME_NAMES[game]} TCG` : 'Pokémon and One Piece'
  return (
    <div className="container-x">
      <div className="pt-6">
        <Breadcrumbs items={[{ name: 'Products', path: productsPath() }, ...(game ? [{ name: GAME_NAMES[game], path: productsPath(game) }] : [])]} />
      </div>
      <PageIntro
        eyebrow="Sealed products · Australia"
        title={game ? `${GAME_NAMES[game]} sealed products` : 'Sealed products'}
        lead={`${scope} booster boxes, bundles and other sealed product, each with live stock and prices at the Australian stores we watch, RRP and restock history.`}
      >
        <nav aria-label="Game" className="mt-6 flex flex-wrap gap-2">
          <Link href={productsPath()} className="chip-filter tap" aria-current={!game ? 'page' : undefined}>All games</Link>
          {GAMES.map((g) => <Link key={g} href={productsPath(g)} className="chip-filter tap" aria-current={game === g ? 'page' : undefined}>{GAME_NAMES[g]}</Link>)}
        </nav>
      </PageIntro>
      <section className="scroll-mt-24 pb-16" aria-labelledby="list-h" id="products">
        <h2 id="list-h" className="sr-only">Products</h2>
        {rows.length === 0 ? (
          <EmptyState title="No products yet" body="Product pages appear as the stores we watch list them." action={<Link href={dropsPath()} className="btn btn-secondary btn-sm">See stock activity</Link>} />
        ) : (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => <ProductCard key={p.id} p={p} showImages={showImages} />)}
          </div>
        )}
        <Pagination basePath={productsPath(game)} page={page} total={rows.length} pageSize={GRID_PAGE_SIZE} anchor="products" noun="products" />
        <p className="mt-10 flex flex-wrap gap-4 text-sm">
          <Link href={inStockPath()} className="prose-link">In stock now</Link>
          <Link href={dropsPath()} className="prose-link">Stock activity feed</Link>
          <Link href={releasesHubPath()} className="prose-link">Release calendar</Link>
        </p>
        {isDemo && <p className="provenance">Preview data.</p>}
      </section>
      {shown.length > 0 && <JsonLd data={itemList(shown.map((p) => ({ name: p.name, path: productPath(p) })))} />}
    </div>
  )
}
