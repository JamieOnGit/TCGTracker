import { cardSitemapFiles, entriesFor, lastmodFor, SITEMAP_TYPES, sitemapIndex } from '@/lib/seo/sitemap'

export const revalidate = 3600

/** Sitemap index split by type (brief 7.3). */
export async function GET() {
  const files = await Promise.all(
    SITEMAP_TYPES.map(async (t) => ({ path: `/sitemaps/${t}.xml`, lastmod: await lastmodFor(await entriesFor(t)) })),
  )
  files.push(...(await cardSitemapFiles()), { path: '/sitemaps/news-google.xml', lastmod: null })
  return new Response(sitemapIndex(files), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
