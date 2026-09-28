import Link from 'next/link'
import type { ListingRow } from '@/lib/data'
import { listingPath } from '@/lib/seo/urls'
import { fmtAud, GradeBadge, LangBadge } from './Format'
import { CardImage } from './ui'

const since = (iso: string | null) => {
  if (!iso) return ''
  const d = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000))
  return d === 0 ? 'today' : `${d}d`
}

/** Marketplace tile (docs/research/06 §4.9): whole tile is a link. */
export function ListingTile({ l, marketAud }: { l: ListingRow; marketAud?: number | null }) {
  const vs = marketAud ? Math.round(((l.priceAud - marketAud) / marketAud) * 100) : null
  return (
    <Link href={listingPath(l.id, l.title)} className="tile">
      <div className="well">
        <CardImage src={l.images[0]?.url} alt={l.images[0]?.alt ?? l.title} name={l.title} />
        <div className="tile-overlay">
          <GradeBadge gradeKey={l.gradeKey} />
          <LangBadge lang={l.lang} />
        </div>
      </div>
      <p className="tile-name">{l.title}</p>
      <p className="num mt-1 text-base font-medium">{fmtAud(l.priceAud)}</p>
      {vs !== null && (
        <p className="text-xs" style={{ color: vs < 0 ? 'var(--up)' : 'var(--ink-muted)' }}>
          {vs < 0 ? `▼ ${Math.abs(vs)}% below market` : vs > 0 ? `${vs}% above market` : 'At market'}
        </p>
      )}
      <p className="muted mt-1 text-xs">
        {l.state} · {l.sellerPremium ? '◆ ' : ''}{l.sellerUsername} · listed {since(l.approvedAt)}
      </p>
    </Link>
  )
}
