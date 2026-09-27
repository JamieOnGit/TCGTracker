import type { DropRow } from '@/lib/data'
import { fmtAud } from './Format'

const EVENT_LABEL: Record<DropRow['eventType'], string> = {
  NEW_LISTING: 'New listing',
  PREORDER_OPEN: 'Pre-order open',
  IN_STOCK: 'In stock',
  PRICE_CHANGE: 'Price change',
  QUEUE_LIVE: 'Queue live',
}

function rrp(d: DropRow) {
  if (d.rrpTag === 'AT_RRP') return 'AT RRP'
  if (d.rrpTag === 'BELOW_RRP') return 'BELOW RRP'
  if (d.rrpTag === 'ABOVE_RRP') return `ABOVE RRP (+${d.rrpDeltaPct}%)`
  return 'RRP unknown'
}

export function DropFeed({ rows }: { rows: DropRow[] }) {
  if (rows.length === 0) return <p>No drops recorded yet.</p>
  return (
    <table>
      <caption>Retail drops (times in AEST/AEDT)</caption>
      <thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">Product</th><th scope="col">Retailer</th><th scope="col">Price</th><th scope="col">RRP</th></tr></thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id}>
            <td><time dateTime={d.occurredAt}>{new Date(d.occurredAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short' })}</time></td>
            <td>{EVENT_LABEL[d.eventType]}</td>
            <th scope="row"><a href={d.url} rel="nofollow noopener" target="_blank">{d.title}</a></th>
            <td>{d.retailerName}</td>
            <td>{fmtAud(d.priceAud)}</td>
            <td>{rrp(d)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
