/**
 * DEMO data, used whenever Supabase isn't configured (local dev, CI, preview
 * builds). Card identities are the real 20-card research sample
 * (docs/research/sample-20-cards.json); every NUMBER here (population, prices,
 * listings) is synthetic and the UI labels it "Demo data" on every page.
 */
import { DEFAULT_RULES } from '@/lib/domain/rules'
import type { ListingStats } from '@/lib/domain/buyButton'
import { slugify, type Game, type Lang } from '@/lib/seo/urls'
import { isInStock, sortListings, sortReleases } from './drops'
import type {
  ArticleRow,
  CardRow,
  DropRow,
  ReleaseRow,
  SealedProductRow,
  GradeRow,
  HistoryPoint,
  ListingRow,
  MarketQuery,
  MarketRow,
  MarketplaceQuery,
  Paged,
  Repository,
  RetailerRow,
  SellerRow,
  SetRow,
} from './types'

// Deterministic pseudo-random numbers so pages (and tests) are stable.
function rand(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return ((h >>> 0) % 100000) / 100000
}

const SETS: SetRow[] = [
  ['pokemon', 'en', 'sv3pt5', '151', '151', '2023-09-22'],
  ['pokemon', 'en', 'swsh7', 'Evolving Skies', 'evolving-skies', '2021-08-27'],
  ['pokemon', 'en', 'sv8pt5', 'Prismatic Evolutions', 'prismatic-evolutions', '2025-01-17'],
  ['pokemon', 'en', 'svp', 'Scarlet & Violet Black Star Promos', 'scarlet-violet-promos', '2023-03-31'],
  ['pokemon', 'en', 'base1', 'Base Set', 'base-set', '1999-01-09'],
  ['pokemon', 'jp', 'SV2a', 'Pokémon Card 151', 'sv2a-pokemon-card-151', '2023-06-16'],
  ['pokemon', 'jp', 's6a', 'Eevee Heroes', 's6a-eevee-heroes', '2021-05-28'],
  ['pokemon', 'jp', 'SV8', 'Super Electric Breaker', 'sv8-super-electric-breaker', '2024-10-18'],
  ['pokemon', 'jp', 'SV8a', 'Terastal Festival ex', 'sv8a-terastal-festival-ex', '2024-12-06'],
  ['pokemon', 'jp', 'PMCG1', 'Expansion Pack (Base Set)', 'expansion-pack', '1996-10-20'],
  ['one-piece', 'en', 'OP01', 'Romance Dawn', 'op-01', '2022-12-02'],
  ['one-piece', 'en', 'OP02', 'Paramount War', 'op-02', '2023-03-10'],
  ['one-piece', 'en', 'OP05', 'Awakening of the New Era', 'op-05', '2023-12-08'],
  ['one-piece', 'en', 'OP06', 'Wings of the Captain', 'op-06', '2024-03-15'],
  ['one-piece', 'en', 'OP09', 'Emperors in the New World', 'op-09', '2024-12-13'],
  ['one-piece', 'jp', 'OP01', 'Romance Dawn', 'op-01', '2022-07-22'],
  ['one-piece', 'jp', 'OP02', 'Paramount War', 'op-02', '2022-11-04'],
  ['one-piece', 'jp', 'OP05', 'Awakening of the New Era', 'op-05', '2023-08-26'],
  ['one-piece', 'jp', 'OP06', 'Wings of the Captain', 'op-06', '2023-11-25'],
  ['one-piece', 'jp', 'OP09', 'Emperors in the New World', 'op-09', '2024-08-31'],
].map(([game, lang, code, name, slug, releaseDate]) => ({
  id: `set-${game}-${lang}-${slug}`,
  game: game as Game,
  lang: lang as Lang,
  code: code!,
  name: name!,
  slug: slug!,
  releaseDate: releaseDate!,
  totalCards: null,
  updatedAt: '2026-09-27T00:00:00Z',
  intro: `${name} is a ${game === 'pokemon' ? 'Pokémon TCG' : 'One Piece Card Game'} set in ${lang === 'jp' ? 'Japanese' : 'English'}. Demo intro copy: real set pages carry unique editorial copy plus set market cap, top cards and pull rates where known.`,
}))

const CARD_SPECS: [Game, Lang, string, string, string | null, string, string][] = [
  // game, lang, set slug, number, printed total, variant, name
  ['pokemon', 'en', '151', '199', '165', 'sir', 'Charizard ex'],
  ['pokemon', 'en', 'evolving-skies', '215', '203', 'alt-art', 'Umbreon VMAX'],
  ['pokemon', 'en', 'prismatic-evolutions', '161', '131', 'sir', 'Umbreon ex'],
  ['pokemon', 'en', 'scarlet-violet-promos', 'SVP 085', null, 'promo', 'Pikachu with Grey Felt Hat'],
  ['pokemon', 'en', 'base-set', '4', '102', 'holo', 'Charizard'],
  ['pokemon', 'jp', 'sv2a-pokemon-card-151', '201', '165', 'sar', 'Charizard ex'],
  ['pokemon', 'jp', 's6a-eevee-heroes', '095', '069', 'sa', 'Umbreon VMAX'],
  ['pokemon', 'jp', 'sv8-super-electric-breaker', '132', '106', 'sar', 'Pikachu ex'],
  ['pokemon', 'jp', 'sv8a-terastal-festival-ex', '217', '187', 'sar', 'Umbreon ex'],
  ['pokemon', 'jp', 'expansion-pack', '006', null, 'holo', 'Charizard'],
  ['one-piece', 'en', 'op-05', 'OP05-119', null, 'manga', 'Monkey.D.Luffy'],
  ['one-piece', 'jp', 'op-05', 'OP05-119', null, 'manga', 'Monkey.D.Luffy'],
  ['one-piece', 'en', 'op-01', 'OP01-120', null, 'manga', 'Shanks'],
  ['one-piece', 'jp', 'op-01', 'OP01-120', null, 'manga', 'Shanks'],
  ['one-piece', 'en', 'op-06', 'OP06-118', null, 'manga', 'Roronoa Zoro'],
  ['one-piece', 'jp', 'op-06', 'OP06-118', null, 'manga', 'Roronoa Zoro'],
  ['one-piece', 'en', 'op-09', 'OP09-118', null, 'manga', 'Gol.D.Roger'],
  ['one-piece', 'jp', 'op-09', 'OP09-118', null, 'manga', 'Gol.D.Roger'],
  ['one-piece', 'en', 'op-02', 'OP02-013', null, 'manga', 'Portgas.D.Ace'],
  ['one-piece', 'jp', 'op-02', 'OP02-013', null, 'manga', 'Portgas.D.Ace'],
]

const CARDS: CardRow[] = CARD_SPECS.map(([game, lang, setSlug, number, printedTotal, variant, name]) => {
  const set = SETS.find((s) => s.game === game && s.lang === lang && s.slug === setSlug)!
  const variantSuffix = game === 'one-piece' && variant === 'manga' ? '-manga' : ''
  const slug = `${slugify(number)}-${slugify(name)}${variantSuffix}`
  return {
    id: `card-${game}-${lang}-${slugify(number)}`,
    setId: set.id,
    game,
    lang,
    setSlug,
    setName: set.name,
    setCode: set.code,
    number,
    printedTotal,
    name,
    slug,
    variant,
    rarity: variant.toUpperCase(),
    // One preview card with an image (served from public/demo/) so the image paths are exercised.
    imageUrl: game === 'pokemon' && lang === 'en' && number === '199' ? '/demo/card.webp' : null,
    psaSpecId: null,
    counterpartCardId: null,
    externalIds: [],
    updatedAt: '2026-09-27T00:00:00Z',
  }
})
// JP <-> EN counterparts (same game, other language; linked, never merged).
// In production these links are curated by an admin (docs/research/03).
const COUNTERPARTS: [string, string][] = [
  ['card-pokemon-en-199', 'card-pokemon-jp-201'],
  ['card-pokemon-en-215', 'card-pokemon-jp-095'],
  ['card-pokemon-en-161', 'card-pokemon-jp-217'],
  ['card-pokemon-en-4', 'card-pokemon-jp-006'],
  ...CARDS.filter((c) => c.game === 'one-piece' && c.lang === 'en').map(
    (c): [string, string] => [c.id, c.id.replace('-en-', '-jp-')],
  ),
]
for (const [en, jp] of COUNTERPARTS) {
  const a = CARDS.find((c) => c.id === en)
  const b = CARDS.find((c) => c.id === jp)
  if (a && b) {
    a.counterpartCardId = b.id
    b.counterpartCardId = a.id
  }
}

const GRADES = ['psa-10', 'psa-9', 'psa-8']
// Other companies: a value but no population (market cap uses PSA grades).
const OTHER_GRADES = ['bgs-10', 'bgs-9.5', 'cgc-10', 'sgc-10']
const OTHER_FACTOR: Record<string, number> = { 'bgs-10': 1.6, 'bgs-9.5': 0.7, 'cgc-10': 0.75, 'sgc-10': 0.7 }
const AS_OF = '2026-09-27'

function gradeData(card: CardRow, gradeKey: string) {
  const r = rand(card.id + gradeKey)
  const g = GRADES.indexOf(gradeKey)
  const base = 300 + rand(card.id) * 9000
  // Raw (ungraded Near Mint): the main market price, no population.
  if (gradeKey === 'raw') return { population: null, floorAud: Math.round(base * (0.08 + r * 0.08)), marketCapAud: null }
  if (g < 0) return { population: null, floorAud: Math.round(base * (OTHER_FACTOR[gradeKey] ?? 0.5)), marketCapAud: null }
  const population = Math.round((200 + r * 4000) * [1, 1.8, 0.9][g]!)
  const floorAud = Math.round(base * [1, 0.35, 0.2][g]!)
  return { population, floorAud, marketCapAud: population * floorAud }
}

const SELLERS: SellerRow[] = [
  { username: 'melbourne-slabs', displayName: 'Melbourne Slabs', state: 'VIC', memberSince: '2026-02-01', premium: true, responseRate: 0.97 },
  { username: 'op-collector-bne', displayName: 'OP Collector BNE', state: 'QLD', memberSince: '2026-05-12', premium: false, responseRate: 0.88 },
]

const LISTINGS: ListingRow[] = [
  mkListing(100001, 'melbourne-slabs', 'card-pokemon-en-199', 'PSA', 10, 4650, 'VIC', 'active'),
  mkListing(100002, 'op-collector-bne', 'card-pokemon-en-199', 'PSA', 10, 4890, 'QLD', 'active'),
  mkListing(100003, 'melbourne-slabs', 'card-pokemon-en-199', 'PSA', 9, 1450, 'VIC', 'active'),
  mkListing(100004, 'op-collector-bne', 'card-one-piece-jp-op05-119', 'PSA', 10, 9800, 'QLD', 'active'),
  mkListing(100005, 'melbourne-slabs', 'card-one-piece-en-op05-119', 'PSA', 10, 21500, 'VIC', 'sold'),
]

function mkListing(id: number, seller: string, cardId: string, grader: string, grade: number, priceAud: number, state: string, status: ListingRow['status']): ListingRow {
  const card = CARDS.find((c) => c.id === cardId)!
  const s = SELLERS.find((x) => x.username === seller)!
  return {
    id,
    sellerUsername: seller,
    sellerPremium: s.premium,
    sellerSince: s.memberSince,
    cardId,
    sealedProductId: null,
    listingType: 'graded_single',
    lang: card.lang,
    grader,
    grade,
    gradeKey: `${grader.toLowerCase()}-${grade}`,
    condition: null,
    certNumber: String(80000000 + id),
    certVerified: true,
    title: `${card.name} ${card.number} ${card.lang.toUpperCase()} ${grader} ${grade}`,
    description: 'Demo listing. Slab is clean, no scratches. Tracked and insured shipping Australia-wide, or pickup.',
    priceAud,
    qty: 1,
    state,
    status,
    approvedAt: '2026-09-20T10:00:00Z',
    closedAt: status === 'sold' ? '2026-09-25T10:00:00Z' : null,
    images: [],
  }
}

const RETAILERS: RetailerRow[] = [
  { slug: 'premium-bandai-au', name: 'Premium Bandai AU', baseUrl: 'https://p-bandai.com/au', enabled: false, monitored: true, platform: 'custom', kind: 'official', state: null, blockedReason: null, lastCheckedAt: null, watchIntervalSeconds: null },
  { slug: 'jb-hi-fi', name: 'JB Hi-Fi', baseUrl: 'https://www.jbhifi.com.au', enabled: false, monitored: true, platform: 'custom', kind: 'big-box', state: null, blockedReason: null, lastCheckedAt: null, watchIntervalSeconds: null },
  { slug: 'eb-games', name: 'EB Games', baseUrl: 'https://www.ebgames.com.au', enabled: false, monitored: true, platform: 'custom', kind: 'big-box', state: null, blockedReason: null, lastCheckedAt: null, watchIntervalSeconds: null },
  { slug: 'big-w', name: 'BIG W', baseUrl: 'https://www.bigw.com.au', enabled: false, monitored: true, platform: 'custom', kind: 'big-box', state: null, blockedReason: null, lastCheckedAt: null, watchIntervalSeconds: null },
  { slug: 'kmart', name: 'Kmart', baseUrl: 'https://www.kmart.com.au', enabled: false, monitored: true, platform: 'custom', kind: 'big-box', state: null, blockedReason: null, lastCheckedAt: null, watchIntervalSeconds: null },
  { slug: 'target-au', name: 'Target', baseUrl: 'https://www.target.com.au', enabled: false, monitored: true, platform: 'custom', kind: 'big-box', state: null, blockedReason: null, lastCheckedAt: null, watchIntervalSeconds: null },
  { slug: 'toymate', name: 'Toymate', baseUrl: 'https://www.toymate.com.au', enabled: false, monitored: false, platform: 'none', kind: 'toy', state: null, blockedReason: null, lastCheckedAt: null, watchIntervalSeconds: null },
  { slug: 'local-game-store', name: 'Independent game store', baseUrl: 'https://tcgtracker.com.au', enabled: false, monitored: false, platform: 'none', kind: 'specialist', state: null, blockedReason: null, lastCheckedAt: null, watchIntervalSeconds: null },
  // Fictional stores showing a live public-catalogue monitor and a store that blocks automated access.
  { slug: 'demo-card-shop', name: 'Demo Card Shop', baseUrl: 'https://example.com', enabled: true, monitored: true, platform: 'shopify', kind: 'specialist', state: 'VIC', blockedReason: null, lastCheckedAt: '2026-09-26T21:04:00Z', watchIntervalSeconds: 120 },
  { slug: 'demo-hobby-store', name: 'Demo Hobby Store', baseUrl: 'https://example.org', enabled: false, monitored: true, platform: 'woocommerce', kind: 'specialist', state: 'QLD', blockedReason: 'Asks automated visitors to pass a challenge', lastCheckedAt: '2026-09-20T03:00:00Z', watchIntervalSeconds: 300 },
]

const DROPS: DropRow[] = [
  { id: 1, source: 'monitor', retailerSlug: 'jb-hi-fi', retailerName: 'JB Hi-Fi', title: 'Pokémon TCG: Mega Evolutions Elite Trainer Box', url: 'https://www.jbhifi.com.au/', eventType: 'IN_STOCK', priceAud: 89.95, rrpAud: 89.95, rrpTag: 'AT_RRP', rrpDeltaPct: 0, game: 'pokemon', occurredAt: '2026-09-26T21:02:00Z', sighting: null, previousPriceAud: null, product: { id: 'sp-demo-1', game: 'pokemon', lang: 'en', slug: 'demo-expansion-elite-trainer-box', name: 'Demo expansion Elite Trainer Box' }, imageUrl: null, cartUrl: 'https://www.jbhifi.com.au/cart/40429703233737:1' },
  {
    id: 3, source: 'member', retailerSlug: 'kmart', retailerName: 'Kmart', title: 'Pokémon TCG booster bundles (demo sighting)', url: null, eventType: 'IN_STOCK', priceAud: 39, rrpAud: 39, rrpTag: 'AT_RRP', rrpDeltaPct: 0, game: 'pokemon', occurredAt: '2026-09-26T08:40:00Z',
    previousPriceAud: null, product: null, imageUrl: null, cartUrl: null,
    sighting: { id: 1, channel: 'in_store', state: 'VIC', suburb: 'Chadstone', storeName: null, quantity: 'some', purchaseLimit: 2, photoUrl: null, note: 'Restocked in the toy aisle end cap.', confirmations: 3, goneAt: null, reporter: null },
  },
  {
    id: 4, source: 'member', retailerSlug: 'big-w', retailerName: 'BIG W', title: 'One Piece Card Game booster box (demo sighting)', url: null, eventType: 'IN_STOCK', priceAud: 199, rrpAud: 199, rrpTag: 'AT_RRP', rrpDeltaPct: 0, game: 'one-piece', occurredAt: '2026-09-25T23:15:00Z',
    previousPriceAud: null, product: null, imageUrl: null, cartUrl: null,
    sighting: { id: 2, channel: 'in_store', state: 'NSW', suburb: 'Parramatta', storeName: 'Westfield Parramatta', quantity: 'few', purchaseLimit: 1, photoUrl: null, note: null, confirmations: 2, goneAt: '2026-09-26T02:00:00Z', reporter: null },
  },
  {
    id: 5, source: 'monitor', retailerSlug: 'demo-card-shop', retailerName: 'Demo Card Shop', title: 'Pokémon TCG Demo Expansion Elite Trainer Box', url: 'https://example.com/products/demo-etb', eventType: 'PRICE_CHANGE', priceAud: 79, rrpAud: 89.95, rrpTag: 'BELOW_RRP', rrpDeltaPct: -12.2, game: 'pokemon', occurredAt: '2026-09-26T10:30:00Z',
    sighting: null, previousPriceAud: 89.95, product: { id: 'sp-demo-1', game: 'pokemon', lang: 'en', slug: 'demo-expansion-elite-trainer-box', name: 'Demo expansion Elite Trainer Box' }, imageUrl: null, cartUrl: null,
  },
  {
    id: 6, source: 'monitor', retailerSlug: 'demo-card-shop', retailerName: 'Demo Card Shop', title: 'One Piece Card Game Demo Premium Booster Box', url: 'https://example.com/products/demo-op-box', eventType: 'NEW_LISTING', priceAud: 235, rrpAud: 219, rrpTag: 'ABOVE_RRP', rrpDeltaPct: 7.3, game: 'one-piece', occurredAt: '2026-09-25T06:10:00Z',
    sighting: null, previousPriceAud: null, product: { id: 'sp-demo-2', game: 'one-piece', lang: 'en', slug: 'demo-premium-booster-box', name: 'Demo One Piece premium booster box' }, imageUrl: null, cartUrl: null,
  },
  { id: 2, source: 'monitor', retailerSlug: 'premium-bandai-au', retailerName: 'Premium Bandai AU', title: 'One Piece Card Game Premium Booster PRB-02', url: 'https://p-bandai.com/au', eventType: 'PREORDER_OPEN', priceAud: 229, rrpAud: 219, rrpTag: 'ABOVE_RRP', rrpDeltaPct: 4.6, game: 'one-piece', occurredAt: '2026-09-25T01:00:00Z', sighting: null, previousPriceAud: null, product: null, imageUrl: null, cartUrl: null },
]

const SEALED: SealedProductRow[] = [
  {
    id: 'sp-demo-1', game: 'pokemon', lang: 'en', slug: 'demo-expansion-elite-trainer-box', name: 'Demo expansion Elite Trainer Box', type: 'etb', imageUrl: '/demo/sealed.webp',
    rrpAud: 89.95, releaseDate: '2026-09-26', set: null, inStockCount: 2, lowestInStockAud: 79, updatedAt: '2026-09-26T21:02:00Z',
    offers: [
      { retailerSlug: 'demo-card-shop', retailerName: 'Demo Card Shop', title: 'Pokémon TCG Demo Expansion Elite Trainer Box', url: 'https://example.com/products/demo-etb', availability: 'in_stock_online', priceAud: 79, lastChangeAt: '2026-09-26T10:30:00Z', imageUrl: null, cartUrl: null },
      { retailerSlug: 'jb-hi-fi', retailerName: 'JB Hi-Fi', title: 'Pokémon TCG: Demo Expansion Elite Trainer Box', url: 'https://www.jbhifi.com.au/', availability: 'in_stock_online', priceAud: 89.95, lastChangeAt: '2026-09-26T21:02:00Z', imageUrl: null, cartUrl: 'https://www.jbhifi.com.au/cart/40429703233737:1' },
      { retailerSlug: 'big-w', retailerName: 'BIG W', title: 'Pokemon TCG Demo Expansion ETB', url: 'https://www.bigw.com.au/', availability: 'out_of_stock', priceAud: 89, lastChangeAt: '2026-09-24T03:00:00Z', imageUrl: null, cartUrl: null },
    ],
  },
  {
    id: 'sp-demo-2', game: 'one-piece', lang: 'en', slug: 'demo-premium-booster-box', name: 'Demo One Piece premium booster box', type: 'booster-box', imageUrl: null,
    rrpAud: 219, releaseDate: null, set: null, inStockCount: 1, lowestInStockAud: 235, updatedAt: '2026-09-25T06:10:00Z',
    offers: [
      { retailerSlug: 'demo-card-shop', retailerName: 'Demo Card Shop', title: 'One Piece Card Game Demo Premium Booster Box', url: 'https://example.com/products/demo-op-box', availability: 'in_stock_online', priceAud: 235, lastChangeAt: '2026-09-25T06:10:00Z', imageUrl: null, cartUrl: null },
      { retailerSlug: 'premium-bandai-au', retailerName: 'Premium Bandai AU', title: 'One Piece Card Game Premium Booster (demo)', url: 'https://p-bandai.com/au', availability: 'preorder', priceAud: 229, lastChangeAt: '2026-09-25T01:00:00Z', imageUrl: null, cartUrl: null },
    ],
  },
]

const RELEASES: ReleaseRow[] = [
  {
    id: 'rel-demo-1', game: 'pokemon', lang: 'en', slug: 'demo-pokemon-expansion', title: 'Demo Pokémon TCG expansion', kind: 'set_release',
    releaseDate: '2026-11-06', datePrecision: 'day', confidence: 'official', set: null,
    products: [{ name: 'Booster box (36 packs)', type: 'booster-box', rrpAud: null }, { name: 'Elite Trainer Box', type: 'etb', rrpAud: 89.95 }],
    retailerSlugs: ['jb-hi-fi', 'big-w', 'kmart', 'target-au'], summary: 'Demo entry showing how a release looks on the calendar.', bodyMd: null,
    sourceName: 'Demo data', sourceUrl: null, updatedAt: '2026-09-28T00:00:00Z',
  },
  {
    id: 'rel-demo-2', game: 'one-piece', lang: 'en', slug: 'demo-one-piece-booster', title: 'Demo One Piece Card Game booster', kind: 'set_release',
    releaseDate: '2026-11-01', datePrecision: 'month', confidence: 'retailer', set: null,
    products: [{ name: 'Booster box (24 packs)', type: 'booster-box', rrpAud: null }],
    retailerSlugs: ['eb-games', 'premium-bandai-au'], summary: 'Demo entry with month precision.', bodyMd: null,
    sourceName: 'Demo data', sourceUrl: null, updatedAt: '2026-09-28T00:00:00Z',
  },
]

const ARTICLES: ArticleRow[] = [
  {
    slug: 'demo-market-movers-week-39',
    category: 'market',
    title: 'Market movers: week 39 (demo article)',
    dek: 'Demo article showing how auto-generated market recaps link to card pages.',
    bodyMd: 'This is placeholder copy. Real market-mover articles are drafted from our data and reviewed by an editor before publishing.',
    publishedAt: '2026-09-26T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
    seoTitle: null,
    seoDescription: null,
    heroImageUrl: null,
    tags: { cardIds: ['card-pokemon-en-199', 'card-one-piece-en-op05-119'], setIds: [], games: ['pokemon', 'one-piece'] },
  },
]

function history(seed: string, base: number, days = 30): HistoryPoint[] {
  const out: HistoryPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(2026, 8, 27) - i * 86_400_000)
    out.push({ date: d.toISOString().slice(0, 10), value: Math.round(base * (0.9 + rand(seed + i) * 0.2)) })
  }
  return out
}

function paginate<T>(rows: T[], page: number, pageSize: number): Paged<T> {
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize }
}

export const demoRepository: Repository = {
  isDemo: true,
  async getRules() {
    return DEFAULT_RULES
  },
  async listSets(filter) {
    return SETS.filter((s) => (!filter?.game || s.game === filter.game) && (!filter?.lang || s.lang === filter.lang))
  },
  async getSet(game, lang, slug) {
    return SETS.find((s) => s.game === game && s.lang === lang && s.slug === slug) ?? null
  },
  async listCardsInSet(setId) {
    return CARDS.filter((c) => c.setId === setId)
  },
  async sitemapCardCount() {
    return CARDS.length
  },
  async sitemapCards(offset, limit) {
    return [...CARDS]
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(offset, offset + limit)
      .map((c) => ({ id: c.id, game: c.game, lang: c.lang, setSlug: c.setSlug, slug: c.slug, updatedAt: c.updatedAt, listed: LISTINGS.some((l) => l.cardId === c.id && l.status === 'active') }))
  },
  async getCard(game, lang, setSlug, cardSlug) {
    return CARDS.find((c) => c.game === game && c.lang === lang && c.setSlug === setSlug && c.slug === cardSlug) ?? null
  },
  async getCardsByIds(ids) {
    return CARDS.filter((c) => ids.includes(c.id))
  },
  async searchCards(q, limit) {
    const needle = q.toLowerCase()
    return CARDS.filter((c) => `${c.name} ${c.number} ${c.setName}`.toLowerCase().includes(needle)).slice(0, limit)
  },
  async marketCap(query: MarketQuery) {
    const grades = query.gradeKey === 'all' ? ['raw', ...GRADES] : [query.gradeKey]
    let rows = CARDS.filter(
      (c) =>
        (!query.game || c.game === query.game) &&
        (!query.lang || c.lang === query.lang) &&
        (!query.setId || c.setId === query.setId) &&
        (!query.q || `${c.name} ${c.number}`.toLowerCase().includes(query.q.toLowerCase())),
    ).flatMap((card) =>
      grades.map((gradeKey) => {
        const d = gradeData(card, gradeKey)
        return {
          rank: 0,
          card,
          gradeKey,
          population: d.population,
          floorAud: d.floorAud,
          basis: LISTINGS.some((l) => l.cardId === card.id && l.gradeKey === gradeKey && l.status === 'active') ? 'marketplace_ask' : 'external_ask',
          marketCapAud: d.marketCapAud,
          psa10Aud: gradeData(card, 'psa-10').floorAud,
          spark7d: history(card.id + gradeKey + 'sp', d.floorAud, 8).map((h) => h.value),
          change1d: Math.round((rand(card.id + 'd1') - 0.5) * 60) / 10,
          change7d: Math.round((rand(card.id + 'd7') - 0.5) * 200) / 10,
          change30d: Math.round((rand(card.id + 'd30') - 0.5) * 400) / 10,
          asOf: AS_OF,
        } satisfies MarketRow
      }),
    )
    rows.sort((a, b) => (b.marketCapAud ?? b.floorAud) - (a.marketCapAud ?? a.floorAud))
    rows = rows.map((r, i) => ({ ...r, rank: i + 1 }))
    const key: Record<MarketQuery['sort'], (r: MarketRow) => number> = {
      market_cap: (r) => r.marketCapAud ?? r.floorAud,
      population: (r) => r.population ?? -1,
      floor: (r) => r.floorAud,
      change_7d: (r) => r.change7d ?? 0,
      change_30d: (r) => r.change30d ?? 0,
    }
    const dir = query.order === 'asc' ? 1 : -1
    rows.sort((a, b) => dir * (key[query.sort](a) - key[query.sort](b)))
    return { ...paginate(rows, query.page, query.pageSize), asOf: AS_OF }
  },
  async cardGrades(cardId) {
    const card = CARDS.find((c) => c.id === cardId)
    if (!card) return []
    return ['raw', ...GRADES, ...OTHER_GRADES].map((gradeKey): GradeRow => {
      const d = gradeData(card, gradeKey)
      return { gradeKey, population: d.population, floorAud: d.floorAud, basis: 'external_ask', source: 'demo', sampleSize: 3, marketCapAud: d.marketCapAud, lastSoldAud: Math.round(d.floorAud * 0.97), medianSold30dAud: Math.round(d.floorAud * 0.95), observedAt: `${AS_OF}T06:00:00Z` }
    })
  },
  async popHistory(cardId, gradeKey) {
    const card = CARDS.find((c) => c.id === cardId)
    const pop = card ? gradeData(card, gradeKey).population : null
    return card && pop !== null ? history(cardId + 'pop', pop) : []
  },
  async marketCapHistory(cardId, gradeKey) {
    const card = CARDS.find((c) => c.id === cardId)
    const mc = card ? gradeData(card, gradeKey).marketCapAud : null
    return card && mc !== null ? history(cardId + 'mc', mc) : []
  },
  async valueHistory(cardId, gradeKey) {
    const card = CARDS.find((c) => c.id === cardId)
    return card ? history(cardId + 'val' + gradeKey, gradeData(card, gradeKey).floorAud, 90) : []
  },
  async listingStats(cardIds) {
    const out = new Map<string, ListingStats>()
    for (const l of LISTINGS) {
      if (l.status !== 'active' || !l.cardId || !cardIds.includes(l.cardId)) continue
      const k = `${l.cardId}|${l.gradeKey}`
      const cur = out.get(k) ?? { cardId: l.cardId, gradeKey: l.gradeKey, activeCount: 0, lowestPriceAud: null }
      cur.activeCount += 1
      cur.lowestPriceAud = cur.lowestPriceAud === null ? l.priceAud : Math.min(cur.lowestPriceAud, l.priceAud)
      out.set(k, cur)
    }
    return [...out.values()]
  },
  async listingsForCard(cardId, opts) {
    return LISTINGS.filter(
      (l) =>
        l.cardId === cardId &&
        (!opts.gradeKey || l.gradeKey === opts.gradeKey) &&
        (opts.status === 'active' ? l.status === 'active' : l.status === 'sold' || l.status === 'expired'),
    ).sort((a, b) => a.priceAud - b.priceAud)
  },
  async marketplace(query: MarketplaceQuery) {
    const rows = LISTINGS.filter((l) => {
      const card = CARDS.find((c) => c.id === l.cardId)
      return (
        l.status === 'active' &&
        (!query.game || card?.game === query.game) &&
        (!query.lang || l.lang === query.lang) &&
        (!query.gradeKey || l.gradeKey === query.gradeKey) &&
        (!query.state || l.state === query.state) &&
        (!query.listingType || l.listingType === query.listingType) &&
        (query.priceMin === undefined || l.priceAud >= query.priceMin) &&
        (query.priceMax === undefined || l.priceAud <= query.priceMax) &&
        (!query.q || l.title.toLowerCase().includes(query.q.toLowerCase()))
      )
    })
    rows.sort((a, b) => (query.sort === 'price-asc' ? a.priceAud - b.priceAud : query.sort === 'price-desc' ? b.priceAud - a.priceAud : b.id - a.id))
    return paginate(rows, query.page, query.pageSize)
  },
  async getListing(id) {
    return LISTINGS.find((l) => l.id === id) ?? null
  },
  async getSeller(username) {
    return SELLERS.find((s) => s.username === username) ?? null
  },
  async listingsBySeller(username) {
    return LISTINGS.filter((l) => l.sellerUsername === username && l.status === 'active')
  },
  async retailers() {
    return RETAILERS
  },
  async stockOverview(filter) {
    // Mirrors stock_overview(): counts from every product page's offers.
    const products = SEALED.filter((p) => !filter?.game || p.game === filter.game)
    return {
      stores: RETAILERS.map((r) => {
        const offers = products.flatMap((p) => p.offers).filter((o) => o.retailerSlug === r.slug)
        const changes = offers.map((o) => o.lastChangeAt).filter((x): x is string => Boolean(x)).sort()
        return {
          ...r,
          listings: offers.length,
          inStock: offers.filter((o) => isInStock(o.availability)).length,
          preorder: offers.filter((o) => o.availability === 'preorder').length,
          lastChangeAt: changes.at(-1) ?? null,
        }
      }),
      events7d: DROPS.length,
    }
  },
  async storeListings(slug, filter) {
    return sortListings(
      SEALED.filter((p) => !filter?.game || p.game === filter.game).flatMap((p) =>
        p.offers
          .filter((o) => o.retailerSlug === slug)
          .map((o) => ({
            title: o.title,
            url: o.url,
            availability: o.availability,
            priceAud: o.priceAud,
            lastChangeAt: o.lastChangeAt,
            cartUrl: o.cartUrl,
            lastSeenAt: o.lastChangeAt,
            imageUrl: o.imageUrl,
            game: p.game,
            product: { id: p.id, game: p.game, lang: p.lang, slug: p.slug, name: p.name, rrpAud: p.rrpAud },
          })),
      ),
    ).slice(0, filter?.limit ?? 1000)
  },
  async drops(filter) {
    return DROPS.filter(
      (d) =>
        (!filter?.retailerSlug || d.retailerSlug === filter.retailerSlug) &&
        (!filter?.state || d.sighting?.state === filter.state) &&
        (!filter?.game || d.game === filter.game) &&
        (!filter?.source || d.source === filter.source),
    )
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, filter?.limit ?? 50)
  },
  async scoutLeaderboard() {
    return [
      { username: 'demo-scout', confirmed: 12, states: ['VIC'] },
      { username: 'sydney-pulls', confirmed: 7, states: ['NSW'] },
    ]
  },
  async releases(filter) {
    return sortReleases(RELEASES.filter((r) => (!filter?.game || r.game === filter.game) && (!filter?.from || !r.releaseDate || r.releaseDate >= filter.from)))
  },
  async deals() {
    const card = CARDS[0]
    if (!card) return []
    return [
      {
        id: 1, itemId: 'demo-1', card, gradeKey: 'psa-10', title: `${card.name} ${card.number} PSA 10 (demo deal)`, buyingOption: 'FIXED_PRICE',
        priceAud: 720, shippingAud: 12, marketAud: 1000, discountPct: 28, bidCount: null, endTime: null,
        url: 'https://www.ebay.com.au/', imageUrl: null, foundAt: '2026-09-26T09:00:00Z', goneAt: null,
      },
    ]
  },
  async inStock(filter) {
    // Mirrors the Supabase inner join: only the offers that are in stock / on pre-order (at that store, when filtered).
    const live = (o: SealedProductRow['offers'][number]) => o.availability !== 'out_of_stock' && o.availability !== 'unknown' && (!filter?.retailerSlug || o.retailerSlug === filter.retailerSlug)
    return SEALED.filter((p) => (!filter?.game || p.game === filter.game) && p.offers.some(live))
      .map((p) => ({ ...p, offers: p.offers.filter(live) }))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, filter?.limit ?? 100)
  },
  async listSealedProducts(filter) {
    return SEALED.filter((p) => (!filter?.game || p.game === filter.game) && (!filter?.lang || p.lang === filter.lang)).slice(0, filter?.limit ?? 500)
  },
  async getSealedProduct(game, lang, slug) {
    return SEALED.find((p) => p.game === game && p.lang === lang && p.slug === slug) ?? null
  },
  async productDrops(sealedProductId) {
    return DROPS.filter((d) => d.product?.id === sealedProductId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  },
  async productWatchCount() {
    return 0
  },
  async getRelease(game, slug) {
    return RELEASES.find((r) => r.game === game && r.slug === slug) ?? null
  },
  async articles(filter) {
    return ARTICLES.filter((a) => !filter?.category || a.category === filter.category).slice(0, filter?.limit ?? 50)
  },
  async getArticle(year, slug) {
    return ARTICLES.find((a) => a.slug === slug && new Date(a.publishedAt).getUTCFullYear() === year) ?? null
  },
  async articlesForCard(cardId) {
    return ARTICLES.filter((a) => a.tags.cardIds.includes(cardId))
  },
  async redirectFor(path) {
    // Demo of the redirects table: an old card slug that was renamed.
    if (path === '/cards/pokemon/en/151/199-charizard/') return { to: '/cards/pokemon/en/151/199-charizard-ex/', code: 301 }
    return null
  },
}
