import type { Rules } from '@/lib/domain/rules'
import type { ListingStatus } from '@/lib/domain/listing'
import type { ListingStats } from '@/lib/domain/buyButton'
import type { Game, Lang } from '@/lib/seo/urls'

export interface SetRow {
  id: string
  game: Game
  lang: Lang
  code: string
  name: string
  slug: string
  releaseDate: string | null
  totalCards: number | null
  intro: string | null
  updatedAt: string | null
}

export interface CardRow {
  id: string
  setId: string
  game: Game
  lang: Lang
  setSlug: string
  setName: string
  setCode: string
  number: string
  printedTotal: string | null
  name: string
  slug: string
  variant: string
  rarity: string | null
  imageUrl: string | null
  psaSpecId: string | null
  counterpartCardId: string | null
  externalIds: { source: string; externalId: string }[]
  updatedAt: string | null
}

export type FloorBasis = 'marketplace_ask' | 'external_ask' | 'last_sale'

export interface GradeRow {
  gradeKey: string
  population: number | null
  floorAud: number | null
  basis: FloorBasis | null
  source: string | null
  sampleSize: number | null
  marketCapAud: number | null
  lastSoldAud: number | null
  medianSold30dAud: number | null
  observedAt: string | null
}

export interface MarketRow {
  rank: number
  card: CardRow
  gradeKey: string
  population: number | null // null until a licensed population source exists
  floorAud: number
  basis: FloorBasis
  marketCapAud: number | null
  spark7d: number[]
  change1d: number | null
  change7d: number | null
  change30d: number | null
  asOf: string
}

export type MarketSort = 'market_cap' | 'population' | 'floor' | 'change_7d' | 'change_30d'

export interface MarketQuery {
  game?: Game
  lang?: Lang
  setId?: string
  gradeKey: string
  sort: MarketSort
  order: 'asc' | 'desc'
  page: number
  pageSize: number
  q?: string
}

export interface HistoryPoint {
  date: string
  value: number
}

export interface ListingRow {
  id: number
  sellerUsername: string
  sellerPremium: boolean
  sellerSince: string
  cardId: string | null
  sealedProductId: string | null
  listingType: 'graded_single' | 'raw_single' | 'sealed'
  lang: Lang
  grader: string | null
  grade: number | null
  gradeKey: string
  condition: string | null
  certNumber: string | null
  certVerified: boolean
  title: string
  description: string
  priceAud: number
  qty: number
  state: string
  status: ListingStatus
  approvedAt: string | null
  closedAt: string | null
  images: { url: string; kind: string; alt: string }[]
}

export interface MarketplaceQuery {
  game?: Game
  lang?: Lang
  setId?: string
  gradeKey?: string
  listingType?: ListingRow['listingType']
  state?: string
  priceMin?: number
  priceMax?: number
  q?: string
  sort: 'newest' | 'price-asc' | 'price-desc'
  page: number
  pageSize: number
}

export interface SellerRow {
  username: string
  displayName: string | null
  state: string | null
  memberSince: string
  premium: boolean
  responseRate: number | null
}

export type RetailerKind = 'specialist' | 'big-box' | 'toy' | 'department' | 'marketplace' | 'official' | 'other'

export interface RetailerRow {
  slug: string
  name: string
  baseUrl: string
  enabled: boolean // our monitor is running
  monitored: boolean // a monitor exists (false = member sightings only)
  platform: 'custom' | 'shopify' | 'woocommerce' | 'none'
  kind: RetailerKind | null
  state: AuState | null
  blockedReason: string | null // set when the store blocks automated access (never worked around)
  lastCheckedAt: string | null
  watchIntervalSeconds: number | null // how often the monitor checks this store
}

export type Availability = 'unknown' | 'out_of_stock' | 'preorder' | 'in_stock_online' | 'in_stock_cnc' | 'in_stock_both'

/** A sealed product (one product page), e.g. "Prismatic Evolutions Elite Trainer Box" (EN). */
export interface SealedProductRef {
  id: string
  game: Game
  lang: Lang
  slug: string
  name: string
}

/** One store's listing of a sealed product, with its current status. */
export interface OfferRow {
  retailerSlug: string
  retailerName: string
  title: string
  url: string
  availability: Availability
  priceAud: number | null
  lastChangeAt: string | null
  imageUrl: string | null
}

export interface SealedProductRow extends SealedProductRef {
  type: string // booster-box, etb, booster-bundle, tin, ...
  rrpAud: number | null
  releaseDate: string | null
  set: { slug: string; name: string } | null
  offers: OfferRow[] // in stock / pre-order first, then cheapest
  inStockCount: number
  lowestInStockAud: number | null
  updatedAt: string | null
}

/** An eBay listing well under market value (found via eBay's Browse API). */
export interface DealRow {
  id: number
  itemId: string
  card: CardRow
  gradeKey: string
  title: string
  buyingOption: 'FIXED_PRICE' | 'AUCTION'
  priceAud: number
  shippingAud: number | null
  marketAud: number
  discountPct: number
  bidCount: number | null
  endTime: string | null
  url: string // affiliate-tracked when EPN is configured
  imageUrl: string | null
  foundAt: string
  goneAt: string | null
}

export const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const
export type AuState = (typeof AU_STATES)[number]
export const AU_STATE_NAMES: Record<AuState, string> = {
  ACT: 'Australian Capital Territory',
  NSW: 'New South Wales',
  NT: 'Northern Territory',
  QLD: 'Queensland',
  SA: 'South Australia',
  TAS: 'Tasmania',
  VIC: 'Victoria',
  WA: 'Western Australia',
}

/** A member report attached to a drop event (source = 'member'). */
export interface SightingInfo {
  id: number
  channel: 'in_store' | 'online'
  state: AuState | null
  suburb: string | null
  storeName: string | null
  quantity: 'few' | 'some' | 'plenty' | null
  purchaseLimit: number | null
  photoUrl: string | null
  note: string | null
  confirmations: number
  goneAt: string | null
  reporter: string | null
}

export interface DropRow {
  id: number
  source: 'monitor' | 'member'
  retailerSlug: string
  retailerName: string
  title: string
  url: string | null // retailer product page (monitor, online sighting); null for in-store
  eventType: 'NEW_LISTING' | 'PREORDER_OPEN' | 'IN_STOCK' | 'PRICE_CHANGE' | 'QUEUE_LIVE'
  priceAud: number | null
  rrpAud: number | null
  rrpTag: 'AT_RRP' | 'BELOW_RRP' | 'ABOVE_RRP' | 'UNKNOWN'
  rrpDeltaPct: number | null
  game: Game | null
  occurredAt: string
  sighting: SightingInfo | null
  previousPriceAud: number | null // PRICE_CHANGE: below priceAud means a price drop
  product: SealedProductRef | null // the product page this event belongs to (Notify me watches this)
  imageUrl: string | null
}

export interface DropFilter {
  retailerSlug?: string
  state?: AuState
  game?: Game
  source?: 'monitor' | 'member'
  limit?: number
}

export interface ScoutRow {
  username: string
  confirmed: number
  states: AuState[]
}

export type ReleaseKind = 'set_release' | 'product_release' | 'prerelease' | 'preorder_open' | 'retailer_date'

export interface ReleaseProduct {
  name: string
  type: string | null // booster-box, etb, booster-bundle, ...
  rrpAud: number | null
}

export interface ReleaseRow {
  id: string
  game: Game
  lang: Lang
  slug: string
  title: string
  kind: ReleaseKind
  releaseDate: string | null // YYYY-MM-DD
  datePrecision: 'day' | 'month' | 'quarter' | 'tbc'
  confidence: 'official' | 'retailer' | 'unconfirmed'
  set: { game: Game; lang: Lang; slug: string; name: string } | null
  products: ReleaseProduct[]
  retailerSlugs: string[]
  summary: string | null
  bodyMd: string | null
  sourceName: string | null
  sourceUrl: string | null
  updatedAt: string
}

export interface ArticleRow {
  slug: string
  category: string
  title: string
  dek: string | null
  bodyMd: string
  publishedAt: string
  updatedAt: string
  seoTitle: string | null
  seoDescription: string | null
  heroImageUrl: string | null
  tags: { cardIds: string[]; setIds: string[]; games: Game[] }
}

export interface Paged<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

/** Everything a page needs to read. Implemented by the Supabase repo (RLS
 * applies: anon key + the user's session) and by the demo fixture repo. */
export interface Repository {
  readonly isDemo: boolean
  getRules(): Promise<Rules>
  listSets(filter?: { game?: Game; lang?: Lang }): Promise<SetRow[]>
  getSet(game: Game, lang: Lang, slug: string): Promise<SetRow | null>
  listCardsInSet(setId: string): Promise<CardRow[]>
  getCard(game: Game, lang: Lang, setSlug: string, cardSlug: string): Promise<CardRow | null>
  getCardsByIds(ids: string[]): Promise<CardRow[]>
  searchCards(q: string, limit: number): Promise<CardRow[]>
  marketCap(query: MarketQuery): Promise<Paged<MarketRow> & { asOf: string | null }>
  cardGrades(cardId: string): Promise<GradeRow[]>
  popHistory(cardId: string, gradeKey: string): Promise<HistoryPoint[]>
  marketCapHistory(cardId: string, gradeKey: string): Promise<HistoryPoint[]>
  valueHistory(cardId: string, gradeKey: string): Promise<HistoryPoint[]>
  listingStats(cardIds: string[]): Promise<ListingStats[]>
  listingsForCard(cardId: string, opts: { gradeKey?: string; status: 'active' | 'closed' }): Promise<ListingRow[]>
  marketplace(query: MarketplaceQuery): Promise<Paged<ListingRow>>
  getListing(id: number): Promise<ListingRow | null>
  getSeller(username: string): Promise<SellerRow | null>
  listingsBySeller(username: string): Promise<ListingRow[]>
  retailers(): Promise<RetailerRow[]>
  /** Public, delayed drop history (monitors + confirmed member sightings). Instant events need a Premium session (RLS). */
  drops(filter?: DropFilter): Promise<DropRow[]>
  /** Top scouts by confirmed sightings over the last N days. */
  scoutLeaderboard(days: number, limit?: number): Promise<ScoutRow[]>
  /** Published release calendar entries, soonest first; TBC last. */
  releases(filter?: { game?: Game; from?: string }): Promise<ReleaseRow[]>
  getRelease(game: Game, slug: string): Promise<ReleaseRow | null>
  /** Products currently in stock or on pre-order somewhere, most recently changed first. */
  inStock(filter?: { game?: Game; retailerSlug?: string; limit?: number }): Promise<SealedProductRow[]>
  /** Sealed products (product pages), most recently active first. */
  listSealedProducts(filter?: { game?: Game; lang?: Lang; limit?: number }): Promise<SealedProductRow[]>
  getSealedProduct(game: Game, lang: Lang, slug: string): Promise<SealedProductRow | null>
  productDrops(sealedProductId: string, limit?: number): Promise<DropRow[]>
  productWatchCount(sealedProductId: string): Promise<number>
  /** eBay deals, newest first. Anonymous/Free readers only get deals past their public delay (RLS). */
  deals(filter?: { limit?: number }): Promise<DealRow[]>
  articles(filter?: { category?: string; limit?: number }): Promise<ArticleRow[]>
  getArticle(year: number, slug: string): Promise<ArticleRow | null>
  articlesForCard(cardId: string): Promise<ArticleRow[]>
  redirectFor(path: string): Promise<{ to: string; code: number } | null>
}
