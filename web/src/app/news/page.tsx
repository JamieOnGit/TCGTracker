import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { articlePath, newsPath, NEWS_CATEGORIES } from '@/lib/seo/urls'

export const revalidate = 300


export const metadata: Metadata = buildMetadata({
  path: '/news/',
  title: 'Pokémon & One Piece TCG News, Market Movers & Guides',
  description: 'Set releases, drop recaps, market movers and PSA population updates for Australian Pokémon and One Piece collectors.',
})

export default async function News() {
  const articles = await getRepo().articles({ limit: 30 })
  return (
    <>
      <Breadcrumbs items={[{ name: 'News', path: '/news/' }]} />
      <h1>News</h1>
      <nav aria-label="Categories">{NEWS_CATEGORIES.map((c) => <Link key={c} href={newsPath(c)}>{c} </Link>)}</nav>
      <ul>{articles.map((a) => <li key={a.slug}><Link href={articlePath(new Date(a.publishedAt), a.slug)}>{a.title}</Link> <time dateTime={a.publishedAt}>{a.publishedAt.slice(0, 10)}</time></li>)}</ul>
    </>
  )
}
