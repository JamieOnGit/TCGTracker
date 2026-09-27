import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { fmtAud, gradeLabel, LangBadge } from '@/components/Format'
import { JsonLd } from '@/components/JsonLd'
import { AntiScam } from '@/components/ListingList'
import { getRepo } from '@/lib/data'
import { listingPageOutcome } from '@/lib/domain/listing'
import { listingProduct } from '@/lib/seo/jsonld'
import { buildMetadata, titles } from '@/lib/seo/metadata'
import { cardMarketplacePath, cardPath, listingPath, parseListingSegment, sellerPath } from '@/lib/seo/urls'

export const revalidate = 60
type Props = { params: Promise<{ listing: string }> }

async function load(segment: string) {
  const parsed = parseListingSegment(segment)
  if (!parsed) return null
  const repo = getRepo()
  const listing = await repo.getListing(parsed.id)
  if (!listing) return null
  const card = listing.cardId ? (await repo.getCardsByIds([listing.cardId]))[0] ?? null : null
  return { parsed, listing, card, rules: await repo.getRules() }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).listing)
  if (!data) return {}
  const { listing } = data
  return buildMetadata({
    path: listingPath(listing.id, listing.title),
    title: titles.listing({ title: listing.status === 'sold' ? `SOLD: ${listing.title}` : listing.title, state: listing.state }),
    description: `${listing.title} ${listing.status === 'sold' ? 'sold' : 'for sale'} for ${fmtAud(listing.priceAud)} in ${listing.state}. ${listing.certVerified ? 'PSA cert verified. ' : ''}Message the seller on-site.`,
    noindex: !['active', 'sold', 'expired'].includes(listing.status),
  })
}

export default async function ListingPage({ params }: Props) {
  const data = await load((await params).listing)
  if (!data) notFound()
  const { listing, card, rules, parsed } = data
  const canonical = listingPath(listing.id, listing.title)
  // Wrong or missing slug: the proxy answers 301 first; this is the fallback.
  if (`/marketplace/listing/${parsed.id}-${parsed.slug}/` !== canonical) permanentRedirect(canonical)

  const outcome = listingPageOutcome({
    status: listing.status,
    closedAt: listing.closedAt ? new Date(listing.closedAt) : null,
    now: new Date(),
    soldVisibleDays: rules.soldVisibleDays,
    cardMarketplacePath: card ? cardMarketplacePath(card) : '/marketplace/',
    viewerIsOwner: false, // owner previews are served from /account/listings/
  })
  if (outcome.kind === 'redirect') permanentRedirect(outcome.to)
  if (outcome.kind !== 'render') notFound()

  const closed = listing.status === 'sold' || listing.status === 'expired'
  return (
    <>
      <Breadcrumbs
        items={[
          { name: 'Marketplace', path: '/marketplace/' },
          ...(card ? [{ name: `${card.name} ${card.number} ${card.lang.toUpperCase()}`, path: cardMarketplacePath(card) }] : []),
          { name: listing.title, path: canonical },
        ]}
      />
      <h1>{closed ? `${listing.status === 'sold' ? 'Sold' : 'Expired'}: ` : ''}{listing.title}</h1>
      {closed && card && (
        <p>
          This listing is closed. <Link href={cardMarketplacePath(card)}>See current listings for this card</Link>.
        </p>
      )}
      <p>
        <strong>{fmtAud(listing.priceAud)}</strong> · <LangBadge lang={listing.lang} /> · {gradeLabel(listing.gradeKey)}
        {listing.certNumber && <> · Cert {listing.certNumber} {listing.certVerified ? '(PSA cert verified)' : '(not yet verified)'}</>}
        {' '}· Qty {listing.qty} · {listing.state}
      </p>
      {listing.images.length === 0 ? <p>Photos: front and back (demo listing has none).</p> : (
        <ul>{listing.images.map((img, i) => <li key={img.url}><Image src={img.url} alt={img.alt} width={315} height={440} sizes="(max-width: 640px) 100vw, 315px" priority={i === 0} /></li>)}</ul>
      )}
      <p>{listing.description}</p>
      <section aria-label="Seller">
        <p>
          Seller: <Link href={sellerPath(listing.sellerUsername)}>{listing.sellerUsername}</Link>
          {listing.sellerPremium && <span className="badge"> Premium</span>} · member since {listing.sellerSince.slice(0, 7)}
        </p>
        {!closed && <p><Link href={`/messages/new/?listing=${listing.id}`} rel="nofollow">Message seller</Link></p>}
        <p><Link href={`/report/?listing=${listing.id}`} rel="nofollow">Report listing</Link></p>
      </section>
      <AntiScam />
      {card && <p><Link href={cardPath(card)}>Price history, population &amp; market cap for {card.name}</Link></p>}
      <JsonLd
        data={listingProduct({
          name: listing.title,
          path: canonical,
          priceAud: listing.priceAud,
          sold: closed,
          sellerName: listing.sellerUsername,
          image: listing.images[0]?.url ?? null,
          condition: listing.listingType === 'sealed' ? 'new' : 'used',
        })}
      />
    </>
  )
}
