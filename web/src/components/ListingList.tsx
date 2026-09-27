import Link from 'next/link'
import type { ListingRow } from '@/lib/data'
import { listingPath, sellerPath } from '@/lib/seo/urls'
import { fmtAud, gradeLabel, LangBadge } from './Format'

export function ListingList({ rows }: { rows: ListingRow[] }) {
  if (rows.length === 0) return <p>No listings match.</p>
  return (
    <ul className="listings">
      {rows.map((l) => (
        <li key={l.id}>
          <Link href={listingPath(l.id, l.title)}>{l.title}</Link> <LangBadge lang={l.lang} /> {gradeLabel(l.gradeKey)} ·{' '}
          <strong>{fmtAud(l.priceAud)}</strong> · {l.state} · <Link href={sellerPath(l.sellerUsername)}>{l.sellerUsername}</Link>
          {l.sellerPremium && <span className="badge"> Premium</span>}
        </li>
      ))}
    </ul>
  )
}

export function AntiScam() {
  return (
    <aside aria-label="Stay safe" className="demo-banner">
      <strong>Stay safe:</strong> keep messages on-site. Be wary of sellers asking for PayPal Friends &amp; Family, bank transfer to
      strangers, gift cards or crypto — they carry no buyer protection. Meet in public for local pickup. Report anything suspicious.
    </aside>
  )
}
