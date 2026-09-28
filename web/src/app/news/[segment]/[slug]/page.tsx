import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
import { getRepo } from '@/lib/data'
import { newsArticle } from '@/lib/seo/jsonld'
import { buildMetadata } from '@/lib/seo/metadata'
import { articlePath, cardPath } from '@/lib/seo/urls'

// /news/{yyyy}/{article-slug}/
export const revalidate = 600
type Props = { params: Promise<{ segment: string; slug: string }> }

async function load(p: { segment: string; slug: string }) {
  if (!/^\d{4}$/.test(p.segment)) return null
  return getRepo().getArticle(Number(p.segment), p.slug)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await load(await params)
  if (!a) return {}
  return buildMetadata({ path: articlePath(new Date(a.publishedAt), a.slug), title: a.seoTitle ?? a.title, description: a.seoDescription ?? a.dek ?? a.title, ogType: 'article', ogImage: a.heroImageUrl ?? undefined })
}

export default async function Article({ params }: Props) {
  const a = await load(await params)
  if (!a) notFound()
  const path = articlePath(new Date(a.publishedAt), a.slug)
  const cards = await getRepo().getCardsByIds(a.tags.cardIds)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'News', path: '/news/' }, { name: a.title, path }]} /></div>
      <article className="prose mx-auto max-w-[var(--measure)] pt-10">
        <p className="eyebrow"><time dateTime={a.publishedAt}>{new Date(a.publishedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</time></p>
        <h1 className="mt-3">{a.title}</h1>
        {a.dek && <p className="lead mt-4">{a.dek}</p>}
        <div className="mt-8 whitespace-pre-line">{a.bodyMd}</div>
        {cards.length > 0 && (
          <aside aria-label="Cards in this article">
            <h2>Cards mentioned</h2>
            <ul>{cards.map((c) => <li key={c.id}><Link href={cardPath(c)}>{c.name} {c.number} ({c.setName}, {c.lang.toUpperCase()})</Link></li>)}</ul>
          </aside>
        )}
      </article>
      <JsonLd data={newsArticle({ headline: a.title, path, datePublished: a.publishedAt, dateModified: a.updatedAt, image: a.heroImageUrl ?? undefined })} />
    </div>
  )
}
