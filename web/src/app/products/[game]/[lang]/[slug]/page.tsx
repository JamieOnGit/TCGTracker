import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { Faq } from '@/components/DropsCopy'
import { fmtAud2, fmtDate } from '@/components/Format'
import { JsonLd } from '@/components/JsonLd'
import { NotifyButton } from '@/components/NotifyButton'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { isInStock } from '@/lib/data/drops'
import type { OfferRow, SealedProductRow } from '@/lib/data/types'
import {
  absoluteTime,
  AVAILABILITY_LABEL,
  availabilityBadgeClass,
  monogram,
  productDescription,
  productFaqs,
  productHeading,
  productSummary,
  productTitle,
  productTypeLabel,
  relativeTime,
  rrpDeltaLabel,
  schemaAvailability,
} from '@/lib/domain/stock'
import { sealedProductLd } from '@/lib/seo/jsonld'
import { buildMetadata } from '@/lib/seo/metadata'
import { dropsPath, GAME_NAMES, inStockPath, isGame, isLang, LANG_NAMES, productPath, productsPath, releasePath, setPath } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { params: Promise<{ game: string; lang: string; slug: string }> }

const BRAND = { pokemon: 'Pokémon TCG', 'one-piece': 'One Piece Card Game' } as const

const load = cache(async (game: string, lang: string, slug: string) => (isGame(game) && isLang(lang) ? getRepo().getSealedProduct(game, lang, slug) : null))

// A product no store lists yet is thin: noindex,follow (and left out of the sitemap).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game, lang, slug } = await params
  const p = await load(game, lang, slug)
  if (!p) return {}
  return buildMetadata({ path: productPath(p), title: productTitle(p), description: productDescription(p), noindex: p.offers.length === 0 })
}

export default async function ProductPage({ params }: Props) {
  const { game, lang, slug } = await params
  const p = await load(game, lang, slug)
  if (!p) notFound()
  const repo = getRepo()
  const path = productPath(p)
  const [watchers, activity, releases, rules] = await Promise.all([repo.productWatchCount(p.id), repo.productDrops(p.id, 20), repo.releases({ game: p.game }), repo.getRules()])
  // The release calendar entry for this product's set, when we have one.
  const release = p.set ? releases.find((r) => r.set && r.set.slug === p.set!.slug && r.lang === p.lang) ?? null : null
  const image = rules.stockShowRetailerImages ? p.offers.find((o) => o.imageUrl)?.imageUrl ?? null : null
  const faqs = productFaqs(p)
  const heading = productHeading(p)

  return (
    <div className="container-x">
      <div className="pt-6">
        <Breadcrumbs items={[{ name: 'Products', path: productsPath() }, { name: GAME_NAMES[p.game], path: productsPath(p.game) }, { name: p.name, path }]} />
      </div>
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
        <PageIntro eyebrow={`${GAME_NAMES[p.game]} TCG · ${productTypeLabel(p.type)} · ${LANG_NAMES[p.lang]}`} title={heading} lead={`${productSummary(p)}.`}>
          <div className="mt-6">
            <NotifyButton productId={p.id} productName={p.name} nextPath={path} watchers={watchers} size="md" />
            <p className="muted mt-2 max-w-[var(--measure)] text-xs">Notify me alerts you when this product is back in stock, opens for pre-order or drops in price at any store we watch: instantly with Premium, 5 minutes later on Free.</p>
          </div>
        </PageIntro>
        <div className="hidden md:block md:pt-16">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- store product photo, shown only when the setting allows it
            <img src={image} alt={heading} className="thumb w-full" style={{ aspectRatio: '1 / 1' }} />
          ) : (
            <div className="card-placeholder" style={{ aspectRatio: '1 / 1' }} role="img" aria-label={`${heading} (image coming soon)`}>{productTypeLabel(p.type)}</div>
          )}
        </div>
      </div>

      <section className="section-tight" aria-labelledby="where-h">
        <h2 id="where-h">Where to buy {p.name} in Australia</h2>
        {p.offers.length === 0 ? (
          <p className="muted mt-3 text-sm">No store we watch lists this product yet. Tap Notify me and we’ll alert you when one does.</p>
        ) : (
          <StoreTable offers={p.offers} rrpAud={p.rrpAud} name={p.name} />
        )}
        <p className="muted mt-2 text-xs">Prices in AUD as each store lists them; check the store for postage and limits. Store links open the store&apos;s own page.</p>
      </section>

      <section className="section-tight" aria-labelledby="about-h">
        <h2 id="about-h">About this product</h2>
        <dl className="dl-rows mt-4 max-w-[var(--measure)]">
          <dt>Product</dt>
          <dd>{productTypeLabel(p.type)}</dd>
          <dt>Language</dt>
          <dd>{LANG_NAMES[p.lang]} ({p.lang.toUpperCase()})</dd>
          <dt>RRP in Australia</dt>
          <dd>{p.rrpAud !== null ? fmtAud2(p.rrpAud) : 'Not known yet'}</dd>
          {p.releaseDate && (
            <>
              <dt>Released</dt>
              <dd><time dateTime={p.releaseDate}>{fmtDate(p.releaseDate)}</time></dd>
            </>
          )}
          {p.set && (
            <>
              <dt>Set</dt>
              <dd><Link href={setPath({ game: p.game, lang: p.lang, slug: p.set.slug })} className="prose-link">{p.set.name} card list &amp; prices</Link></dd>
            </>
          )}
          {release && (
            <>
              <dt>Release</dt>
              <dd><Link href={releasePath(release.game, release.slug)} className="prose-link">{release.title} release date</Link></dd>
            </>
          )}
        </dl>
        <div className="prose mt-6 max-w-[var(--measure)]">
          <p>{blurb(p)}</p>
        </div>
      </section>

      <section className="section-tight" aria-labelledby="act-h">
        <h2 id="act-h">Recent activity</h2>
        <DropFeed rows={activity} compact empty="No restocks, pre-orders or price drops recorded for this product yet." />
      </section>

      <Faq faqs={faqs} title={`${p.name} questions`} />

      <section className="section-tight pb-16">
        <p className="flex flex-wrap gap-4 text-sm">
          <Link href={inStockPath()} className="prose-link">Everything in stock now</Link>
          <Link href={productsPath(p.game)} className="prose-link">All {GAME_NAMES[p.game]} products</Link>
          <Link href={dropsPath()} className="prose-link">Stock activity feed</Link>
        </p>
        {repo.isDemo && <p className="provenance">Preview data.</p>}
      </section>

      <JsonLd
        data={sealedProductLd({
          name: heading,
          path,
          brand: BRAND[p.game],
          category: productTypeLabel(p.type),
          image,
          offers: p.offers.map((o) => ({ seller: o.retailerName, url: o.url, priceAud: o.priceAud, availability: schemaAvailability(o.availability) })),
        })}
      />
    </div>
  )
}

/** Store-by-store availability, in stock first then cheapest (sortOffers). */
function StoreTable({ offers, rrpAud, name }: { offers: OfferRow[]; rrpAud: number | null; name: string }) {
  return (
    <div className="table-wrap mt-4">
      <table className="dt">
        <caption className="sr-only">Availability and price of {name} at each Australian store we watch</caption>
        <thead>
          <tr>
            <th scope="col">Store</th><th scope="col">Status</th><th scope="col" className="num">Price</th><th scope="col" className="hide-sm">vs RRP</th>
            <th scope="col" className="hide-sm">Last changed</th><th scope="col"><span className="sr-only">Link</span></th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => (
            <tr key={o.retailerSlug + o.url} data-availability={o.availability}>
              <th scope="row">
                <span className="inline-flex items-center gap-2">
                  <span className="mono" aria-hidden="true">{monogram(o.retailerName)}</span>
                  <Link href={dropsPath(o.retailerSlug)} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{o.retailerName}</Link>
                </span>
              </th>
              <td><span className={`badge ${availabilityBadgeClass(o.availability)}`}>{AVAILABILITY_LABEL[o.availability]}</span></td>
              <td className="num">{fmtAud2(o.priceAud)}</td>
              <td className="hide-sm">{rrpDeltaLabel(o.priceAud, rrpAud) ?? '—'}</td>
              <td className="hide-sm">{o.lastChangeAt ? <time dateTime={o.lastChangeAt} title={absoluteTime(o.lastChangeAt)}>{relativeTime(o.lastChangeAt)}</time> : '—'}</td>
              <td>
                <a href={o.url} rel="nofollow noopener" target="_blank" className="btn btn-secondary btn-sm">
                  <span className="sm:hidden">View</span><span className="hidden sm:inline">View at store</span><span className="sr-only"> at {o.retailerName} (opens in a new tab)</span>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Short evergreen copy from the data only: what it is, who lists it, RRP, when it last changed. */
function blurb(p: SealedProductRow): string {
  const live = p.offers.filter((o) => isInStock(o.availability) || o.availability === 'preorder').length
  const parts = [
    `${productHeading(p)} is a ${GAME_NAMES[p.game]} TCG ${p.type === 'etb' ? productTypeLabel(p.type) : productTypeLabel(p.type).toLowerCase()}${p.set ? ` from ${p.set.name}` : ''}.`,
    p.offers.length > 0
      ? `We watch ${p.offers.length} Australian ${p.offers.length === 1 ? 'store' : 'stores'} that list it; ${live === 0 ? 'none has it right now' : `${live} ${live === 1 ? 'has' : 'have'} it in stock or on pre-order`}.`
      : 'No store we watch lists it yet.',
    p.rrpAud !== null ? `Its Australian RRP is ${fmtAud2(p.rrpAud)}, so every price above is tagged against it.` : null,
    p.updatedAt ? `Last change seen ${fmtDate(p.updatedAt)}.` : null,
  ]
  return parts.filter(Boolean).join(' ')
}
