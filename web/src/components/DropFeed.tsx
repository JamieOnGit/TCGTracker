import type { DropRow } from '@/lib/data'
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

/** Drops grouped by day (AEST/AEDT), one calm row per event (docs/research/06 §2.8). */
export function DropFeed({ rows, compact = false }: { rows: DropRow[]; compact?: boolean }) {
  if (rows.length === 0) return <p className="muted py-8">No drops recorded yet. Set an alert and we&apos;ll tell you first.</p>
  const groups = new Map<string, DropRow[]>()
  for (const r of rows) {
    const k = dayFmt.format(new Date(r.occurredAt))
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return (
    <div className="grid gap-8">
      {[...groups].map(([day, items]) => (
        <section key={day} aria-label={day}>
          {!compact && <h3 className="hairline pt-4 text-lg">{day}</h3>}
          <ul className="mt-2">
            {items.map((d) => (
              <li key={d.id} className="grid grid-cols-[56px_1fr_auto] items-center gap-4 border-b py-3" style={{ borderColor: 'var(--line)' }}>
                <time className="num text-sm muted" dateTime={d.occurredAt}>{timeFmt.format(new Date(d.occurredAt))}</time>
                <div className="min-w-0">
                  <a href={d.url} rel="nofollow noopener" target="_blank" className="prose-link font-medium" style={{ textDecorationColor: 'transparent' }}>
                    {d.title}
                  </a>
                  <div className="card-meta">
                    <span>{d.retailerName}</span>
                    {d.game && <span className="tag-quiet">{d.game === 'pokemon' ? 'Pokémon' : 'One Piece'}</span>}
                    <span>{rrpLabel(d)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`badge ${d.eventType === 'IN_STOCK' || d.eventType === 'QUEUE_LIVE' ? 'badge-live' : 'badge-lang'}`}>
                    {d.eventType === 'IN_STOCK' ? '● ' : ''}
                    {EVENT_LABEL[d.eventType]}
                  </span>
                  <div className="num mt-1 text-sm">{fmtAud2(d.priceAud)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
