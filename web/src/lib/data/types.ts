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

export interface RetailerRow {
  slug: string
  name: string
  baseUrl: string
  enabled: boolean
}

export interface DropRow {
  id: number
  retailerSlug: string
  retailerName: string
  title: string
  url: string
  eventType: 'NEW_LISTING' | 'PREORDER_OPEN' | 'IN_STOCK' | 'PRICE_CHANGE' | 'QUEUE_LIVE'
  priceAud: number | null
  rrpAud: number | null
  rrpTag: 'AT_RRP' | 'BELOW_RRP' | 'ABOVE_RRP' | 'UNKNOWN'
  rrpDeltaPct: number | null
  game: Game | null
  occurredAt: string
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
  listingStats(cardIds: string[]): Promise<ListingStats[]>
  listingsForCard(cardId: string, opts: { gradeKey?: string; status: 'active' | 'closed' }): Promise<ListingRow[]>
  marketplace(query: MarketplaceQuery): Promise<Paged<ListingRow>>
  getListing(id: number): Promise<ListingRow | null>
  getSeller(username: string): Promise<SellerRow | null>
  listingsBySeller(username: string): Promise<ListingRow[]>
  retailers(): Promise<RetailerRow[]>
  /** Public, delayed drop history. Instant events need a Premium session (RLS). */
  drops(filter?: { retailerSlug?: string; limit?: number }): Promise<DropRow[]>
  articles(filter?: { category?: string; limit?: number }): Promise<ArticleRow[]>
  getArticle(year: number, slug: string): Promise<ArticleRow | null>
  articlesForCard(cardId: string): Promise<ArticleRow[]>
  redirectFor(path: string): Promise<{ to: string; code: number } | null>
}
