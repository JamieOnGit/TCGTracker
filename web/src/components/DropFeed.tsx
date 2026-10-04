import Link from 'next/link'
import type { DropRow } from '@/lib/data/types'
import { confirmationsLabel, purchaseLimitLabel, QUANTITY_LABEL, sightingPlace } from '@/lib/domain/drops'
import { absoluteTime, dropStatus, relativeTime, STATUS_BADGE_CLASS } from '@/lib/domain/stock'
import { dropsPath, GAME_NAMES, productPath } from '@/lib/seo/urls'
import { fmtAud2 } from './Format'
import { NotifyButton } from './NotifyButton'
import { RetailerMark } from '@/components/RetailerMark'
import { CheckoutButton } from './CheckoutButton'
import { dropCheckoutUrl } from '@/lib/data/drops'

export const EVENT_LABEL: Record<DropRow['eventType'], string> = {
  NEW_LISTING: 'New listing',
  PREORDER_OPEN: 'Pre-order open',
  IN_STOCK: 'In stock',
  PRICE_CHANGE: 'Price change',
  QUEUE_LIVE: 'Queue live',
}

export function rrpLabel(d: Pick<DropRow, 'rrpTag' | 'rrpDeltaPct'>) {
  if (d.rrpTag === 'AT_RRP') return 'At RRP'
  if (d.rrpTag === 'BELOW_RRP') return `Below RRP${d.rrpDeltaPct !== null ? ` (${d.rrpDeltaPct}%)` : ''}`
  if (d.rrpTag === 'ABOVE_RRP') return `Above RRP (+${d.rrpDeltaPct}%)`
  return 'RRP unknown'
}

const dayFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Australia/Melbourne' })
const timeFmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' })
const dayTimeFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' })

/**
 * One calm row per event: status badge, the product (its product page when
 * the event is matched to one, else the store's page), the store, price
 * against RRP, when, and Notify me. Member sightings add where, how many, the
 * limit and confirmations; in-store sightings have no outbound link.
 */
const CHECKOUT_FRESH_MS = 6 * 3_600_000

export function DropItem({ d, withDay = false, now }: { d: DropRow; withDay?: boolean; now?: Date }) {
  const s = d.sighting
  const gone = Boolean(s?.goneAt)
  const place = s ? sightingPlace(d.retailerName, s) : null
  const status = dropStatus(d)
  const facts = s ? [s.quantity ? QUANTITY_LABEL[s.quantity] : null, purchaseLimitLabel(s.purchaseLimit), confirmationsLabel(s.confirmations)].filter((f): f is string => Boolean(f)) : []
  const wasPrice = status.key === 'price-drop' ? d.previousPriceAud : null
  // A checkout link only while the drop is fresh: older stock has likely sold out.
  const checkout = (now ?? new Date()).getTime() - new Date(d.occurredAt).getTime() < CHECKOUT_FRESH_MS ? dropCheckoutUrl(d) : null
  return (
    <li className="grid grid-cols-[60px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-b py-4 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:gap-x-4" style={{ borderColor: 'var(--line)' }} data-source={d.source} data-status={status.key} data-gone={gone || undefined}>
      <div className="pt-0.5 text-sm">
        <time className="num block" dateTime={d.occurredAt} title={absoluteTime(d.occurredAt)}>{relativeTime(d.occurredAt, now)}</time>
        <span className="num muted block text-xs" aria-hidden="true">{(withDay ? dayTimeFmt : timeFmt).format(new Date(d.occurredAt))}</span>
      </div>
      <div className="flex min-w-0 gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {gone ? <span className="badge badge-warn">Reported sold out</span> : <span className={`badge ${STATUS_BADGE_CLASS[status.key]}`}>{status.key === 'restock' ? '● ' : ''}{status.label}</span>}
            {s && <span className="badge badge-lang">Member sighting</span>}
            {d.game && <span className="tag-quiet">{GAME_NAMES[d.game]}</span>}
          </div>
          <p className="mt-1.5">
            {d.product ? (
              <Link href={productPath(d.product)} className={`prose-link font-medium${gone ? ' muted' : ''}`} style={{ textDecorationColor: 'transparent' }}>{d.product.name}</Link>
            ) : d.url ? (
              <a href={d.url} rel="nofollow noopener" target="_blank" className="prose-link font-medium" style={{ textDecorationColor: 'transparent' }}>{d.title}</a>
            ) : (
              <span className={`font-medium${gone ? ' muted' : ''}`}>{d.title}</span>
            )}
          </p>
          <div className="card-meta items-center">
            <span className="inline-flex items-center gap-1.5">
              <RetailerMark slug={d.retailerSlug} name={d.retailerName} />
              {d.retailerSlug ? <Link href={dropsPath(d.retailerSlug)} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{s ? place : d.retailerName}</Link> : <span>{s ? place : d.retailerName}</span>}
            </span>
            {s?.storeName && <span>{s.storeName}</span>}
            {d.product && d.url && <a href={d.url} rel="nofollow noopener" target="_blank" className="prose-link">View at store<span className="sr-only"> (opens {d.retailerName})</span></a>}
            {checkout && <CheckoutButton href={checkout} store={d.retailerName} title={d.title} compact />}
          </div>
          {facts.length > 0 && <div className="card-meta">{facts.map((f) => <span key={f}>{f}</span>)}</div>}
          {s?.note && <p className="muted mt-1 text-sm">&ldquo;{s.note}&rdquo;</p>}
        </div>
        {s?.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- member photos live in Supabase Storage; a small lazy thumbnail
          <img src={s.photoUrl} alt={`Member photo of ${d.title} at ${place}`} width={56} height={56} loading="lazy" decoding="async" className="thumb shrink-0 object-cover" style={{ width: 56, height: 56 }} />
        )}
      </div>
      <div className="col-start-2 flex flex-wrap items-center justify-between gap-3 sm:col-start-3 sm:block sm:text-right">
        <div>
          <span className="num">{fmtAud2(d.priceAud)}</span>
          {wasPrice !== null && <s className="num muted ml-2 text-xs" aria-label={`was ${fmtAud2(wasPrice)}`}>{fmtAud2(wasPrice)}</s>}
          <div className="muted text-xs">{rrpLabel(d)}</div>
        </div>
        {d.product && !gone && (
          <div className="sm:mt-2">
            <NotifyButton productId={d.product.id} productName={d.product.name} nextPath={productPath(d.product)} />
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * Drops grouped by day (AEST/AEDT), one calm row per event (docs/research/06
 * §2.8). `compact` is a flat list with the day in each timestamp.
 */
export function DropFeed({ rows, compact = false, empty, now }: { rows: DropRow[]; compact?: boolean; empty?: string; now?: Date }) {
  if (rows.length === 0) return <p className="muted py-8">{empty ?? 'No drops recorded yet. Set an alert and we’ll tell you first.'}</p>
  if (compact) return <ul className="mt-2">{rows.map((d) => <DropItem key={d.id} d={d} withDay now={now} />)}</ul>
  const groups = new Map<string, DropRow[]>()
  for (const r of rows) {
    const k = dayFmt.format(new Date(r.occurredAt))
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return (
    <div className="grid gap-8">
      {[...groups].map(([day, items]) => (
        <section key={day} aria-label={day}>
          <h3 className="hairline pt-4 text-lg">{day}</h3>
          <ul className="mt-2">{items.map((d) => <DropItem key={d.id} d={d} now={now} />)}</ul>
        </section>
      ))}
    </div>
  )
}
