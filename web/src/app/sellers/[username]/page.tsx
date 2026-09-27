import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ListingList } from '@/components/ListingList'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { sellerPath } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { params: Promise<{ username: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const seller = await getRepo().getSeller((await params).username)
  if (!seller) return {}
  return buildMetadata({
    path: sellerPath(seller.username),
    title: `${seller.displayName ?? seller.username} – Seller Profile`,
    description: `Cards for sale from ${seller.displayName ?? seller.username}${seller.state ? ` (${seller.state})` : ''}, member since ${seller.memberSince.slice(0, 7)}.`,
  })
}

export default async function SellerPage({ params }: Props) {
  const repo = getRepo()
  const seller = await repo.getSeller((await params).username)
  if (!seller) notFound()
  const listings = await repo.listingsBySeller(seller.username)
  return (
    <>
      <Breadcrumbs items={[{ name: 'Marketplace', path: '/marketplace/' }, { name: seller.username, path: sellerPath(seller.username) }]} />
      <h1>{seller.displayName ?? seller.username}{seller.premium ? ' (Premium)' : ''}</h1>
      <p>Member since {seller.memberSince.slice(0, 7)} · {seller.state ?? '—'} · Response rate {seller.responseRate === null ? '—' : `${Math.round(seller.responseRate * 100)}%`}</p>
      <h2>Active listings</h2>
      <ListingList rows={listings} />
    </>
  )
}
