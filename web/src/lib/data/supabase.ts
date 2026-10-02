import 'server-only'
import { rulesFromSettings } from '@/lib/domain/rules'
import { supabasePublic } from '@/lib/supabase/server'
import type { Game, Lang } from '@/lib/seo/urls'
import { DROP_SELECT, RELEASE_SELECT, SEALED_SELECT, sortListings, sortReleases, STORE_LISTING_SELECT, toDrop, toRelease, toSealedProduct, toStoreListing } from './drops'
import type { ArticleRow, CardRow, GradeRow, ListingRow, MarketRow, RetailerRow, Repository, SetRow } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come from PostgREST as loosely typed JSON;
   generate types with `supabase gen types typescript` once the project exists and tighten this. */

const CARD_SELECT =
  'id,set_id,game,lang,number,printed_total,name,slug,variant,rarity,image_url,psa_spec_id,counterpart_card_id,updated_at,' +
  'sets!inner(slug,name,code),card_external_ids(source,external_id)'

function toSet(r: any): SetRow {
  return { id: r.id, game: r.game, lang: r.lang, code: r.code, name: r.name, slug: r.slug, releaseDate: r.release_date, totalCards: r.total_cards, intro: r.intro, updatedAt: r.updated_at ?? null }
}

function toCard(r: any): CardRow {
  return {
    id: r.id,
    setId: r.set_id,
    game: r.game,
    lang: r.lang,
    setSlug: r.sets.slug,
    setName: r.sets.name,
    setCode: r.sets.code,
    number: r.number,
    printedTotal: r.printed_total,
    name: r.name,
    slug: r.slug,
    variant: r.variant,
    rarity: r.rarity,
    imageUrl: r.image_url,
    psaSpecId: r.psa_spec_id,
    counterpartCardId: r.counterpart_card_id,
    externalIds: (r.card_external_ids ?? []).map((e: any) => ({ source: e.source, externalId: e.external_id })),
    updatedAt: r.updated_at ?? null,
  }
}

const LISTING_SELECT =
  'id,seller_id,card_id,sealed_product_id,listing_type,lang,grader,grade,grade_key,condition,cert_number,cert_verified,' +
  'title,description,price_aud,qty,location_state,status,approved_at,sold_at,expires_at,removed_at,' +
  'profiles!listings_seller_id_fkey(username,created_at),listing_images(storage_path,kind,position)'

function toListing(r: any): ListingRow {
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/listing-images/`
  return {
    id: r.id,
    sellerUsername: r.profiles?.username ?? 'unknown',
    sellerPremium: false, // filled by is_premium() RPC where the badge is shown
    sellerSince: r.profiles?.created_at ?? '',
    cardId: r.card_id,
    sealedProductId: r.sealed_product_id,
    listingType: r.listing_type,
    lang: r.lang,
    grader: r.grader,
    grade: r.grade === null ? null : Number(r.grade),
    gradeKey: r.grade_key,
    condition: r.condition,
    certNumber: r.cert_number,
    certVerified: r.cert_verified,
    title: r.title,
    description: r.description,
    priceAud: Number(r.price_aud),
    qty: r.qty,
    state: r.location_state,
    status: r.status,
    approvedAt: r.approved_at,
    closedAt: r.sold_at ?? (r.status === 'expired' ? r.expires_at : null),
    images: (r.listing_images ?? [])
      .sort((a: any, b: any) => a.position - b.position)
      .map((i: any) => ({ url: base + i.storage_path, kind: i.kind, alt: `${r.title} – ${i.kind.replace('-', ' ')}` })),
  }
}

function pct(cur: number, prev: number | null): number | null {
  return prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null
}

export function supabaseRepository(): Repository {
  const sb = supabasePublic()
  async function loadRetailers(): Promise<RetailerRow[]> {
    const { data } = await sb.from('retailers').select('slug,name,base_url,enabled,monitored,platform,kind,state,blocked_reason,last_checked_at,watch_interval_seconds').order('name')
    return (data ?? []).map((r: any) => ({
      slug: r.slug,
      name: r.name,
      baseUrl: r.base_url,
      enabled: r.enabled,
      monitored: r.monitored !== false,
      platform: r.platform ?? 'custom',
      kind: r.kind ?? null,
      state: r.state ?? null,
      blockedReason: r.blocked_reason ?? null,
      lastCheckedAt: r.last_checked_at ?? null,
      watchIntervalSeconds: r.watch_interval_seconds ?? null,
    }))
  }
  return {
    isDemo: false,
    async getRules() {
      const { data } = await sb.from('site_settings').select('key,value')
      return rulesFromSettings(data ?? [])
    },
    async listSets(filter) {
      let q = sb.from('sets').select('*').order('release_date', { ascending: false })
      if (filter?.game) q = q.eq('game', filter.game)
      if (filter?.lang) q = q.eq('lang', filter.lang)
      return ((await q).data ?? []).map(toSet)
    },
    async getSet(game, lang, slug) {
      const { data } = await sb.from('sets').select('*').match({ game, lang, slug }).maybeSingle()
      return data ? toSet(data) : null
    },
    async listCardsInSet(setId) {
      const { data } = await sb.from('cards').select(CARD_SELECT).eq('set_id', setId).order('number')
      return (data ?? []).map(toCard)
    },
    async getCard(game, lang, setSlug, cardSlug) {
      const { data } = await sb.from('cards').select(CARD_SELECT).match({ game, lang, slug: cardSlug }).eq('sets.slug', setSlug).maybeSingle()
      return data ? toCard(data) : null
    },
    async getCardsByIds(ids) {
      if (!ids.length) return []
      const { data } = await sb.from('cards').select(CARD_SELECT).in('id', ids)
      return (data ?? []).map(toCard)
    },
    async searchCards(q, limit) {
      const { data } = await sb.from('cards').select(CARD_SELECT).textSearch('search', q, { type: 'websearch', config: 'simple' }).limit(limit)
      return (data ?? []).map(toCard)
    },
    async marketCap(query) {
      const sortCol = { market_cap: 'rank_value', population: 'population', floor: 'floor_aud', change_7d: 'floor_7d_ago', change_30d: 'floor_30d_ago' }[query.sort]
      let q = sb.from('market_cap_rankings').select('*', { count: 'exact' })
      if (query.gradeKey !== 'all') q = q.eq('grade_key', query.gradeKey)
      if (query.game) q = q.eq('game', query.game)
      if (query.lang) q = q.eq('lang', query.lang)
      if (query.setId) q = q.eq('set_id', query.setId)
      const from = (query.page - 1) * query.pageSize
      if (query.q) {
        const matches = await this.searchCards(query.q, 200)
        q = q.in('card_id', matches.map((c) => c.id))
      }
      const { data, count } = await q.order(sortCol, { ascending: query.order === 'asc', nullsFirst: false }).range(from, from + query.pageSize - 1)
      const rows = data ?? []
      const cards = await this.getCardsByIds(rows.map((r: any) => r.card_id))
      const byId = new Map(cards.map((c) => [c.id, c]))
      const out: MarketRow[] = rows
        .filter((r: any) => byId.has(r.card_id))
        .map((r: any, i: number) => ({
          rank: from + i + 1,
          card: byId.get(r.card_id)!,
          gradeKey: r.grade_key,
          population: r.population,
          floorAud: Number(r.floor_aud),
          basis: r.basis,
          marketCapAud: r.market_cap_aud === null ? null : Number(r.market_cap_aud),
          spark7d: (r.spark_7d ?? []).map(Number),
          // Value change (the floor) — the honest measure while population is missing.
          change1d: pct(Number(r.floor_aud), r.floor_1d_ago && Number(r.floor_1d_ago)),
          change7d: pct(Number(r.floor_aud), r.floor_7d_ago && Number(r.floor_7d_ago)),
          change30d: pct(Number(r.floor_aud), r.floor_30d_ago && Number(r.floor_30d_ago)),
          asOf: r.as_of,
        }))
      return { rows: out, total: count ?? out.length, page: query.page, pageSize: query.pageSize, asOf: rows[0]?.as_of ?? null }
    },
    async cardGrades(cardId) {
      const [{ data: pops }, { data: floors }] = await Promise.all([
        sb.from('population_current').select('grade_key,population').eq('card_id', cardId),
        sb.from('floor_prices').select('*').eq('card_id', cardId),
      ])
      const keys = new Set([...(pops ?? []).map((p: any) => p.grade_key), ...(floors ?? []).map((f: any) => f.grade_key)])
      return [...keys].sort().reverse().map((gradeKey): GradeRow => {
        const p: any = pops?.find((x: any) => x.grade_key === gradeKey)
        const f: any = floors?.find((x: any) => x.grade_key === gradeKey)
        const floor = f ? Number(f.floor_aud) : null
        return {
          gradeKey,
          population: p?.population ?? null,
          floorAud: floor,
          basis: f?.basis ?? null,
          source: f?.source ?? null,
          sampleSize: f?.sample_size ?? null,
          marketCapAud: p && floor ? p.population * floor : null,
          lastSoldAud: f?.last_sold_aud ? Number(f.last_sold_aud) : null,
          medianSold30dAud: f?.median_sold_30d_aud ? Number(f.median_sold_30d_aud) : null,
          observedAt: f?.observed_at ?? null,
        }
      })
    },
    async popHistory(cardId, gradeKey) {
      const { data } = await sb.from('population_snapshots').select('captured_at,population').match({ card_id: cardId, grade_key: gradeKey }).order('captured_at')
      return (data ?? []).map((r: any) => ({ date: String(r.captured_at).slice(0, 10), value: r.population }))
    },
    async marketCapHistory(cardId, gradeKey) {
      const { data } = await sb.from('market_cap_snapshots').select('date,market_cap_aud').match({ card_id: cardId, grade_key: gradeKey }).order('date')
      return (data ?? []).map((r: any) => ({ date: r.date, value: Number(r.market_cap_aud) }))
    },
    async valueHistory(cardId, gradeKey) {
      const { data } = await sb.from('market_cap_snapshots').select('date,floor_aud').match({ card_id: cardId, grade_key: gradeKey }).order('date')
      return (data ?? []).map((r: any) => ({ date: r.date, value: Number(r.floor_aud) }))
    },
    async listingStats(cardIds) {
      if (!cardIds.length) return []
      const { data } = await sb.from('card_listing_stats').select('*').in('card_id', cardIds).gt('active_count', 0)
      return (data ?? []).map((r: any) => ({ cardId: r.card_id, gradeKey: r.grade_key, activeCount: r.active_count, lowestPriceAud: r.lowest_price_aud === null ? null : Number(r.lowest_price_aud) }))
    },
    async listingsForCard(cardId, opts) {
      let q = sb.from('listings').select(LISTING_SELECT).eq('card_id', cardId)
      q = opts.status === 'active' ? q.eq('status', 'active') : q.in('status', ['sold', 'expired'])
      if (opts.gradeKey) q = q.eq('grade_key', opts.gradeKey)
      const { data } = await q.order('price_aud', { ascending: true }).limit(100)
      return (data ?? []).map(toListing)
    },
    async marketplace(query) {
      let q = sb.from('listings').select(LISTING_SELECT + ',cards(game,set_id)', { count: 'exact' }).eq('status', 'active')
      if (query.game) q = q.eq('cards.game', query.game)
      if (query.lang) q = q.eq('lang', query.lang)
      if (query.setId) q = q.eq('cards.set_id', query.setId)
      if (query.gradeKey) q = q.eq('grade_key', query.gradeKey)
      if (query.listingType) q = q.eq('listing_type', query.listingType)
      if (query.state) q = q.eq('location_state', query.state)
      if (query.priceMin !== undefined) q = q.gte('price_aud', query.priceMin)
      if (query.priceMax !== undefined) q = q.lte('price_aud', query.priceMax)
      if (query.q) q = q.textSearch('search', query.q, { type: 'websearch', config: 'simple' })
      q = query.sort === 'newest' ? q.order('approved_at', { ascending: false }) : q.order('price_aud', { ascending: query.sort === 'price-asc' })
      const from = (query.page - 1) * query.pageSize
      const { data, count } = await q.range(from, from + query.pageSize - 1)
      return { rows: (data ?? []).map(toListing), total: count ?? 0, page: query.page, pageSize: query.pageSize }
    },
    async getListing(id) {
      const { data } = await sb.from('listings').select(LISTING_SELECT).eq('id', id).maybeSingle()
      return data ? toListing(data) : null
    },
    async getSeller(username) {
      const { data } = await sb.from('profiles').select('id,username,display_name,location_state,created_at').eq('username', username).maybeSingle()
      if (!data) return null
      const { data: premium } = await sb.rpc('is_premium', { p_user: data.id })
      return { username: data.username, displayName: data.display_name, state: data.location_state, memberSince: data.created_at, premium: Boolean(premium), responseRate: null }
    },
    async listingsBySeller(username) {
      const { data } = await sb.from('listings').select(LISTING_SELECT).eq('status', 'active').eq('profiles.username', username).limit(100)
      return (data ?? []).map(toListing)
    },
    async retailers() {
      return loadRetailers()
    },
    async stockOverview(filter) {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const [stores, counts, events] = await Promise.all([
        loadRetailers(),
        sb.rpc('stock_overview', { p_game: filter?.game ?? null }),
        sb.from('drop_events').select('id', { count: 'exact', head: true }).gte('occurred_at', since),
      ])
      const bySlug = new Map<string, any>(((counts.data ?? []) as any[]).map((c) => [c.slug, c]))
      return {
        stores: stores.map((r) => {
          const c = bySlug.get(r.slug)
          return { ...r, listings: c?.listings ?? 0, inStock: c?.in_stock ?? 0, preorder: c?.preorder ?? 0, lastChangeAt: c?.last_change_at ?? null }
        }),
        events7d: events.count ?? 0,
      }
    },
    async storeListings(slug, filter) {
      let q = sb
        .from('retail_products')
        .select(STORE_LISTING_SELECT)
        .eq('retailers.slug', slug)
        .not('game', 'is', null)
        .eq('is_marketplace_seller', false)
        .gte('last_seen_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
        .order('last_change_at', { ascending: false, nullsFirst: false })
        .limit(filter?.limit ?? 1000)
      if (filter?.game) q = q.eq('game', filter.game)
      const { data } = await q
      return sortListings((data ?? []).map(toStoreListing))
    },
    async drops(filter) {
      // Anonymous client: RLS only returns events past their public_at delay.
      let select = DROP_SELECT
      if (filter?.state || filter?.source === 'member') select = select.replace('sightings!drop_events_sighting_id_fkey(', 'sightings!drop_events_sighting_id_fkey!inner(')
      if (filter?.retailerSlug) select = select.replace('retailers(', 'retailers!inner(')
      let q = sb.from('drop_events').select(select).order('occurred_at', { ascending: false }).limit(filter?.limit ?? 50)
      if (filter?.retailerSlug) q = q.eq('retailers.slug', filter.retailerSlug)
      if (filter?.state) q = q.eq('sightings.state', filter.state)
      if (filter?.game) q = q.eq('game', filter.game)
      if (filter?.source === 'monitor') q = q.is('sighting_id', null)
      const { data } = await q
      return (data ?? []).map(toDrop)
    },
    async scoutLeaderboard(days, limit = 20) {
      const { data } = await sb.rpc('scout_leaderboard', { p_days: days, p_limit: limit })
      return (data ?? []).map((r: any) => ({ username: r.username, confirmed: r.confirmed, states: r.states ?? [] }))
    },
    async releases(filter) {
      let q = sb.from('release_events').select(RELEASE_SELECT).limit(500)
      if (filter?.game) q = q.eq('game', filter.game)
      if (filter?.from) q = q.or(`release_date.gte.${filter.from},release_date.is.null`)
      const { data } = await q
      return sortReleases((data ?? []).map(toRelease))
    },
    async deals(filter) {
      const { data } = await sb
        .from('ebay_deals')
        .select(`*,cards!inner(${CARD_SELECT})`)
        .is('gone_at', null)
        .order('found_at', { ascending: false })
        .limit(filter?.limit ?? 50)
      return (data ?? []).map((r: any) => ({
        id: r.id,
        itemId: r.item_id,
        card: toCard(r.cards),
        gradeKey: r.grade_key,
        title: r.title,
        buyingOption: r.buying_option,
        priceAud: Number(r.price_aud),
        shippingAud: r.shipping_aud === null ? null : Number(r.shipping_aud),
        marketAud: Number(r.market_aud),
        discountPct: Number(r.discount_pct),
        bidCount: r.bid_count,
        endTime: r.end_time,
        url: r.url,
        imageUrl: r.image_url,
        foundAt: r.found_at,
        goneAt: r.gone_at,
      }))
    },
    async inStock(filter) {
      // Products with at least one listing in stock or on pre-order right now.
      let q = sb
        .from('sealed_products')
        .select(SEALED_SELECT.replace('retail_products(', 'retail_products!inner('))
        .in('retail_products.current_availability', ['in_stock_online', 'in_stock_cnc', 'in_stock_both', 'preorder'])
        .limit(filter?.limit ?? 100)
      if (filter?.game) q = q.eq('game', filter.game)
      if (filter?.retailerSlug) q = q.eq('retail_products.retailers.slug', filter.retailerSlug)
      const { data } = await q
      return (data ?? []).map(toSealedProduct).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    },
    async listSealedProducts(filter) {
      let q = sb.from('sealed_products').select(SEALED_SELECT).order('updated_at', { ascending: false }).limit(filter?.limit ?? 500)
      if (filter?.game) q = q.eq('game', filter.game)
      if (filter?.lang) q = q.eq('lang', filter.lang)
      const { data } = await q
      return (data ?? []).map(toSealedProduct)
    },
    async getSealedProduct(game, lang, slug) {
      const { data } = await sb.from('sealed_products').select(SEALED_SELECT).eq('game', game).eq('lang', lang).eq('slug', slug).maybeSingle()
      return data ? toSealedProduct(data) : null
    },
    async productDrops(sealedProductId, limit = 50) {
      const { data } = await sb.from('drop_events').select(DROP_SELECT).eq('sealed_product_id', sealedProductId).order('occurred_at', { ascending: false }).limit(limit)
      return (data ?? []).map(toDrop)
    },
    async productWatchCount(sealedProductId) {
      const { data } = await sb.rpc('product_watch_count', { p_sealed_product: sealedProductId })
      return typeof data === 'number' ? data : 0
    },
    async getRelease(game, slug) {
      const { data } = await sb.from('release_events').select(RELEASE_SELECT).eq('game', game).eq('slug', slug).maybeSingle()
      return data ? toRelease(data) : null
    },
    async articles(filter) {
      let q = sb.from('articles').select('*, article_tags(*)').eq('status', 'published').order('published_at', { ascending: false }).limit(filter?.limit ?? 50)
      if (filter?.category) q = q.eq('category', filter.category)
      return ((await q).data ?? []).map(toArticle)
    },
    async getArticle(year, slug) {
      const { data } = await sb.from('articles').select('*, article_tags(*)').eq('slug', slug).eq('status', 'published').maybeSingle()
      if (!data || new Date(data.published_at).getUTCFullYear() !== year) return null
      return toArticle(data)
    },
    async articlesForCard(cardId) {
      const { data } = await sb.from('article_tags').select('articles!inner(*, article_tags(*))').eq('card_id', cardId).eq('articles.status', 'published').limit(10)
      return (data ?? []).map((r: any) => toArticle(r.articles))
    },
    async redirectFor(path) {
      const { data } = await sb.from('redirects').select('to_path,code').eq('from_path', path).maybeSingle()
      return data ? { to: data.to_path, code: data.code } : null
    },
  }
}

function toArticle(r: any): ArticleRow {
  const tags = r.article_tags ?? []
  return {
    slug: r.slug,
    category: r.category,
    title: r.title,
    dek: r.dek,
    bodyMd: r.body_md,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    heroImageUrl: r.hero_image_url,
    tags: {
      cardIds: tags.filter((t: any) => t.card_id).map((t: any) => t.card_id),
      setIds: tags.filter((t: any) => t.set_id).map((t: any) => t.set_id),
      games: tags.filter((t: any) => t.game).map((t: any) => t.game as Game),
    },
  }
}

export type { Lang }
