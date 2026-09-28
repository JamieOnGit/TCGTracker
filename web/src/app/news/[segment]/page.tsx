import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { EmptyState, PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { articlePath, newsPath, NEWS_CATEGORIES } from '@/lib/seo/urls'

// /news/{category}/ (a year alone, e.g. /news/2026/, is not a page).
export const revalidate = 300
type Props = { params: Promise<{ segment: string }> }
const isCategory = (s: string) => (NEWS_CATEGORIES as readonly string[]).includes(s)

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { segment } = await params
  if (!isCategory(segment)) return {}
  return buildMetadata({ path: newsPath(segment), title: `${segment.replace('-', ' ')} news`.replace(/^./, (c) => c.toUpperCase()), description: `Latest ${segment.replace('-', ' ')} news and analysis for Australian TCG collectors.` })
}

export default async function NewsCategory({ params }: Props) {
  const { segment } = await params
  if (!isCategory(segment)) notFound()
  const articles = await getRepo().articles({ category: segment, limit: 50 })
  const name = { pokemon: 'Pokémon', 'one-piece': 'One Piece', market: 'Market', drops: 'Drops', guides: 'Guides', grading: 'Grading' }[segment] ?? segment
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'News', path: '/news/' }, { name, path: newsPath(segment) }]} /></div>
      <PageIntro eyebrow="News" title={`${name} news`} />
      {articles.length === 0 ? <EmptyState title="No articles here yet." /> : (
        <ul>{articles.map((a) => <li key={a.slug} className="border-b py-5" style={{ borderColor: 'var(--line)' }}><Link href={articlePath(new Date(a.publishedAt), a.slug)} className="prose-link text-lg">{a.title}</Link></li>)}</ul>
      )}
    </div>
  )
}
