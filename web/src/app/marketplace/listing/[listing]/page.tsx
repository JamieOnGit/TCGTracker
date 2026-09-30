import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { AntiScam } from '@/components/AntiScam'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { fmtAud, fmtDate, GradeBadge, LangBadge, PremiumBadge } from '@/components/Format'
import { JsonLd } from '@/components/JsonLd'
import { CardImage, Eyebrow } from '@/components/ui'
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
  const card = listing.cardId ? ((await repo.getCardsByIds([listing.cardId]))[0] ?? null) : null
  const grades = card ? await repo.cardGrades(card.id) : []
  const others = card ? (await repo.listingsForCard(card.id, { status: 'active' })).filter((l) => l.id !== listing.id) : []
  return { parsed, listing, card, grades, others, rules: await repo.getRules() }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).listing)
  if (!data) return {}
  const { listing } = data
  return buildMetadata({
    path: listingPath(listing.id, listing.title),
    title: titles.listing({ title: listing.status === 'sold' ? `Sold: ${listing.title}` : listing.title, state: listing.state }),
    description: `${listing.title} ${listing.status === 'sold' ? 'sold' : 'for sale'} for ${fmtAud(listing.priceAud)} in ${listing.state}, Australia. ${listing.certVerified ? 'PSA cert verified. ' : ''}Message the seller on TCGTracker.`,
    noindex: !['active', 'sold', 'expired'].includes(listing.status),
  })
}

export default async function ListingPage({ params }: Props) {
  const data = await load((await params).listing)
  if (!data) notFound()
  const { listing, card, rules, parsed, grades, others } = data
  const canonical = listingPath(listing.id, listing.title)
  if (`/marketplace/listing/${parsed.id}-${parsed.slug}/` !== canonical) permanentRedirect(canonical)
  const outcome = listingPageOutcome({
    status: listing.status,
    closedAt: listing.closedAt ? new Date(listing.closedAt) : null,
    now: new Date(),
    soldVisibleDays: rules.soldVisibleDays,
    cardMarketplacePath: card ? cardMarketplacePath(card) : '/marketplace/',
    viewerIsOwner: false,
  })
  if (outcome.kind === 'redirect') permanentRedirect(outcome.to)
  if (outcome.kind !== 'render') notFound()

  const closed = listing.status === 'sold' || listing.status === 'expired'
  const market = grades.find((g) => g.gradeKey === listing.gradeKey)?.floorAud ?? null
  const vs = market ? Math.round(((listing.priceAud - market) / market) * 100) : null
  const [hero, ...thumbs] = listing.images

  return (
    <div className="container-x">
      <div className="pt-6">
        <Breadcrumbs items={[{ name: 'Marketplace', path: '/marketplace/' }, ...(card ? [{ name: `${card.name} #${card.number}`, path: cardMarketplacePath(card) }] : []), { name: listing.title, path: canonical }]} />
      </div>
      <section className="grid gap-10 pt-8 lg:grid-cols-2 lg:gap-16">
        <div>
          <div className="well" style={{ padding: 32 }}>
            {hero ? (
              <Image src={hero.url} alt={hero.alt} width={630} height={880} sizes="(max-width: 1024px) 100vw, 600px" priority className="thumb w-full" style={{ border: 0 }} />
            ) : (
              <div className="w-full max-w-[320px]"><CardImage src={null} alt={listing.title} name={card?.name ?? listing.title} /></div>
            )}
          </div>
          {thumbs.length > 0 && (
            <ul className="mt-3 grid grid-cols-4 gap-3">
              {thumbs.map((img) => (
                <li key={img.url} className="well" style={{ padding: 8 }}><Image src={img.url} alt={img.alt} width={150} height={210} className="thumb w-full" style={{ border: 0 }} /></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          {card && <Eyebrow>{card.setName} · #{card.number}</Eyebrow>}
          <h1 className="mt-3">{closed ? `${listing.status === 'sold' ? 'Sold' : 'Expired'}: ` : ''}{card?.name ?? listing.title}</h1>
          <div className="mt-4 flex flex-wrap gap-2"><GradeBadge gradeKey={listing.gradeKey} /><LangBadge lang={listing.lang} /></div>
          <p className="num mt-6" style={{ fontSize: 'var(--text-3xl)', fontWeight: 300 }}>{fmtAud(listing.priceAud)}</p>
          {vs !== null && (
            <p className="mt-1 text-sm" style={{ color: vs < 0 ? 'var(--up)' : 'var(--ink-muted)' }}>
              Market value {fmtAud(market)} · this listing {vs === 0 ? 'at market' : vs < 0 ? `${Math.abs(vs)}% below` : `${vs}% above`}
            </p>
          )}
          {closed && card ? (
            <p className="mt-6">This listing is closed. <Link href={cardMarketplacePath(card)} className="prose-link">See current listings for this card</Link>.</p>
          ) : (
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/messages/new/?listing=${listing.id}`} className="btn btn-primary" rel="nofollow">Message seller</Link>
              {card && <Link href={`/account/alerts/new/?card=${card.id}&grade=${listing.gradeKey}`} className="btn btn-secondary" rel="nofollow">Watch this card</Link>}
            </div>
          )}

          <dl className="dl-rows mt-10">
            <dt>Title</dt><dd>{listing.title}</dd>
            {listing.certNumber && (<><dt>Cert</dt><dd>{listing.certNumber} · {listing.certVerified ? '✓ verified against PSA' : 'awaiting verification'}</dd></>)}
            {listing.condition && (<><dt>Condition</dt><dd>{listing.condition}</dd></>)}
            <dt>Quantity</dt><dd>{listing.qty}</dd>
            <dt>Location</dt><dd>{listing.state}, Australia</dd>
            <dt>Listed</dt><dd>{fmtDate(listing.approvedAt)}</dd>
          </dl>
          {listing.description && <p className="mt-6 whitespace-pre-line text-sm">{listing.description}</p>}

          <section aria-label="Seller" className="mt-10 border-t pt-6" style={{ borderColor: 'var(--line)' }}>
            <p className="eyebrow">Seller</p>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <Link href={sellerPath(listing.sellerUsername)} className="prose-link">{listing.sellerUsername}</Link>
              {listing.sellerPremium && <PremiumBadge />}
              <span className="muted text-sm">member since {fmtDate(listing.sellerSince)}</span>
            </p>
            <p className="mt-3 text-xs"><Link href={`/report/?listing=${listing.id}`} rel="nofollow" className="prose-link muted">Report this listing</Link></p>
          </section>
          <div className="mt-8"><AntiScam /></div>
        </div>
      </section>

      {card && (
        <section className="section" aria-labelledby="more-h">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="more-h">Other listings of this card</h2>
            <Link href={cardPath(card)} className="btn-ghost text-sm">Price history</Link>
          </div>
          {others.length === 0 ? <p className="muted mt-4 text-sm">No other copies listed right now.</p> : (
            <ul className="mt-4">
              {others.slice(0, 8).map((o) => (
                <li key={o.id} className="flex justify-between border-b py-3 text-sm" style={{ borderColor: 'var(--line)' }}>
                  <Link href={listingPath(o.id, o.title)} className="prose-link">{o.title}</Link>
                  <span className="num">{fmtAud(o.priceAud)} · {o.state}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <JsonLd data={listingProduct({ name: listing.title, path: canonical, priceAud: listing.priceAud, sold: closed, sellerName: listing.sellerUsername, image: hero?.url ?? null, condition: listing.listingType === 'sealed' ? 'new' : 'used' })} />
    </div>
  )
}
