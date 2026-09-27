import 'server-only'
import { getRepo } from '@/lib/data'
import { articlePath, cardMarketplacePath, cardPath, cardsPath, dropsPath, GAMES, LANGS, listingPath, marketCapPath, newsPath, NEWS_CATEGORIES, releasesPath, setPath, absoluteUrl, siteName } from './urls'

export interface SitemapEntry {
  path: string
  lastmod?: string | null
}

export const SITEMAP_TYPES = ['static', 'sets', 'cards', 'listings', 'news'] as const
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

export async function entriesFor(type: SitemapType): Promise<SitemapEntry[]> {
  const repo = getRepo()
  switch (type) {
    case 'static': {
      const retailers = await repo.retailers()
      return [
        { path: '/' },
        { path: '/market-cap/' },
        ...GAMES.flatMap((g) => [{ path: marketCapPath(g) }, ...LANGS.map((l) => ({ path: marketCapPath(g, l) }))]),
        { path: '/cards/' },
        ...GAMES.flatMap((g) => [{ path: cardsPath(g) }, ...LANGS.map((l) => ({ path: cardsPath(g, l) }))]),
        { path: '/marketplace/' },
        ...GAMES.map((g) => ({ path: `/marketplace/${g}/` })),
        { path: dropsPath() },
        ...retailers.map((r) => ({ path: dropsPath(r.slug) })),
        ...GAMES.map((g) => ({ path: releasesPath(g) })),
        { path: newsPath() },
        ...NEWS_CATEGORIES.map((c) => ({ path: newsPath(c) })),
        ...['premium', 'methodology', 'data', 'api', 'about', 'contact'].map((p) => ({ path: `/${p}/` })),
      ]
    }
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
