import type { Game } from '@/lib/seo/urls'
import type { DropRow, ReleaseRow } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST rows are loosely typed JSON. */

/** One select for every drop feed (server history and the Premium live panel). */
export const DROP_SELECT =
  'id,event_type,price_aud,rrp_aud,rrp_tag,rrp_delta_pct,occurred_at,game,' +
  'retailers(slug,name),retail_products(title,url),' +
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
