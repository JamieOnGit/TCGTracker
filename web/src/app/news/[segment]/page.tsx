import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
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
  return (
    <>
      <Breadcrumbs items={[{ name: 'News', path: '/news/' }, { name: segment, path: newsPath(segment) }]} />
      <h1>{segment.replace('-', ' ')} news</h1>
      {articles.length === 0 ? <p>No articles yet.</p> : <ul>{articles.map((a) => <li key={a.slug}><Link href={articlePath(new Date(a.publishedAt), a.slug)}>{a.title}</Link></li>)}</ul>}
    </>
  )
}
