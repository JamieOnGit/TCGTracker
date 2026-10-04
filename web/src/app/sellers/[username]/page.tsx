import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { fmtDate, PremiumBadge } from '@/components/Format'
import { ListingTile } from '@/components/ListingTile'
import { EmptyState, PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { Pagination } from '@/components/Pagination'
import { GRID_PAGE_SIZE, pastLastPage, slicePage } from '@/lib/paging'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { sellerPath } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { params: Promise<{ username: string }>; searchParams: Promise<SearchParams> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const repo = getRepo()
  const seller = await repo.getSeller((await params).username)
  if (!seller) return {}
  const listings = await repo.listingsBySeller(seller.username)
  return buildMetadata({
    noindex: listings.length === 0, // an empty profile is a thin page
    path: sellerPath(seller.username),
    title: `${seller.displayName ?? seller.username} – Seller Profile`,
    description: `Cards for sale from ${seller.displayName ?? seller.username}${seller.state ? ` (${seller.state})` : ''}, member since ${seller.memberSince.slice(0, 7)}.`,
    searchParams: await searchParams,
  })
}

export default async function SellerPage({ params, searchParams }: Props) {
  const repo = getRepo()
  const seller = await repo.getSeller((await params).username)
  if (!seller) notFound()
  const listings = await repo.listingsBySeller(seller.username)
  const page = pageNumber(await searchParams)
  if (pastLastPage(page, listings.length, GRID_PAGE_SIZE)) notFound()
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Marketplace', path: '/marketplace/' }, { name: seller.username, path: sellerPath(seller.username) }]} /></div>
      <PageIntro eyebrow={`Seller · ${seller.state ?? 'Australia'} · member since ${fmtDate(seller.memberSince)}`} title={seller.displayName ?? seller.username}>
        <p className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          {seller.premium && <PremiumBadge />}
          <span className="muted">Response rate {seller.responseRate === null ? '—' : `${Math.round(seller.responseRate * 100)}%`}</span>
          <a href={`/report/?user=${seller.username}`} rel="nofollow" className="prose-link muted">Report</a>
        </p>
      </PageIntro>
      <h2 id="listings" className="scroll-mt-24">Listings</h2>
      {listings.length === 0 ? <EmptyState title="Nothing listed right now." /> : <div className="grid-tiles cols-4 mt-6">{slicePage(listings, page, GRID_PAGE_SIZE).map((l) => <ListingTile key={l.id} l={l} />)}</div>}
      <Pagination basePath={sellerPath(seller.username)} page={page} total={listings.length} pageSize={GRID_PAGE_SIZE} anchor="listings" noun="listings" />
    </div>
  )
}
