/**
 * Metadata templates per page type (brief 7.2, 7.3): unique titles and
 * descriptions, self-referencing canonicals, facet handling and pagination.
 */
import type { Metadata } from 'next'
import { absoluteUrl, DEFAULT_OG_IMAGE, siteName } from './urls'

/**
 * Query params that never create a new indexable page. Any of these (except
 * `page`) means "filtered view": canonical to the unfiltered page and
 * noindex,follow. `page` is kept: each page is self-canonical.
 */
export const FACET_PARAMS = ['grade', 'sort', 'order', 'q', 'price_min', 'price_max', 'state', 'type', 'set', 'lang', 'game', 'view'] as const

export type SearchParams = Record<string, string | string[] | undefined>

export interface PageSeoInput {
  path: string // canonical path of the unfiltered page, with trailing slash
  title: string // page-specific part; brand suffix is added here
  description: string
  searchParams?: SearchParams
  noindex?: boolean // account pages, previews, etc.
  ogImage?: string
  ogType?: 'website' | 'article'
}

export function pageNumber(searchParams?: SearchParams): number {
  const raw = searchParams?.page
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isInteger(n) && n > 1 ? n : 1
}

export function isFiltered(searchParams?: SearchParams): boolean {
  if (!searchParams) return false
  return Object.entries(searchParams).some(([k, v]) => k !== 'page' && v !== undefined && v !== '')
}

/** Snippets are cut at ~160 characters; trim at a word boundary instead of mid-word. */
export function clampDescription(text: string, max = 160): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.–-]+$/, '')}…`
}

export function buildMetadata(input: PageSeoInput): Metadata {
  const page = pageNumber(input.searchParams)
  const filtered = isFiltered(input.searchParams)
  const pageSuffix = page > 1 ? ` – Page ${page}` : ''
  // Google shows ~60 characters: keep the brand suffix only when it fits.
  const bare = `${input.title}${pageSuffix}`
  const title = bare.length + siteName().length + 3 <= 60 ? `${bare} | ${siteName()}` : bare
  // Filtered views canonicalise to the clean page; pagination is self-canonical.
  const canonicalPath = filtered ? input.path : page > 1 ? `${input.path}?page=${page}` : input.path
  const index = !input.noindex && !filtered
  return {
    title: { absolute: title },
    // The page number leads so the length clamp can't cut it off (each page's description stays unique).
    description: clampDescription(page > 1 ? `Page ${page}: ${input.description}` : input.description),
    alternates: { canonical: absoluteUrl(canonicalPath) },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      title,
      description: input.description,
      url: absoluteUrl(canonicalPath),
      siteName: siteName(),
      locale: 'en_AU',
      type: input.ogType ?? 'website',
      images: [{ url: input.ogImage ?? absoluteUrl(DEFAULT_OG_IMAGE), width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title, description: input.description },
  }
}

// ------------------------------------------------------------- title patterns
export const titles = {
  home: () => 'Pokémon & One Piece Card Prices & Market Cap in AUD',
  card: (c: { name: string; number: string; printedTotal?: string | null; setName: string; lang: string; grade?: string }) =>
    // The market price (raw, from recent sales) leads; PSA 10 is the most-searched grade.
    `${c.name} ${c.printedTotal ? `${c.number}/${c.printedTotal}` : c.number} (${c.setName}${c.lang === 'jp' ? ', Japanese' : ''}) ${c.grade ? `${c.grade} Price` : 'Price & PSA 10 Value'} in AUD`,
  set: (s: { name: string; gameName: string; lang: string }) =>
    `${s.name} (${s.gameName} ${s.lang.toUpperCase()}) Card List & Prices in AUD`,
  cardMarketplace: (c: { name: string; number: string; setName: string; lang: string }) =>
    `${c.name} ${c.number} (${c.setName} ${c.lang.toUpperCase()}) for Sale in Australia`,
  listing: (l: { title: string; state?: string }) => `${l.title} for Sale${l.state ? ` – ${l.state}` : ''}`,
  marketCap: (scope: string) => `${scope} Card Market Cap Rankings in AUD`,
}
