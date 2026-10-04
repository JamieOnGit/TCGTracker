import { cardEntries, entriesFor, newsSitemap, SITEMAP_TYPES, urlset, type SitemapType } from '@/lib/seo/sitemap'

export const revalidate = 3600

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const headers = { 'Content-Type': 'application/xml; charset=utf-8' }
  if (file === 'news-google.xml') return new Response(await newsSitemap(), { headers })
  const cards = /^cards-(\d{1,4})\.xml$/.exec(file)
  if (cards) {
    const entries = await cardEntries(Number(cards[1]))
    return entries ? new Response(urlset(entries), { headers }) : new Response('Not found', { status: 404 })
  }
  const type = file.replace(/\.xml$/, '') as SitemapType
  if (!file.endsWith('.xml') || !SITEMAP_TYPES.includes(type)) return new Response('Not found', { status: 404 })
  return new Response(urlset(await entriesFor(type)), { headers })
}
