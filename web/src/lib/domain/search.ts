/**
 * Product search and ordering for the stock and drops lists: a forgiving
 * wildcard search over product names, the EN/JP language of a listing, and
 * the default "in stock first, the sought-after product types first" order.
 * Client-safe: no data access here.
 */
import type { Availability, SealedProductRow } from '@/lib/data/types'
import { isInStock } from '@/lib/data/drops'
import { isLang, type Lang } from '@/lib/seo/urls'

// ------------------------------------------------------------------ search

/** Lowercase, accents off ("Pokémon" → "pokemon"), punctuation to spaces, "&" kept as "and". */
export function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}*?]+/gu, ' ')
    .trim()
}

/** Short names people search for, added to a product's searchable text when its name has the long form. */
const ALIASES: [RegExp, string][] = [
  [/\belite trainer box\b/, 'etb'],
  [/\bultra premium collection\b/, 'upc'],
  [/\bsuper premium collection\b/, 'spc'],
  [/\bbooster box\b/, 'bb'],
  [/\bjapanese\b|\bjapan\b/, 'jp jpn'],
  [/\bpokemon center\b/, 'pc'],
]

export function searchText(...parts: (string | null | undefined)[]): string {
  const base = normalise(parts.filter(Boolean).join(' '))
  const extra = ALIASES.filter(([re]) => re.test(base)).map(([, a]) => a)
  return extra.length ? `${base} ${extra.join(' ')}` : base
}

const escape = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')

/**
 * A search query as a matcher. Every word must appear (in any order); `*`
 * stands for any run of characters and `?` for one character, so
 * `char*ex` finds "Charizard ex" and `sv?a` finds "SV2a". "Quoted words"
 * must appear together. Empty or wildcard-only queries match everything.
 */
export function parseQuery(raw: string | null | undefined): ((text: string) => boolean) | null {
  const q = (raw ?? '').slice(0, 80)
  const terms: string[] = []
  for (const m of q.matchAll(/"([^"]*)"|(\S+)/g)) {
    const t = normalise(m[1] ?? m[2] ?? '')
    if (t.replace(/[*?\s]/g, '')) terms.push(t)
  }
  if (terms.length === 0) return null
  const res = terms.map((t) => new RegExp(escape(t).replace(/\*/g, '.*').replace(/\?/g, '.')))
  return (text) => res.every((re) => re.test(text))
}

/** Rows whose name matches the query; all rows when the query is empty. */
export function searchRows<T>(rows: T[], query: string | null | undefined, text: (row: T) => string): T[] {
  const match = parseQuery(query)
  return match ? rows.filter((r) => match(text(r))) : rows
}

/** The ?q= value, trimmed and capped. */
export function parseSearch(raw: string | string[] | undefined): string | undefined {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80)
  return v || undefined
}

// ---------------------------------------------------------------- language

/** The ?lang= value: `en` or `jp`. */
export function parseLang(raw: string | string[] | undefined): Lang | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v && isLang(v) ? v : undefined
}

/** A listing's language: its product page's when we know it, else Japanese when the title says so. */
export function listingLang(title: string, product?: { lang: Lang } | null): Lang {
  if (product) return product.lang
  return /\b(japanese|japan|jpn|jp)\b/.test(normalise(title)) ? 'jp' : 'en'
}

// ----------------------------------------------------------- product types

/**
 * How sought-after a product type is, 0 first: booster boxes and displays;
 * Elite Trainer Boxes and premium collections (Ultra Premium Collection, One
 * Piece Premium Booster, Illustration Box, Gift Collection); packs, bundles
 * and blisters; tins, decks and other collections; then everything else.
 */
export const TYPE_TIERS = [
  { slug: 'booster-boxes', label: 'Booster boxes' },
  { slug: 'etb-premium', label: 'ETBs & premium collections' },
  { slug: 'packs', label: 'Packs, bundles & blisters' },
  { slug: 'tins-decks', label: 'Tins, decks & collections' },
  { slug: 'other', label: 'Other' },
] as const

/** The ?type= value as a tier index. */
export function parseTier(raw: string | string[] | undefined): number | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw
  const i = TYPE_TIERS.findIndex((t) => t.slug === v)
  return i === -1 ? undefined : i
}

const TIER_PATTERNS: RegExp[] = [
  /\bbooster (box|display|case)\b|\bdisplay box\b|\bbooster box\b|\bbox of \d+\b/,
  /\belite trainer\b|\betb\b|\b(ultra|super) premium collection\b|\bpremium collection\b|\bspecial collection\b|\bpremium booster\b|\billustration box\b|\bgift collection\b|\bpremium card collection\b|\banniversary set\b/,
  /\bbooster (bundle|pack|blister)\b|\bbundle\b|\bblister\b|\bsleeved booster\b|\bdouble pack\b|\bpacks?\b|\bboosters?\b/,
  /\btins?\b|\b(starter|battle|theme|league battle|ex battle|build and battle) deck\b|\bdecks?\b|\bcollection\b|\bbinder\b|\bbuild and battle\b/,
]

/** Tier (0–4) from a product's name and, when we have it, its catalogue type ("booster-box", "etb"...). */
export function productTier(name: string, type?: string | null): number {
  const text = normalise(`${name} ${type ? type.replace(/-/g, ' ') : ''}`)
  const i = TIER_PATTERNS.findIndex((re) => re.test(text))
  return i === -1 ? TIER_PATTERNS.length : i
}

// ---------------------------------------------------------------- ordering

/** In stock first, then pre-order, then sold out, then unknown. */
export function availabilityRank(a: Availability): number {
  if (isInStock(a)) return 0
  if (a === 'preorder') return 1
  if (a === 'out_of_stock') return 2
  return 3
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0)

/**
 * The default order for stock lists: in stock first, then the sought-after
 * product types, then the most recent change, then name.
 */
export function compareStock(
  a: { availability: Availability; title: string; type?: string | null; lastChangeAt?: string | null },
  b: { availability: Availability; title: string; type?: string | null; lastChangeAt?: string | null },
): number {
  return (
    availabilityRank(a.availability) - availabilityRank(b.availability) ||
    productTier(a.title, a.type) - productTier(b.title, b.type) ||
    time(b.lastChangeAt) - time(a.lastChangeAt) ||
    a.title.localeCompare(b.title)
  )
}

/** Product grid order. `recommended` (the default): in stock before pre-order only, sought-after types first, most stores first. */
export const PRODUCT_SORTS = ['recommended', 'price-asc', 'price-desc', 'newest'] as const
export type ProductSort = (typeof PRODUCT_SORTS)[number]
export const PRODUCT_SORT_LABEL: Record<ProductSort, string> = { recommended: 'In stock first', 'price-asc': 'Price: low to high', 'price-desc': 'Price: high to low', newest: 'Recently changed' }
export function parseProductSort(raw: string | string[] | undefined): ProductSort {
  const v = Array.isArray(raw) ? raw[0] : raw
  return (PRODUCT_SORTS as readonly string[]).includes(v ?? '') ? (v as ProductSort) : 'recommended'
}

type ProductForSort = Pick<SealedProductRow, 'name' | 'type' | 'inStockCount' | 'lowestInStockAud' | 'offers' | 'updatedAt'>

/** Lowest in-stock price, else lowest pre-order price, else null. */
function livePrice(p: ProductForSort): number | null {
  if (p.lowestInStockAud !== null) return p.lowestInStockAud
  const pre = p.offers.filter((o) => o.availability === 'preorder' && o.priceAud !== null).map((o) => o.priceAud as number)
  return pre.length ? Math.min(...pre) : null
}

export function sortProducts<T extends ProductForSort>(rows: T[], sort: ProductSort): T[] {
  const out = [...rows]
  const updated = (p: T) => p.updatedAt ?? ''
  if (sort === 'price-asc') return out.sort((a, b) => (livePrice(a) ?? Infinity) - (livePrice(b) ?? Infinity))
  if (sort === 'price-desc') return out.sort((a, b) => (livePrice(b) ?? -Infinity) - (livePrice(a) ?? -Infinity))
  if (sort === 'newest') return out.sort((a, b) => updated(b).localeCompare(updated(a)))
  return out.sort(
    (a, b) =>
      Number(b.inStockCount > 0) - Number(a.inStockCount > 0) ||
      productTier(a.name, a.type) - productTier(b.name, b.type) ||
      b.inStockCount - a.inStockCount ||
      updated(b).localeCompare(updated(a)) ||
      a.name.localeCompare(b.name),
  )
}
