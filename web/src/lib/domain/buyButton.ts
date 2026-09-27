/**
 * Buy button logic on the market cap table and card pages (brief 3.2):
 *
 * 1. One or more ACTIVE, APPROVED listings for this exact card (and grade,
 *    when a grade is selected) -> link to our marketplace listings for the
 *    card, sorted by lowest price.
 * 2. None -> "No listings yet" with Set alert + Sell yours (prefilled).
 * 3. Optional external fallback (affiliate) behind a feature flag, off by
 *    default.
 */
import { cardMarketplacePath, sellPath, type CardRef } from '@/lib/seo/urls'

export interface ListingStats {
  cardId: string
  gradeKey: string
  activeCount: number
  lowestPriceAud: number | null
}

export type BuyButton =
  | { kind: 'listings'; href: string; label: string; count: number; fromAud: number }
  | {
      kind: 'none'
      label: 'No listings yet'
      setAlertHref: string
      sellHref: string
      external?: { href: string; label: string }
    }

export function resolveBuyButton(opts: {
  card: CardRef
  gradeKey: string | null // null = "All grades"
  stats: ListingStats[]
  externalFallback: boolean
  externalUrl?: string | null
}): BuyButton {
  const { card, gradeKey, stats } = opts
  const relevant = stats.filter(
    (s) => s.cardId === card.id && (gradeKey === null || s.gradeKey === gradeKey) && s.activeCount > 0,
  )
  const count = relevant.reduce((n, s) => n + s.activeCount, 0)
  if (count > 0) {
    const fromAud = Math.min(...relevant.map((s) => s.lowestPriceAud ?? Number.POSITIVE_INFINITY))
    const params = new URLSearchParams({ sort: 'price-asc' })
    if (gradeKey) params.set('grade', gradeKey)
    return {
      kind: 'listings',
      href: `${cardMarketplacePath(card)}?${params.toString()}`,
      label: `Buy · ${count} from ${new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(fromAud)}`,
      count,
      fromAud,
    }
  }
  const alertParams = new URLSearchParams({ card: card.id })
  if (gradeKey) alertParams.set('grade', gradeKey)
  const out: BuyButton = {
    kind: 'none',
    label: 'No listings yet',
    setAlertHref: `/account/alerts/new/?${alertParams.toString()}`,
    sellHref: sellPath({ cardId: card.id, gradeKey }),
  }
  if (opts.externalFallback && opts.externalUrl) {
    out.external = { href: opts.externalUrl, label: 'Check eBay' }
  }
  return out
}
