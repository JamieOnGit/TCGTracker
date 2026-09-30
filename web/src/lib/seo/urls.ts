/**
 * Canonical URL builders (brief 7.1). Every link on the site is built here so
 * there is exactly one URL per entity: lowercase, hyphenated, trailing slash.
 */
export const GAMES = ['pokemon', 'one-piece'] as const
export const LANGS = ['en', 'jp'] as const
export type Game = (typeof GAMES)[number]
export type Lang = (typeof LANGS)[number]

export const GAME_NAMES: Record<Game, string> = { pokemon: 'Pokémon', 'one-piece': 'One Piece' }
export const LANG_NAMES: Record<Lang, string> = { en: 'English', jp: 'Japanese' }

export function isGame(v: string): v is Game {
  return (GAMES as readonly string[]).includes(v)
}
export function isLang(v: string): v is Lang {
  return (LANGS as readonly string[]).includes(v)
}

export interface SetRef {
  game: Game
  lang: Lang
  slug: string
}
export interface CardRef {
  id: string
  game: Game
  lang: Lang
  setSlug: string
  slug: string // "{number}-{card-slug}"
}

/** Lowercase, hyphenated ASCII slug. Mirrors public.slugify() in SQL. */
export function slugify(input: string): string {
  return input
    .replace(/[.']/g, (c) => (c === '.' ? ' ' : ''))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

export const homePath = () => '/'
/** All games = the homepage (/market-cap/ 301s there); per game/lang/set under /market-cap/. */
export const marketCapPath = (game?: Game, lang?: Lang, setSlug?: string) =>
  game ? '/market-cap/' + [game, lang, setSlug].filter(Boolean).map((s) => `${s}/`).join('') : '/'
export const cardsPath = (game?: Game, lang?: Lang) => '/cards/' + [game, lang].filter(Boolean).map((s) => `${s}/`).join('')
export const setPath = (s: SetRef) => `/cards/${s.game}/${s.lang}/${s.slug}/`
export const cardPath = (c: CardRef) => `/cards/${c.game}/${c.lang}/${c.setSlug}/${c.slug}/`
export const marketplacePath = (game?: Game) => (game ? `/marketplace/${game}/` : '/marketplace/')
export const cardMarketplacePath = (c: CardRef) => `/marketplace/${c.game}/${c.lang}/${c.setSlug}/${c.slug}/`
export const listingPath = (id: number | string, title: string) => {
  const short = slugify(title).split('-').slice(0, 8).join('-') || 'listing'
  return `/marketplace/listing/${id}-${short}/`
}
export const sellerPath = (username: string) => `/sellers/${username.toLowerCase()}/`
export const dropsPath = (retailerSlug?: string) => (retailerSlug ? `/drops/${retailerSlug}/` : '/drops/')
/** Drops by state: /drops/vic/ (state codes never collide with retailer slugs). */
export const dropsStatePath = (state: string) => `/drops/${state.toLowerCase()}/`
export const scoutsPath = () => '/drops/scouts/'
export const releasesHubPath = () => '/releases/'
export const releasesPath = (game: Game) => `/releases/${game}/`
export const releasePath = (game: Game, slug: string) => `/releases/${game}/${slug}/`
export const releasesIcsPath = (game?: Game) => (game ? `/releases/${game}/calendar.ics` : '/releases/calendar.ics')
export const guidesPath = (slug?: string) => (slug ? `/guides/${slug}/` : '/guides/')
export const accountSightingsPath = () => '/account/sightings/'
export const accountDropAlertsPath = () => '/account/alerts/drops/'
export const newsPath = (category?: string) => (category ? `/news/${category}/` : '/news/')
export const articlePath = (publishedAt: Date, slug: string) => `/news/${publishedAt.getUTCFullYear()}/${slug}/`
export const sellPath = (opts: { cardId?: string; gradeKey?: string | null } = {}) => {
  const p = new URLSearchParams()
  if (opts.cardId) p.set('card', opts.cardId)
  if (opts.gradeKey) p.set('grade', opts.gradeKey)
  const q = p.toString()
  return `/account/listings/new/${q ? `?${q}` : ''}`
}

/** Split "/marketplace/listing/100123-charizard-ex-psa-10/" style segments. */
export function parseListingSegment(segment: string): { id: number; slug: string } | null {
  const m = /^(\d+)(?:-([a-z0-9-]*))?$/.exec(segment)
  if (!m) return null
  return { id: Number(m[1]), slug: m[2] ?? '' }
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`
}
export function siteName(): string {
  return process.env.NEXT_PUBLIC_SITE_NAME ?? 'TCGTracker'
}

export const NEWS_CATEGORIES = ['pokemon', 'one-piece', 'market', 'drops', 'guides', 'grading'] as const

/** Share image for pages without their own (web/public/og-default.png, 1200×630). */
export const DEFAULT_OG_IMAGE = '/og-default.png'
