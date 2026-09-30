/**
 * eBay deals (ebay_deals): client-safe mapping and display helpers shared by
 * the /deals/ page, the Premium live list and the unit tests.
 */
import type { CardRow, DealRow } from '@/lib/data/types'

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST rows are loosely typed JSON. */

/** Same shape as the repository's deals() select, for the browser's live list. */
export const DEAL_SELECT =
  '*,cards!inner(id,set_id,game,lang,number,printed_total,name,slug,variant,rarity,image_url,psa_spec_id,counterpart_card_id,updated_at,sets!inner(slug,name,code))'

function toCard(r: any): CardRow {
  return {
    id: r.id,
    setId: r.set_id,
    game: r.game,
    lang: r.lang,
    setSlug: r.sets?.slug ?? '',
    setName: r.sets?.name ?? '',
    setCode: r.sets?.code ?? '',
    number: r.number,
    printedTotal: r.printed_total ?? null,
    name: r.name,
    slug: r.slug,
    variant: r.variant,
    rarity: r.rarity ?? null,
    imageUrl: r.image_url ?? null,
    psaSpecId: r.psa_spec_id ?? null,
    counterpartCardId: r.counterpart_card_id ?? null,
    externalIds: [],
    updatedAt: r.updated_at ?? null,
  }
}

export function toDeal(r: any): DealRow {
  const num = (v: any) => (v === null || v === undefined ? null : Number(v))
  return {
    id: r.id,
    itemId: r.item_id,
    card: toCard(r.cards),
    gradeKey: r.grade_key,
    title: r.title,
    buyingOption: r.buying_option,
    priceAud: Number(r.price_aud),
    shippingAud: num(r.shipping_aud),
    marketAud: Number(r.market_aud),
    discountPct: Number(r.discount_pct),
    bidCount: r.bid_count ?? null,
    endTime: r.end_time ?? null,
    url: r.url,
    imageUrl: r.image_url ?? null,
    foundAt: r.found_at,
    goneAt: r.gone_at ?? null,
  }
}

/** "28% under value" (rounded; never "0% under"). */
export function discountLabel(pct: number): string {
  const n = Math.round(pct)
  return n >= 1 ? `${n}% under value` : 'at market value'
}

/** "ends in 1 h 20 min", "ends in 45 min", "ended". */
export function endsIn(endTime: string | null, now: number = Date.now()): string | null {
  if (!endTime) return null
  const mins = Math.round((new Date(endTime).getTime() - now) / 60_000)
  if (mins <= 0) return 'ended'
  if (mins < 60) return `ends in ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 48) return `ends in ${h} h${mins % 60 ? ` ${mins % 60} min` : ''}`
  return `ends in ${Math.round(h / 24)} days`
}

/** Hide auctions that have already finished and anything eBay reported gone. */
export function isLive(d: Pick<DealRow, 'buyingOption' | 'endTime' | 'goneAt'>, now: number = Date.now()): boolean {
  if (d.goneAt) return false
  return !(d.buyingOption === 'AUCTION' && d.endTime && new Date(d.endTime).getTime() <= now)
}
