/**
 * Metadata templates per page type (brief 7.2, 7.3): unique titles and
 * descriptions, self-referencing canonicals, facet handling and pagination.
 */
import type { Metadata } from 'next'
import { absoluteUrl, siteName } from './urls'

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

export function buildMetadata(input: PageSeoInput): Metadata {
  const page = pageNumber(input.searchParams)
  const filtered = isFiltered(input.searchParams)
  const pageSuffix = page > 1 ? ` – Page ${page}` : ''
  const title = `${input.title}${pageSuffix} | ${siteName()}`
  // Filtered views canonicalise to the clean page; pagination is self-canonical.
  const canonicalPath = filtered ? input.path : page > 1 ? `${input.path}?page=${page}` : input.path
  const index = !input.noindex && !filtered
  return {
    title: { absolute: title },
    description: page > 1 ? `${input.description} Page ${page}.` : input.description,
    alternates: { canonical: absoluteUrl(canonicalPath) },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      title,
      description: input.description,
      url: absoluteUrl(canonicalPath),
      siteName: siteName(),
      locale: 'en_AU',
      type: input.ogType ?? 'website',
      ...(input.ogImage ? { images: [{ url: input.ogImage }] } : {}),
    },
    twitter: { card: input.ogImage ? 'summary_large_image' : 'summary', title, description: input.description },
  }
}

// ------------------------------------------------------------- title patterns
export const titles = {
  home: () => 'Pokémon & One Piece Graded Card Market Cap Rankings (AUD)',
  card: (c: { name: string; number: string; printedTotal?: string | null; setName: string; lang: string; grade?: string }) =>
    `${c.name} ${c.printedTotal ? `${c.number}/${c.printedTotal}` : c.number} (${c.setName}${c.lang === 'jp' ? ', Japanese' : ''}) ${c.grade ?? 'PSA 10'} Price, Population & Market Cap`,
  set: (s: { name: string; gameName: string; lang: string }) =>
    `${s.name} (${s.gameName} ${s.lang.toUpperCase()}) Card List, Prices & PSA Population`,
  cardMarketplace: (c: { name: string; number: string; setName: string; lang: string }) =>
    `${c.name} ${c.number} (${c.setName} ${c.lang.toUpperCase()}) for Sale in Australia`,
  listing: (l: { title: string; state?: string }) => `${l.title} for Sale${l.state ? ` – ${l.state}` : ''}`,
  marketCap: (scope: string) => `${scope} Market Cap Rankings – PSA 10 Population × Floor Price`,
}
