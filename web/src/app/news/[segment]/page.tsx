import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { EmptyState, PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { Pagination } from '@/components/Pagination'
import { pastLastPage, slicePage, TABLE_PAGE_SIZE } from '@/lib/paging'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { articlePath, newsPath, NEWS_CATEGORIES } from '@/lib/seo/urls'

// /news/{category}/ (a year alone, e.g. /news/2026/, is not a page).
export const revalidate = 300
type Props = { params: Promise<{ segment: string }>; searchParams: Promise<SearchParams> }
const isCategory = (s: string) => (NEWS_CATEGORIES as readonly string[]).includes(s)

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { segment } = await params
  if (!isCategory(segment)) return {}
  const empty = (await getRepo().articles({ category: segment, limit: 1 })).length === 0
  const label = segment.replace('-', ' ')
  return buildMetadata({
    path: newsPath(segment),
    title: `${label} news`.replace(/^./, (c) => c.toUpperCase()),
    description: `Latest ${label} news, market analysis and release updates for Australian Pokémon and One Piece TCG collectors, in AUD.`,
    noindex: empty, // no thin, empty category pages in the index
    searchParams: await searchParams,
  })
}

export default async function NewsCategory({ params, searchParams }: Props) {
  const { segment } = await params
  if (!isCategory(segment)) notFound()
  const all = await getRepo().articles({ category: segment, limit: 2000 })
  const page = pageNumber(await searchParams)
  if (pastLastPage(page, all.length, TABLE_PAGE_SIZE)) notFound()
  const articles = slicePage(all, page, TABLE_PAGE_SIZE)
  const name = { pokemon: 'Pokémon', 'one-piece': 'One Piece', market: 'Market', drops: 'Drops', guides: 'Guides', grading: 'Grading' }[segment] ?? segment
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'News', path: '/news/' }, { name, path: newsPath(segment) }]} /></div>
      <PageIntro eyebrow="News" title={`${name} news`} />
      {articles.length === 0 ? <EmptyState title="No articles here yet." /> : (
        <ul className="scroll-mt-24" id="articles">{articles.map((a) => <li key={a.slug} className="border-b py-5" style={{ borderColor: 'var(--line)' }}><Link href={articlePath(new Date(a.publishedAt), a.slug)} className="prose-link text-lg">{a.title}</Link></li>)}</ul>
      )}
      <Pagination basePath={newsPath(segment)} page={page} total={all.length} pageSize={TABLE_PAGE_SIZE} anchor="articles" noun="articles" />
    </div>
  )
}
