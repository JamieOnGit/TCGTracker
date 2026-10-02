import type { Game } from '@/lib/seo/urls'
import type { Availability, DropRow, OfferRow, ReleaseRow, SealedProductRow, StoreListingRow } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST rows are loosely typed JSON. */

/** One select for every drop feed (server history and the Premium live panel). */
export const DROP_SELECT =
  'id,event_type,price_aud,previous_price_aud,rrp_aud,rrp_tag,rrp_delta_pct,occurred_at,game,' +
  'retailers(slug,name),retail_products(title,url,image_url),sealed_products(id,game,lang,slug,name),' +
  'sightings!drop_events_sighting_id_fkey(id,channel,state,suburb,store_name,product,quantity,purchase_limit,photo_path,note,url,confirm_count,gone_at)'

export function sightingPhotoUrl(path: string | null): string | null {
  if (!path) return null
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/sighting-photos/${path}`
}

export function toDrop(r: any): DropRow {
  const s = r.sightings ?? null
  const p = r.retail_products ?? null
  const num = (v: any) => (v === null || v === undefined ? null : Number(v))
  return {
    id: r.id,
    source: s ? 'member' : 'monitor',
    retailerSlug: r.retailers?.slug ?? '',
    retailerName: r.retailers?.name ?? '',
    title: p?.title ?? s?.product ?? '',
    url: p?.url ?? s?.url ?? null,
    eventType: r.event_type,
    priceAud: num(r.price_aud),
    rrpAud: num(r.rrp_aud),
    rrpTag: r.rrp_tag,
    rrpDeltaPct: num(r.rrp_delta_pct),
    game: (r.game ?? null) as Game | null,
    occurredAt: r.occurred_at,
    previousPriceAud: num(r.previous_price_aud),
    product: r.sealed_products
      ? { id: r.sealed_products.id, game: r.sealed_products.game, lang: r.sealed_products.lang, slug: r.sealed_products.slug, name: r.sealed_products.name }
      : null,
    imageUrl: p?.image_url ?? null,
    sighting: s
      ? {
          id: s.id,
          channel: s.channel,
          state: s.state,
          suburb: s.suburb,
          storeName: s.store_name,
          quantity: s.quantity,
          purchaseLimit: s.purchase_limit,
          photoUrl: sightingPhotoUrl(s.photo_path),
          note: s.note,
          confirmations: s.confirm_count ?? 0,
          goneAt: s.gone_at,
          reporter: null,
        }
      : null,
  }
}

export const RELEASE_SELECT = '*,sets(game,lang,slug,name)'

export function toRelease(r: any): ReleaseRow {
  return {
    id: r.id,
    game: r.game,
    lang: r.lang,
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    releaseDate: r.release_date,
    datePrecision: r.date_precision,
    confidence: r.confidence,
    set: r.sets ? { game: r.sets.game, lang: r.sets.lang, slug: r.sets.slug, name: r.sets.name } : null,
    products: (Array.isArray(r.products) ? r.products : []).map((x: any) => ({
      name: String(x.name ?? ''),
      type: x.type ?? null,
      rrpAud: x.rrp_aud === null || x.rrp_aud === undefined ? null : Number(x.rrp_aud),
    })),
    retailerSlugs: r.retailer_slugs ?? [],
    summary: r.summary,
    bodyMd: r.body_md,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    updatedAt: r.updated_at,
  }
}

/** Soonest first; month/quarter precision sorts at the start of its period; TBC last. */
export function sortReleases(rows: ReleaseRow[]): ReleaseRow[] {
  return [...rows].sort((a, b) => {
    if (!a.releaseDate && !b.releaseDate) return a.title.localeCompare(b.title)
    if (!a.releaseDate) return 1
    if (!b.releaseDate) return -1
    return a.releaseDate.localeCompare(b.releaseDate) || a.title.localeCompare(b.title)
  })
}

/** Select for product pages and the in-stock list: a sealed product with every store's listing. */
export const SEALED_SELECT =
  'id,game,lang,slug,name,type,rrp_aud,release_date,updated_at,sets(slug,name),' +
  'retail_products(title,url,image_url,current_availability,current_price_aud,last_change_at,is_marketplace_seller,retailers!inner(slug,name,enabled))'

const IN_STOCK: Availability[] = ['in_stock_online', 'in_stock_cnc', 'in_stock_both']
export const isInStock = (a: Availability) => IN_STOCK.includes(a)
const offerRank = (o: OfferRow) => (isInStock(o.availability) ? 0 : o.availability === 'preorder' ? 1 : 2)

export function sortOffers(offers: OfferRow[]): OfferRow[] {
  return [...offers].sort((a, b) => offerRank(a) - offerRank(b) || (a.priceAud ?? 1e9) - (b.priceAud ?? 1e9) || a.retailerName.localeCompare(b.retailerName))
}

const listingRank = (a: Availability) => (IN_STOCK.includes(a) ? 0 : a === 'preorder' ? 1 : a === 'out_of_stock' ? 2 : 3)

/** In stock, then pre-order, then sold out, then unknown; most recent change first within each. */
export function sortListings<T extends { availability: Availability; lastChangeAt: string | null; title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => listingRank(a.availability) - listingRank(b.availability) || (b.lastChangeAt ?? '').localeCompare(a.lastChangeAt ?? '') || a.title.localeCompare(b.title))
}

export const STORE_LISTING_SELECT =
  'title,url,image_url,game,current_availability,current_price_aud,last_change_at,last_seen_at,retailers!inner(slug),sealed_products(id,game,lang,slug,name,rrp_aud)'

export function toStoreListing(r: any): StoreListingRow {
  const sp = r.sealed_products ?? null
  return {
    title: r.title,
    url: r.url,
    availability: r.current_availability ?? 'unknown',
    priceAud: r.current_price_aud === null || r.current_price_aud === undefined ? null : Number(r.current_price_aud),
    lastChangeAt: r.last_change_at ?? null,
    lastSeenAt: r.last_seen_at ?? null,
    imageUrl: r.image_url ?? null,
    game: r.game ?? null,
    product: sp ? { id: sp.id, game: sp.game, lang: sp.lang, slug: sp.slug, name: sp.name, rrpAud: sp.rrp_aud === null || sp.rrp_aud === undefined ? null : Number(sp.rrp_aud) } : null,
  }
}

export function toSealedProduct(r: any): SealedProductRow {
  const offers = sortOffers(
    (r.retail_products ?? [])
      .filter((p: any) => !p.is_marketplace_seller)
      .map((p: any): OfferRow => ({
        retailerSlug: p.retailers?.slug ?? '',
        retailerName: p.retailers?.name ?? '',
        title: p.title,
        url: p.url,
        availability: p.current_availability ?? 'unknown',
        priceAud: p.current_price_aud === null || p.current_price_aud === undefined ? null : Number(p.current_price_aud),
        lastChangeAt: p.last_change_at ?? null,
        imageUrl: p.image_url ?? null,
      })),
  )
  const inStock = offers.filter((o) => isInStock(o.availability))
  const prices = inStock.map((o) => o.priceAud).filter((x): x is number => x !== null)
  return {
    id: r.id,
    game: r.game,
    lang: r.lang,
    slug: r.slug,
    name: r.name,
    type: r.type,
    rrpAud: r.rrp_aud === null || r.rrp_aud === undefined ? null : Number(r.rrp_aud),
    releaseDate: r.release_date ?? null,
    set: r.sets ? { slug: r.sets.slug, name: r.sets.name } : null,
    offers,
    inStockCount: inStock.length,
    lowestInStockAud: prices.length ? Math.min(...prices) : null,
    updatedAt: offers.map((o) => o.lastChangeAt).filter(Boolean).sort().at(-1) ?? r.updated_at ?? null,
  }
}
