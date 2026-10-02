import 'server-only'
import { GUIDES } from '@/content/guides'
import { RETAILER_COPY, STATE_COPY } from '@/content/drops-copy'
import { getRepo } from '@/lib/data'
import { AU_STATES, type DropFilter } from '@/lib/data/types'
import {
  absoluteUrl,
  articlePath,
  cardMarketplacePath,
  cardPath,
  cardsPath,
  dropsPath,
  dropsStatePath,
  GAMES,
  guidesPath,
  inStockPath,
  stockPath,
  LANGS,
  listingPath,
  marketCapPath,
  newsPath,
  NEWS_CATEGORIES,
  productPath,
  productsPath,
  releasePath,
  releasesHubPath,
  releasesPath,
  scoutsPath,
  setPath,
  siteName,
  storesPath,
} from './urls'

export interface SitemapEntry {
  path: string
  lastmod?: string | null
}

export const SITEMAP_TYPES = ['static', 'drops', 'products', 'releases', 'guides', 'sets', 'cards', 'listings', 'news'] as const
export type SitemapType = (typeof SITEMAP_TYPES)[number]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function urlset(entries: SitemapEntry[]): string {
  const body = entries
    .map((e) => `<url><loc>${esc(absoluteUrl(e.path))}</loc>${e.lastmod ? `<lastmod>${e.lastmod.slice(0, 10)}</lastmod>` : ''}</url>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`
}

export function sitemapIndex(files: { path: string; lastmod?: string | null }[]): string {
  const body = files.map((f) => `<sitemap><loc>${esc(absoluteUrl(f.path))}</loc>${f.lastmod ? `<lastmod>${f.lastmod.slice(0, 10)}</lastmod>` : ''}</sitemap>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`
}

const latest = (xs: (string | null | undefined)[]) => xs.filter(Boolean).sort().at(-1) ?? null

/** Drops pages with thin history are noindex (the page applies the same rule), so they stay out of the sitemap. */
export const DROPS_INDEX_WINDOW_DAYS = 90

/** Latest public event for a filter: one row, so this stays cheap. */
async function lastDrop(filter: DropFilter): Promise<string | null> {
  const [row] = await getRepo().drops({ ...filter, limit: 1 })
  return row?.occurredAt ?? null
}

/** A retailer/state page is listed when it has an event in the window or hand-written copy. */
export function dropsPageIndexable(lastEvent: string | null, hasCopy: boolean, now = new Date()): boolean {
  if (hasCopy) return true
  return lastEvent !== null && now.getTime() - new Date(lastEvent).getTime() <= DROPS_INDEX_WINDOW_DAYS * 86_400_000
}

export async function entriesFor(type: SitemapType): Promise<SitemapEntry[]> {
  const repo = getRepo()
  switch (type) {
    case 'static': {
      return [
        { path: '/' },
        ...GAMES.flatMap((g) => [{ path: marketCapPath(g) }, ...LANGS.map((l) => ({ path: marketCapPath(g, l) }))]),
        { path: '/cards/' },
        ...GAMES.flatMap((g) => [{ path: cardsPath(g) }, ...LANGS.map((l) => ({ path: cardsPath(g, l) }))]),
        { path: '/marketplace/' },
        ...GAMES.map((g) => ({ path: `/marketplace/${g}/` })),
        { path: '/deals/' },
        { path: newsPath() },
        ...(await Promise.all(NEWS_CATEGORIES.map(async (c) => ((await repo.articles({ category: c, limit: 1 })).length ? [{ path: newsPath(c) }] : [])))).flat(),
        ...['premium', 'methodology', 'data', 'api', 'about', 'contact'].map((p) => ({ path: `/${p}/` })),
      ]
    }
    case 'drops': {
      const now = new Date()
      const [all, retailers, states] = await Promise.all([
        lastDrop({}),
        Promise.all((await repo.retailers()).map(async (r) => ({ path: dropsPath(r.slug), last: await lastDrop({ retailerSlug: r.slug }), copy: r.slug in RETAILER_COPY }))),
        Promise.all(AU_STATES.map(async (st) => ({ path: dropsStatePath(st), last: await lastDrop({ state: st }), copy: st in STATE_COPY }))),
      ])
      return [
        { path: dropsPath(), lastmod: all },
        { path: inStockPath(), lastmod: latest((await repo.inStock({ limit: 1 })).map((p) => p.updatedAt)) },
        { path: storesPath() },
        { path: scoutsPath() },
        // Live stock: the hub, and every store page that has listings (empty ones are noindex).
        ...(await (async () => {
          const { stores } = await repo.stockOverview()
          const withListings = stores.filter((s) => s.listings > 0)
          return [
            { path: stockPath(), lastmod: latest(withListings.map((s) => s.lastChangeAt)) },
            ...withListings.map((s) => ({ path: stockPath(s.slug), lastmod: s.lastChangeAt })),
          ]
        })()),
        ...[...retailers, ...states].filter((x) => dropsPageIndexable(x.last, x.copy, now)).map((x) => ({ path: x.path, lastmod: x.last })),
      ]
    }
    case 'products': {
      // Product pages with no store listing are noindex (thin), so only listed products are here.
      const all = await repo.listSealedProducts({ limit: 45000 }) // hubs are noindex when empty
      const listed = all.filter((p) => p.offers.length > 0)
      const hubs = [
        ...(all.length ? [{ path: productsPath(), lastmod: latest(listed.map((p) => p.updatedAt)) }] : []),
        ...GAMES.filter((g) => all.some((p) => p.game === g)).map((g) => ({ path: productsPath(g), lastmod: latest(listed.filter((p) => p.game === g).map((p) => p.updatedAt)) })),
      ]
      return [...hubs, ...listed.map((p) => ({ path: productPath(p), lastmod: p.updatedAt }))]
    }
    case 'releases': {
      const rows = await repo.releases()
      const newest = latest(rows.map((r) => r.updatedAt))
      return [
        { path: releasesHubPath(), lastmod: newest },
        ...GAMES.map((g) => ({ path: releasesPath(g), lastmod: latest(rows.filter((r) => r.game === g).map((r) => r.updatedAt)) })),
        ...rows.map((r) => ({ path: releasePath(r.game, r.slug), lastmod: r.updatedAt })),
      ]
    }
    case 'guides':
      return [{ path: guidesPath(), lastmod: latest(GUIDES.map((g) => g.updated)) }, ...GUIDES.map((g) => ({ path: guidesPath(g.slug), lastmod: g.updated }))]
    case 'sets': {
      const sets = await repo.listSets()
      return sets.flatMap((s) => [
        { path: setPath(s), lastmod: s.updatedAt },
        { path: marketCapPath(s.game, s.lang, s.slug), lastmod: s.updatedAt },
      ])
    }
    case 'cards': {
      const sets = await repo.listSets()
      const cards = (await Promise.all(sets.map((s) => repo.listCardsInSet(s.id)))).flat()
      return cards.flatMap((c) => [
        { path: cardPath(c), lastmod: c.updatedAt },
        { path: cardMarketplacePath(c), lastmod: c.updatedAt },
      ])
    }
    case 'listings': {
      const res = await repo.marketplace({ sort: 'newest', page: 1, pageSize: 45000 })
      return res.rows.map((l) => ({ path: listingPath(l.id, l.title), lastmod: l.approvedAt }))
    }
    case 'news': {
      const articles = await repo.articles({ limit: 45000 })
      return articles.map((a) => ({ path: articlePath(new Date(a.publishedAt), a.slug), lastmod: a.updatedAt }))
    }
  }
}

export async function lastmodFor(entries: SitemapEntry[]): Promise<string | null> {
  return latest(entries.map((e) => e.lastmod))
}

/** Google News sitemap: articles from the last 2 days (Google's rule). */
export async function newsSitemap(now = new Date()): Promise<string> {
  const articles = (await getRepo().articles({ limit: 1000 })).filter((a) => now.getTime() - new Date(a.publishedAt).getTime() < 2 * 86_400_000)
  const body = articles
    .map(
      (a) =>
        `<url><loc>${esc(absoluteUrl(articlePath(new Date(a.publishedAt), a.slug)))}</loc><news:news><news:publication><news:name>${esc(siteName())}</news:name><news:language>en</news:language></news:publication><news:publication_date>${a.publishedAt}</news:publication_date><news:title>${esc(a.title)}</news:title></news:news></url>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${body}</urlset>`
}
