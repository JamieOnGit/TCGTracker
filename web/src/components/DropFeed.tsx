import type { DropRow } from '@/lib/data/types'
import { confirmationsLabel, purchaseLimitLabel, QUANTITY_LABEL, sightingPlace } from '@/lib/domain/drops'
import { GAME_NAMES } from '@/lib/seo/urls'
import { fmtAud2 } from './Format'

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
 * One calm row per event. Monitor events link to the retailer page; member
 * sightings show where, how many, the limit and how many members confirmed
 * it. In-store sightings have no outbound link.
 */
export function DropItem({ d, withDay = false }: { d: DropRow; withDay?: boolean }) {
  const s = d.sighting
  const gone = Boolean(s?.goneAt)
  const place = s ? sightingPlace(d.retailerName, s) : null
  const facts = s ? [s.quantity ? QUANTITY_LABEL[s.quantity] : null, purchaseLimitLabel(s.purchaseLimit), confirmationsLabel(s.confirmations)].filter((f): f is string => Boolean(f)) : []
  return (
    <li className="grid grid-cols-[56px_1fr_auto] items-start gap-3 border-b py-3 sm:gap-4" style={{ borderColor: 'var(--line)' }} data-source={d.source} data-gone={gone || undefined}>
      <time className="num pt-0.5 text-sm muted" dateTime={d.occurredAt}>{(withDay ? dayTimeFmt : timeFmt).format(new Date(d.occurredAt))}</time>
      <div className="flex min-w-0 gap-3">
        <div className="min-w-0 flex-1">
          {d.url ? (
            <a href={d.url} rel="nofollow noopener" target="_blank" className="prose-link font-medium" style={{ textDecorationColor: 'transparent' }}>
              {d.title}
            </a>
          ) : (
            <span className={`font-medium${gone ? ' muted' : ''}`}>{d.title}</span>
          )}
          <div className="card-meta">
            {s ? (
              <>
                <span className="badge badge-lang">{s.channel === 'in_store' ? 'In store' : 'Online'} · Member sighting</span>
                <span>{place}</span>
                {s.storeName && <span>{s.storeName}</span>}
              </>
            ) : (
              <span>{d.retailerName}</span>
            )}
            {d.game && <span className="tag-quiet">{GAME_NAMES[d.game]}</span>}
            <span>{rrpLabel(d)}</span>
          </div>
          {facts.length > 0 && <div className="card-meta">{facts.map((f) => <span key={f}>{f}</span>)}</div>}
          {s?.note && <p className="muted mt-1 text-sm">&ldquo;{s.note}&rdquo;</p>}
        </div>
        {s?.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- member photos live in Supabase Storage; a small lazy thumbnail
          <img src={s.photoUrl} alt={`Member photo of ${d.title} at ${place}`} width={56} height={56} loading="lazy" decoding="async" className="thumb shrink-0 object-cover" style={{ width: 56, height: 56 }} />
        )}
      </div>
      <div className="text-right">
        {gone ? (
          <span className="badge badge-warn">Reported sold out</span>
        ) : (
          <span className={`badge ${d.eventType === 'IN_STOCK' || d.eventType === 'QUEUE_LIVE' ? 'badge-live' : 'badge-lang'}`}>
            {d.eventType === 'IN_STOCK' ? '● ' : ''}
            {EVENT_LABEL[d.eventType]}
          </span>
        )}
        <div className="num mt-1 text-sm">{fmtAud2(d.priceAud)}</div>
      </div>
    </li>
  )
}

/**
 * Drops grouped by day (AEST/AEDT), one calm row per event (docs/research/06
 * §2.8). `compact` is a flat list with the day in each timestamp.
 */
export function DropFeed({ rows, compact = false, empty }: { rows: DropRow[]; compact?: boolean; empty?: string }) {
  if (rows.length === 0) return <p className="muted py-8">{empty ?? 'No drops recorded yet. Set an alert and we’ll tell you first.'}</p>
  if (compact) return <ul className="mt-2">{rows.map((d) => <DropItem key={d.id} d={d} withDay />)}</ul>
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
          <ul className="mt-2">{items.map((d) => <DropItem key={d.id} d={d} />)}</ul>
        </section>
      ))}
    </div>
  )
}
