import 'server-only'
import { rulesFromSettings } from '@/lib/domain/rules'
import { supabasePublic } from '@/lib/supabase/server'
import type { Game, Lang } from '@/lib/seo/urls'
import type { ArticleRow, CardRow, DropRow, GradeRow, ListingRow, MarketRow, Repository, SetRow } from './types'

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
      const sortCol = { market_cap: 'market_cap_aud', population: 'population', floor: 'floor_aud', change_7d: 'market_cap_7d_ago', change_30d: 'market_cap_30d_ago' }[query.sort]
      let q = sb.from('market_cap_rankings').select('*', { count: 'exact' })
      if (query.gradeKey !== 'all') q = q.eq('grade_key', query.gradeKey)
      if (query.game) q = q.eq('game', query.game)
      if (query.lang) q = q.eq('lang', query.lang)
      if (query.setId) q = q.eq('set_id', query.setId)
      const from = (query.page - 1) * query.pageSize
      const { data, count } = await q.order(sortCol, { ascending: query.order === 'asc' }).range(from, from + query.pageSize - 1)
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
          marketCapAud: Number(r.market_cap_aud),
          change1d: pct(Number(r.market_cap_aud), r.market_cap_1d_ago && Number(r.market_cap_1d_ago)),
          change7d: pct(Number(r.market_cap_aud), r.market_cap_7d_ago && Number(r.market_cap_7d_ago)),
          change30d: pct(Number(r.market_cap_aud), r.market_cap_30d_ago && Number(r.market_cap_30d_ago)),
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
      const { data } = await sb.from('retailers').select('slug,name,base_url,enabled').order('name')
      return (data ?? []).map((r: any) => ({ slug: r.slug, name: r.name, baseUrl: r.base_url, enabled: r.enabled }))
    },
    async drops(filter) {
      // Anonymous client: RLS only returns events past their public_at delay.
      let q = sb
        .from('drop_events')
        .select('id,event_type,price_aud,rrp_aud,rrp_tag,rrp_delta_pct,occurred_at,retail_products!inner(title,url,game,retailers!inner(slug,name))')
        .order('occurred_at', { ascending: false })
        .limit(filter?.limit ?? 50)
      if (filter?.retailerSlug) q = q.eq('retail_products.retailers.slug', filter.retailerSlug)
      const { data } = await q
      return (data ?? []).map((r: any): DropRow => ({
        id: r.id,
        retailerSlug: r.retail_products.retailers.slug,
        retailerName: r.retail_products.retailers.name,
        title: r.retail_products.title,
        url: r.retail_products.url,
        eventType: r.event_type,
        priceAud: r.price_aud === null ? null : Number(r.price_aud),
        rrpAud: r.rrp_aud === null ? null : Number(r.rrp_aud),
        rrpTag: r.rrp_tag,
        rrpDeltaPct: r.rrp_delta_pct === null ? null : Number(r.rrp_delta_pct),
        game: r.retail_products.game as Game | null,
        occurredAt: r.occurred_at,
      }))
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
