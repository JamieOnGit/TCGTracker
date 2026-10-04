import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { Faq } from '@/components/DropsCopy'
import { JsonLd } from '@/components/JsonLd'
import { Pagination } from '@/components/Pagination'
import { ProductCard } from '@/components/ProductCard'
import { FilterBar } from '@/components/FilterBar'
import { EmptyState, PageIntro, Stat, StatStrip } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { AU_STATES, AU_STATE_NAMES } from '@/lib/data/types'
import { durationLabel } from '@/lib/domain/drops'
import { notFound, redirect } from 'next/navigation'
import { parseLang, parseSearch, searchRows, searchText, sortProducts } from '@/lib/domain/search'
import { absoluteTime, feedHref, intervalLabel, parseGame, parseSlug, relativeTime, sortStoresByStock, stockTotals, storeCoverage } from '@/lib/domain/stock'
import { itemList } from '@/lib/seo/jsonld'
import { GRID_PAGE_SIZE, pastLastPage, slicePage, TABLE_PAGE_SIZE } from '@/lib/paging'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { accountSightingsPath, dropsPath, dropsStatePath, GAME_NAMES, GAMES, inStockPath, LANG_NAMES, LANGS, stockPath, storesPath } from '@/lib/seo/urls'
import { RetailerMark } from '@/components/RetailerMark'
import { StockFreshness } from '@/components/StockFreshness'
import { isSignedIn } from '@/lib/supabase/server'

// Stock pages refresh every minute; the monitor checks most stores every 2–5 minutes.
export const revalidate = 60
type Props = { searchParams: Promise<SearchParams> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildMetadata({
    path: stockPath(),
    title: 'Pokémon & One Piece Card Stock in Australia, Live',
    description:
      'Live Pokémon TCG and One Piece card stock at Australian stores: what is in stock and on pre-order at Kmart, Target, JB Hi-Fi, BIG W and specialist shops, store by store.',
    searchParams: await searchParams,
  })
}

/** The stock hub: totals, every store's live counts, the most available products and in-store sightings. */
export default async function StockHub({ searchParams }: Props) {
  const sp = await searchParams
  const game = parseGame(sp.game)
  const lang = parseLang(sp.lang)
  const query = parseSearch(sp.q)
  // "Jump to a store" (works without JavaScript too): ?store=kmart → /stock/kmart/.
  const store = parseSlug(sp.store)
  if (store) redirect(feedHref(stockPath(store), { game, lang, q: query }))
  const searching = Boolean(query || lang)
  const repo = getRepo()
  const now = new Date()
  // Members (signed in, Free or Premium) see stock live; visitors see it stock.public_delay_minutes later.
  const live = await isSignedIn()
  const [overview, products, recent, rules] = await Promise.all([
    repo.stockOverview({ game, live }),
    repo.inStock({ game, limit: searching ? 300 : 60, live }),
    repo.drops({ game, source: 'monitor', limit: 8 }),
    repo.getRules(),
  ])
  const totals = stockTotals(overview.stores)
  const tracked = sortStoresByStock(overview.stores.filter((s) => s.listings > 0))
  const sightingsOnly = overview.stores.filter((s) => s.listings === 0).sort((a, b) => a.name.localeCompare(b.name))
  const matches = searching ? sortProducts(searchRows(products, query, (p) => searchText(p.name, p.set?.name, p.type.replace(/-/g, ' '))).filter((p) => !lang || p.lang === lang), 'recommended') : []
  const mostAvailable = sortProducts(products, 'recommended').slice(0, 9)
  const page = pageNumber(sp)
  if (pastLastPage(page, tracked.length, TABLE_PAGE_SIZE)) notFound()
  const storeRows = slicePage(tracked, page, TABLE_PAGE_SIZE)
  const freeDelay = durationLabel(rules.freeDropDelayMinutes)
  const stockDelay = durationLabel(rules.stockPublicDelayMinutes)
  const gameLabel = game ? GAME_NAMES[game] : 'Pokémon and One Piece'

  const faqs = [
    {
      q: 'How live is this stock data?',
      a: `Signed-in members, Free or Premium, see stock live: our monitor checks each online store every 2 to 5 minutes, ${totals.storesLive} stores around the clock. Visitors who haven't signed up see the same pages ${stockDelay} behind. Drop alerts reach Premium members the moment we see a change, and free members ${freeDelay} later.`,
    },
    {
      q: 'Which Australian stores have Pokémon cards in stock right now?',
      a: tracked.filter((s) => s.inStock > 0).length
        ? `Right now: ${tracked
            .filter((s) => s.inStock > 0)
            .slice(0, 8)
            .map((s) => `${s.name} (${s.inStock} in stock)`)
            .join(', ')}. Open a store for every listing and its price.`
        : 'Nothing is in stock at the stores we check online right now. Turn on drop alerts and we will tell you the moment it lands.',
    },
    {
      q: 'Do you show in-store stock?',
      a: 'Store pages show each retailer’s online stock, plus click & collect where the store publishes it (JB Hi-Fi). In-store stock comes from member sightings: stock members have seen on the shelf, confirmed by other members, listed by state.',
    },
    {
      q: 'Why isn’t every store checked automatically?',
      a: 'We only read what stores publish openly, with an honestly named bot that follows each store’s rules. Stores that block automated access, or have no online catalogue, are covered by member sightings instead.',
    },
  ]

  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Stock', path: stockPath() }]} /></div>
      <PageIntro
        eyebrow="Live stock · Australia"
        title="Pokémon & One Piece card stock in Australia"
        lead={`What ${gameLabel} sealed product is in stock and on pre-order right now at the Australian stores we watch, store by store. Live for signed-in members (free), ${stockDelay} behind for visitors.`}
      >
        <StockFreshness live={live} delayMinutes={rules.stockPublicDelayMinutes} next={stockPath()} />
        <div className="mt-6">
          <FilterBar
            action={stockPath()}
            search={{ value: query, placeholder: 'Search stock at every store, e.g. prismatic etb or op*09', label: 'Search stock by product name' }}
            selects={[
              { name: 'store', label: 'Jump to a store', value: '', options: [{ value: '', label: 'Every store' }, ...sortStoresByStock(overview.stores.filter((st) => st.listings > 0)).map((st) => ({ value: st.slug, label: `${st.name} (${st.inStock} in stock)` }))] },
              { name: 'game', label: 'Game', value: game ?? '', options: [{ value: '', label: 'All games' }, ...GAMES.map((g) => ({ value: g, label: GAME_NAMES[g] }))] },
              { name: 'lang', label: 'Language', value: lang ?? '', options: [{ value: '', label: 'English & Japanese' }, ...LANGS.map((l) => ({ value: l, label: `${LANG_NAMES[l]} (${l.toUpperCase()})` }))] },
            ]}
          />
        </div>
        <div className="mt-6">
          <StatStrip cols={4}>
            <Stat label="Listings in stock now" value={totals.inStock} sub={`${totals.preorder} on pre-order`} small />
            <Stat label="Stores with stock" value={totals.storesWithStock} sub={`of ${tracked.length} we track listings at`} small />
            <Stat label="Stores checked live" value={totals.storesLive} sub="every 2–5 minutes" small />
            <Stat label="Stock changes" value={overview.events7d} sub="last 7 days" small />
          </StatStrip>
        </div>
      </PageIntro>

      {searching && (
        <section className="section-tight" aria-labelledby="results-h">
          <h2 id="results-h">{query ? `In stock & pre-order: “${query}”` : `${LANG_NAMES[lang!]} products in stock`}</h2>
          <p className="muted mt-2 text-sm" data-result-count={matches.length}>
            {matches.length} {matches.length === 1 ? 'product' : 'products'} in stock or on pre-order. Open a store for sold-out listings too.
          </p>
          {matches.length === 0 ? (
            <EmptyState title="Nothing in stock matches" body="Try fewer words, or * as a wildcard (e.g. char*ex). Set a Notify me on a product page and we’ll tell you when it lands." />
          ) : (
            <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {matches.slice(0, GRID_PAGE_SIZE).map((p) => <ProductCard key={p.id} p={p} showImages={rules.stockShowRetailerImages} />)}
            </div>
          )}
          {matches.length > GRID_PAGE_SIZE && (
            <p className="mt-6 text-sm"><Link href={feedHref(inStockPath(), { q: query, game, lang })} className="prose-link">All {matches.length} matching products</Link></p>
          )}
        </section>
      )}

      <section className="section-tight scroll-mt-24" aria-labelledby="by-store-h" id="by-store">
        <h2 id="by-store-h">Stock by store</h2>
        <p className="muted mt-2 text-sm">Pokémon and One Piece listings each store has online, live. Open a store for every listing, its price and when it last changed.</p>
        {tracked.length === 0 ? (
          <p className="muted py-8">We aren’t tracking any listings yet. The monitor fills this in within minutes of starting.</p>
        ) : (
          <div className="table-wrap mt-4">
            <table className="dt">
              <caption className="sr-only">Live stock by store: listings in stock, on pre-order and tracked, and when stock last changed</caption>
              <thead>
                <tr>
                  <th scope="col">Store</th>
                  <th scope="col" className="num">In stock</th>
                  <th scope="col" className="num hide-sm">Pre-order</th>
                  <th scope="col" className="num hide-sm">Listings</th>
                  <th scope="col">Last change</th>
                  <th scope="col" className="hide-sm">Checked</th>
                </tr>
              </thead>
              <tbody>
                {storeRows.map((s) => {
                  const c = storeCoverage(s, now)
                  return (
                    <tr key={s.slug} data-in-stock={s.inStock > 0 ? 'yes' : 'no'}>
                      <th scope="row">
                        <span className="inline-flex items-center gap-2">
                          <RetailerMark slug={s.slug} name={s.name} />
                          <Link href={stockPath(s.slug)} className="prose-link">{s.name}</Link>
                        </span>
                      </th>
                      <td className="num">{s.inStock > 0 ? <span className="badge badge-live">{s.inStock}</span> : <span className="muted">0</span>}</td>
                      <td className="num hide-sm">{s.preorder || <span className="muted">0</span>}</td>
                      <td className="num hide-sm">{s.listings}</td>
                      <td>{s.lastChangeAt ? <time dateTime={s.lastChangeAt} title={absoluteTime(s.lastChangeAt)}>{relativeTime(s.lastChangeAt, now)}</time> : '—'}</td>
                      <td className="hide-sm">{c.status === 'live' ? intervalLabel(s.watchIntervalSeconds) ?? 'Around the clock' : c.status === 'blocked' ? 'Blocked by store' : 'By members'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath={stockPath()} page={page} total={tracked.length} pageSize={TABLE_PAGE_SIZE} params={{ q: query, game, lang }} anchor="by-store" noun="stores" />
        {sightingsOnly.length > 0 && (
          <p className="muted mt-4 text-sm">
            Covered by member sightings:{' '}
            {sightingsOnly.map((s, i) => (
              <span key={s.slug}>
                {i > 0 && ', '}
                <Link href={dropsPath(s.slug)} className="prose-link">{s.name}</Link>
              </span>
            ))}
            . <Link href={storesPath()} className="prose-link">How we cover each store</Link>
          </p>
        )}
        {repo.isDemo && <p className="provenance">Preview data.</p>}
      </section>

      {!searching && mostAvailable.length > 0 && (
        <section className="section-tight" aria-labelledby="most-h">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="most-h">Most available right now</h2>
            <Link href={inStockPath()} className="prose-link text-sm">Every product in stock</Link>
          </div>
          <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {mostAvailable.map((p) => <ProductCard key={p.id} p={p} showImages={rules.stockShowRetailerImages} />)}
          </div>
        </section>
      )}

      <section className="section-tight" aria-labelledby="instore-h">
        <h2 id="instore-h">In-store stock by state</h2>
        <p className="muted mt-2 max-w-[var(--measure)] text-sm">
          Stock members have seen on the shelf at Kmart, Target, BIG W, EB Games and local stores, confirmed by other members.{' '}
          <Link href={accountSightingsPath()} rel="nofollow" className="prose-link">Report stock you’ve seen</Link>.
        </p>
        <nav aria-label="In-store stock by state" className="mt-4 flex flex-wrap gap-2">
          {AU_STATES.map((st) => (
            <Link key={st} href={dropsStatePath(st)} className="chip-filter tap">{AU_STATE_NAMES[st]}</Link>
          ))}
        </nav>
      </section>

      <section className="section-tight" aria-labelledby="recent-h">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="recent-h">Latest stock changes</h2>
          <Link href={dropsPath()} className="prose-link text-sm">Full stock activity feed</Link>
        </div>
        <p className="muted mt-2 text-sm">
          Restocks, new listings and pre-orders as they happen. <Link href="/premium/" className="prose-link">Premium</Link> members get alerts instantly; free members {freeDelay} later.
        </p>
        <DropFeed rows={recent} compact now={now} empty="No stock changes yet." />
      </section>

      <Faq faqs={faqs} title="Stock questions" />
      <div className="pb-16" />
      {tracked.length > 0 && <JsonLd data={itemList(tracked.map((s) => ({ name: `${s.name} stock`, path: stockPath(s.slug) })))} />}
    </div>
  )
}
