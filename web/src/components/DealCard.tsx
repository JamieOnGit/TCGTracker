import Link from 'next/link'
import { fmtAud, fmtAud2, GradeBadge, LangBadge } from '@/components/Format'
import { CardImage } from '@/components/ui'
import type { DealRow } from '@/lib/data/types'
import { discountLabel, endsIn } from '@/lib/domain/deals'
import { EBAY_DISCLOSURE } from '@/lib/domain/ebay'
import { cardPath } from '@/lib/seo/urls'

const endFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne', timeZoneName: 'short' })

/**
 * One eBay deal. `live` shows a countdown for auctions (the Premium list
 * re-renders); the cached public page shows the absolute end time instead.
 */
export function DealCard({ deal, live = false }: { deal: DealRow; live?: boolean }) {
  const c = deal.card
  const auction = deal.buyingOption === 'AUCTION'
  return (
    <article className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 border-b py-5 sm:grid-cols-[96px_minmax(0,1fr)]" style={{ borderColor: 'var(--line)' }} data-deal={deal.id} aria-labelledby={`deal-${deal.id}`}>
      <div>
        <CardImage src={deal.imageUrl ?? c.imageUrl} alt={`${c.name} ${c.number} listing photo`} name={c.name} />
      </div>
      <div className="min-w-0">
        <h3 id={`deal-${deal.id}`} className="text-base font-medium">
          <Link href={cardPath(c)} className="prose-link">{c.name} <span className="num">{c.number}</span></Link>
        </h3>
        <p className="muted mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span>{c.setName}</span>
          <LangBadge lang={c.lang} />
          <GradeBadge gradeKey={deal.gradeKey} />
        </p>
        <p className="mt-3">
          <span className="text-lg num">{fmtAud2(deal.priceAud)}</span>
          <span className="muted text-xs"> {deal.shippingAud ? `+ ${fmtAud2(deal.shippingAud)} postage` : deal.shippingAud === 0 ? 'free postage' : ''}</span>
        </p>
        <p className="mt-1 text-sm">
          <span className="chg chg-chip" data-dir="up">{discountLabel(deal.discountPct)}</span>
          <span className="muted"> · market value {fmtAud(deal.marketAud)}</span>
        </p>
        <p className="muted mt-1 text-xs">
          {auction ? (
            <>
              Auction · {deal.bidCount ?? 0} {deal.bidCount === 1 ? 'bid' : 'bids'}
              {deal.endTime && <> · {live ? endsIn(deal.endTime) : `ends ${endFmt.format(new Date(deal.endTime))}`}</>}
            </>
          ) : 'Buy It Now'}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-3">
          <a href={deal.url} target="_blank" rel="sponsored nofollow noopener" className="btn btn-secondary btn-sm">View on eBay</a>
          <span className="subtle text-xs" title={EBAY_DISCLOSURE}>Ad</span>
        </p>
      </div>
    </article>
  )
}
