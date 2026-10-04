import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { Faq } from '@/components/DropsCopy'
import { CheckoutButton } from '@/components/CheckoutButton'
import { JsonLd } from '@/components/JsonLd'
import { Pagination } from '@/components/Pagination'
import { FilterBar } from '@/components/FilterBar'
import { Notice, PageIntro, Stat, StatStrip } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { checkoutUrl, isInStock } from '@/lib/data/drops'
import type { Game } from '@/lib/seo/urls'
import type { StoreListingRow } from '@/lib/data/types'
import { compareStock, listingLang, parseLang, parseSearch, parseTier, productTier, searchRows, searchText, TYPE_TIERS } from '@/lib/domain/search'
import {
  absoluteTime,
  AVAILABILITY_LABEL,
  availabilityBadgeClass,
  intervalLabel,
  LISTING_FILTER_LABEL,
  LISTING_FILTERS,
  listingCounts,
  matchesListingFilter,
  parseGame,
  parseListingFilter,
  parseSlug,
  relativeTime,
  rrpDeltaLabel,
  STORE_KIND_LABEL,
  storeCoverage,
  storeStockSummary,
  storeStockTitle,
} from '@/lib/domain/stock'
import { itemList } from '@/lib/seo/jsonld'
import { pastLastPage, slicePage, TABLE_PAGE_SIZE } from '@/lib/paging'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { accountSightingsPath, dropsPath, GAME_NAMES, GAMES, LANG_NAMES, LANGS, productPath, stockPath, storesPath } from '@/lib/seo/urls'

export const revalidate = 60
type Props = { params: Promise<{ store: string }>; searchParams: Promise<SearchParams> }

const load = cache(async (slug: string, game: Game | undefined) => {
  const repo = getRepo()
  const retailer = (await repo.retailers()).find((r) => r.slug === slug)
  if (!retailer) return null
  const [rows, recent] = await Promise.all([repo.storeListings(slug, { game }), repo.drops({ retailerSlug: slug, limit: 10 })])
  return { retailer, rows, recent, isDemo: repo.isDemo }
})

const SORTS = { recommended: 'In stock first', 'price-asc': 'Price: low to high', 'price-desc': 'Price: high to low', changed: 'Recently changed', name: 'Name A–Z' } as const
type Sort = keyof typeof SORTS
const parseSortKey = (v: unknown): Sort => (typeof v === 'string' && v in SORTS ? (v as Sort) : 'recommended')

function sortListings(rows: StoreListingRow[], sort: Sort): StoreListingRow[] {
  const out = [...rows]
  const p = (r: StoreListingRow, missing: number) => r.priceAud ?? missing
  if (sort === 'price-asc') return out.sort((a, b) => p(a, Infinity) - p(b, Infinity))
  if (sort === 'price-desc') return out.sort((a, b) => p(b, -Infinity) - p(a, -Infinity))
  if (sort === 'changed') return out.sort((a, b) => (b.lastChangeAt ?? '').localeCompare(a.lastChangeAt ?? ''))
  if (sort === 'name') return out.sort((a, b) => a.title.localeCompare(b.title))
  return out.sort(compareStock)
}

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const slug = parseSlug((await params).store)
  const sp = await searchParams
  const data = slug ? await load(slug, parseGame(sp.game)) : null
  if (!data) return { title: 'Store not found', robots: { index: false } }
  const { retailer, rows } = data
  const status = parseListingFilter(sp.status)
  const interval = intervalLabel(retailer.watchIntervalSeconds)
  return buildMetadata({
    path: stockPath(retailer.slug),
    title: storeStockTitle(retailer.name),
    description: `${storeStockSummary(retailer.name, rows)} Every listing with its price and last change${interval ? `, checked ${interval}` : ''}.`,
    searchParams: sp,
    // Thin-page guard, and the status facet canonicalises to the full list.
    noindex: rows.length === 0 || status !== 'all',
  })
}

/** One store's full Pokémon & One Piece listing, live: status, price, last change. */
export default async function StoreStock({ params, searchParams }: Props) {
  const slug = parseSlug((await params).store)
  const sp = await searchParams
  const game = parseGame(sp.game)
  const data = slug ? await load(slug, game) : null
  if (!data) notFound()
  const { retailer, rows, recent, isDemo } = data
  const status = parseListingFilter(sp.status)
  const lang = parseLang(sp.lang)
  const query = parseSearch(sp.q)
  const tier = parseTier(sp.type)
  const sort = parseSortKey(sp.sort)
  // Search, language and type narrow the list; the status counts are over what's left.
  const narrowed = searchRows(rows, query, (r) => searchText(r.title, r.product?.name)).filter(
    (r) => (!lang || listingLang(r.title, r.product) === lang) && (tier === undefined || productTier(r.title) === tier),
  )
  const totals = listingCounts(rows)
  const counts = listingCounts(narrowed)
  const shown = sortListings(
    narrowed.filter((r) => matchesListingFilter(r.availability, status)),
    sort,
  )
  const filtered = Boolean(query || lang || tier !== undefined || status !== 'all')
  const page = pageNumber(sp)
  if (pastLastPage(page, shown.length, TABLE_PAGE_SIZE)) notFound()
  const pageRows = slicePage(shown, page, TABLE_PAGE_SIZE)
  const now = new Date()
  const coverage = storeCoverage(retailer, now)
  const interval = intervalLabel(retailer.watchIntervalSeconds)
  const inStockNow = rows.filter((r) => isInStock(r.availability))

  const faqs = [
    {
      q: `Does ${retailer.name} have Pokémon cards in stock?`,
      a: inStockNow.length
        ? `Yes. ${storeStockSummary(retailer.name, rows)} In stock now: ${inStockNow
            .slice(0, 6)
            .map((r) => `${r.title}${r.priceAud !== null ? ` (${aud.format(r.priceAud)})` : ''}`)
            .join('; ')}${inStockNow.length > 6 ? '; and more' : ''}.`
        : rows.length
          ? `Not right now. None of the ${rows.length} listings we track at ${retailer.name} is in stock. Set a drop alert and we’ll tell you when it’s back.`
          : `We don’t track any listings at ${retailer.name} yet. Members report in-store stock as sightings.`,
    },
    {
      q: `How often do you check ${retailer.name}?`,
      a:
        coverage.status === 'live'
          ? `Our monitor checks ${retailer.name}’s website ${interval ?? 'around the clock'}, day and night. This page refreshes every minute, and Premium members get an alert the moment stock changes.`
          : `${retailer.name} isn’t checked automatically (${coverage.label.toLowerCase()}). Stock there comes from member sightings.`,
    },
    {
      q: `Does this show in-store stock at ${retailer.name}?`,
      a: `This page shows ${retailer.name}’s online listings${rows.some((r) => r.availability === 'in_stock_cnc' || r.availability === 'in_stock_both') ? ', including click & collect' : ''}. For stock on the shelf, see member sightings for ${retailer.name}, confirmed by other members.`,
    },
  ]

  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Stock', path: stockPath() }, { name: retailer.name, path: stockPath(retailer.slug) }]} /></div>
      <PageIntro
        eyebrow={`${retailer.kind ? STORE_KIND_LABEL[retailer.kind] : 'Store'} · live stock`}
        title={`${retailer.name} Pokémon & One Piece stock`}
        lead={`${storeStockSummary(retailer.name, rows)} ${coverage.status === 'live' ? `Checked ${interval ?? 'around the clock'}; this page refreshes every minute.` : ''}`}
      >
        <div className="mt-6">
          <StatStrip cols={4}>
            <Stat label="In stock" value={totals['in-stock']} small />
            <Stat label="Pre-order" value={totals.preorder} small />
            <Stat label="Sold out" value={totals['sold-out']} small />
            <Stat label="Last checked" value={retailer.lastCheckedAt ? relativeTime(retailer.lastCheckedAt, now) : '—'} sub={coverage.status === 'live' ? interval ?? undefined : coverage.label} small />
          </StatStrip>
        </div>
        <div className="mt-6">
          <FilterBar
            action={stockPath(retailer.slug)}
            search={{ value: query, placeholder: `Search ${retailer.name} stock, e.g. etb or *151*`, label: `Search ${retailer.name} listings by product name` }}
            selects={[
              { name: 'status', label: 'Stock', value: status === 'all' ? '' : status, options: LISTING_FILTERS.map((f) => ({ value: f === 'all' ? '' : f, label: `${f === 'all' ? 'Any stock status' : LISTING_FILTER_LABEL[f]} (${counts[f]})` })) },
              { name: 'game', label: 'Game', value: game ?? '', options: [{ value: '', label: 'All games' }, ...GAMES.map((g) => ({ value: g, label: GAME_NAMES[g] }))] },
              { name: 'lang', label: 'Language', value: lang ?? '', options: [{ value: '', label: 'English & Japanese' }, ...LANGS.map((l) => ({ value: l, label: `${LANG_NAMES[l]} (${l.toUpperCase()})` }))] },
              { name: 'type', label: 'Product type', value: tier === undefined ? '' : (TYPE_TIERS[tier]?.slug ?? ''), options: [{ value: '', label: 'All products' }, ...TYPE_TIERS.map((t) => ({ value: t.slug, label: t.label }))] },
              { name: 'sort', label: 'Sort', value: sort === 'recommended' ? '' : sort, options: (Object.keys(SORTS) as Sort[]).map((k) => ({ value: k === 'recommended' ? '' : k, label: SORTS[k] })) },
            ]}
            summary={<span data-result-count={shown.length}>{shown.length} of {rows.length} {rows.length === 1 ? 'listing' : 'listings'}{query ? ` matching “${query}”` : ''}</span>}
          />
        </div>
      </PageIntro>

      {coverage.status !== 'live' && (
        <div className="mb-6">
          <Notice title={coverage.status === 'blocked' ? `${retailer.name} blocks automated checks` : `${retailer.name} is covered by members`}>
            We only read what stores publish openly. {retailer.name}’s stock comes from <Link href={dropsPath(retailer.slug)}>member sightings</Link>.{' '}
            <Link href={accountSightingsPath()} rel="nofollow">Seen stock there? Report it</Link>.
          </Notice>
        </div>
      )}

      <section className="section-tight scroll-mt-24" aria-labelledby="listings-h" id="listings">
        <h2 id="listings-h">{!filtered ? `Every listing at ${retailer.name}` : status !== 'all' ? `${LISTING_FILTER_LABEL[status]} at ${retailer.name}` : `Matching listings at ${retailer.name}`}</h2>
        {shown.length === 0 ? (
          <p className="muted py-8">{rows.length ? 'Nothing matches these filters right now. Try fewer words, or * as a wildcard.' : 'No listings tracked here yet.'}</p>
        ) : (
          <div className="table-wrap mt-4">
            <table className="dt">
              <caption className="sr-only">{retailer.name} listings with stock status, price and when they last changed</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" className="hide-sm">Status</th>
                  <th scope="col" className="num hide-sm">Price</th>
                  <th scope="col" className="hide-sm">Changed</th>
                  <th scope="col"><span className="sr-only">Links</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const delta = r.product ? rrpDeltaLabel(r.priceAud, r.product.rrpAud) : null
                  return (
                    <tr key={r.url} data-availability={r.availability}>
                      <th scope="row" style={{ fontWeight: 'normal' }}>
                        {r.product ? <Link href={productPath(r.product)} className="prose-link">{r.title}</Link> : r.title}
                        {r.game && <span className="muted block text-xs">{GAME_NAMES[r.game]}</span>}
                        {/* Phones: status and price under the name, so nothing scrolls sideways. */}
                        <span className="show-sm mt-1 flex-wrap items-center gap-2">
                          <span className={`badge ${availabilityBadgeClass(r.availability)}`}>{AVAILABILITY_LABEL[r.availability]}</span>
                          <span className="num">{r.priceAud !== null ? aud.format(r.priceAud) : ''}</span>
                          {r.lastChangeAt && <span className="muted text-xs">{relativeTime(r.lastChangeAt, now)}</span>}
                        </span>
                      </th>
                      <td className="hide-sm"><span className={`badge ${availabilityBadgeClass(r.availability)}`}>{AVAILABILITY_LABEL[r.availability]}</span></td>
                      <td className="num hide-sm">
                        {r.priceAud !== null ? aud.format(r.priceAud) : '—'}
                        {delta && <span className="muted block text-xs">{delta}</span>}
                      </td>
                      <td className="hide-sm">{r.lastChangeAt ? <time dateTime={r.lastChangeAt} title={absoluteTime(r.lastChangeAt)}>{relativeTime(r.lastChangeAt, now)}</time> : '—'}</td>
                      <td>
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          {checkoutUrl(r.availability, r.cartUrl) && <CheckoutButton href={checkoutUrl(r.availability, r.cartUrl)!} store={retailer.name} title={r.title} compact />}
                          <a href={r.url} rel="nofollow noopener" target="_blank" className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
                            View<span className="sr-only"> {r.title} at {retailer.name} (opens in a new tab)</span>
                          </a>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          basePath={stockPath(retailer.slug)}
          page={page}
          total={shown.length}
          pageSize={TABLE_PAGE_SIZE}
          params={{ q: query, status: status === 'all' ? undefined : status, game, lang, type: tier === undefined ? undefined : TYPE_TIERS[tier]?.slug, sort: sort === 'recommended' ? undefined : sort }}
          anchor="listings"
          noun="listings"
        />
        <p className="muted mt-4 text-sm">Prices in AUD as listed by {retailer.name}. Stock can sell out between checks.</p>
        {isDemo && <p className="provenance">Preview data.</p>}
      </section>

      <section className="section-tight" aria-labelledby="recent-h">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="recent-h">Latest at {retailer.name}</h2>
          <Link href={dropsPath(retailer.slug)} className="prose-link text-sm">{retailer.name} restock history</Link>
        </div>
        <DropFeed rows={recent} compact now={now} empty={`No stock changes recorded at ${retailer.name} yet.`} />
      </section>

      <p className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link href={stockPath()} className="prose-link">Stock at every store</Link>
        <Link href={storesPath()} className="prose-link">How we watch stores</Link>
      </p>
      <Faq faqs={faqs} title={`${retailer.name} stock questions`} />
      <div className="pb-16" />
      {pageRows.some((r) => r.product) && (
        <JsonLd data={itemList([...new Map(pageRows.filter((r) => r.product).map((r) => [r.product!.id, { name: r.product!.name, path: productPath(r.product!) }])).values()])} />
      )}
    </div>
  )
}
