import Link from 'next/link'
import { isInStock } from '@/lib/data/drops'
import type { SealedProductRow } from '@/lib/data/types'
import { absoluteTime, lowestLivePrice, monogram, productTypeLabel, relativeTime, rrpDeltaLabel, stockLine } from '@/lib/domain/stock'
import { GAME_NAMES, productPath } from '@/lib/seo/urls'
import { LangBadge, fmtAud2 } from './Format'
import { NotifyButton } from './NotifyButton'

/**
 * A sealed product in a stock list: lowest live price against RRP, where it is
 * in stock (store chips link out to the store), last change and Notify me.
 * Store photos only when `stock.show_retailer_images` is on; otherwise the
 * typographic placeholder.
 */
export function ProductCard({ p, showImages = false, headingLevel = 3 }: { p: SealedProductRow; showImages?: boolean; headingLevel?: 2 | 3 }) {
  const live = p.offers.filter((o) => isInStock(o.availability) || o.availability === 'preorder')
  const low = lowestLivePrice(p)
  const delta = rrpDeltaLabel(low, p.rrpAud)
  const image = showImages ? p.offers.find((o) => o.imageUrl)?.imageUrl ?? null : null
  const H = headingLevel === 2 ? 'h2' : 'h3'
  const path = productPath(p)
  return (
    <article className="grid content-start gap-3 border-t pt-4" style={{ borderColor: 'var(--line)' }} data-product={p.slug} aria-labelledby={`p-${p.id}`}>
      <Link href={path} tabIndex={-1} aria-hidden="true" className="block">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- store product photos, shown only when the setting allows it
          <img src={image} alt="" className="thumb w-full" style={{ aspectRatio: '4 / 3' }} loading="lazy" decoding="async" />
        ) : (
          <div className="card-placeholder" style={{ aspectRatio: '4 / 3', padding: '8%' }}>{productTypeLabel(p.type)}</div>
        )}
      </Link>
      <div>
        <p className="muted flex flex-wrap items-center gap-2 text-xs">
          <span className="tag-quiet">{GAME_NAMES[p.game]}</span>
          <span>{productTypeLabel(p.type)}</span>
          <LangBadge lang={p.lang} />
        </p>
        <H id={`p-${p.id}`} className="mt-1 text-lg">
          <Link href={path} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{p.name}</Link>
        </H>
      </div>
      <p className="text-sm">
        {low !== null ? <><span className="muted">from </span><span className="num text-lg">{fmtAud2(low)}</span></> : <span className="muted">Price not listed</span>}
        {delta && <span className="muted"> · {delta}</span>}
        {p.rrpAud !== null && <span className="muted block text-xs">RRP {fmtAud2(p.rrpAud)}</span>}
      </p>
      <p className="text-sm">{live.length > 0 && <span className="mr-1" style={{ color: 'var(--live)' }} aria-hidden="true">●</span>}{stockLine(p)}</p>
      {live.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Stores with ${p.name}`}>
          {live.map((o) => (
            <li key={o.retailerSlug + o.url}>
              <a href={o.url} rel="nofollow noopener" target="_blank" className="chip-filter tap" title={`${o.retailerName}: ${o.availability === 'preorder' ? 'pre-order' : 'in stock'}`}>
                <span className="mono" aria-hidden="true">{monogram(o.retailerName)}</span>
                {o.retailerName}
                {o.priceAud !== null && <span className="count num">{fmtAud2(o.priceAud)}</span>}
                {o.availability === 'preorder' && <span className="count">pre-order</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {p.updatedAt ? <span className="muted text-xs">Changed <time dateTime={p.updatedAt} title={absoluteTime(p.updatedAt)}>{relativeTime(p.updatedAt)}</time></span> : <span />}
        <NotifyButton productId={p.id} productName={p.name} nextPath={path} />
      </div>
    </article>
  )
}
