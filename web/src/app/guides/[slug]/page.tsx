import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
import { Markdown } from '@/components/Markdown'
import { getGuide, GUIDES, TOPIC_LABEL } from '@/content/guides'
import { outline, parseMarkdown } from '@/lib/markdown'
import { article, faqPage } from '@/lib/seo/jsonld'
import { buildMetadata } from '@/lib/seo/metadata'
import { guidesPath } from '@/lib/seo/urls'

// /guides/{slug}/ — guides ship with the code. Pre-rendered at build and
// rendered on request too: on Cloudflare (OpenNext without an incremental
// cache) build-time pages aren't served, so `dynamicParams = false` made every
// guide a 404 in production. Unknown slugs are still a 404 (notFound below).
type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }))
}

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = getGuide((await params).slug)
  if (!g) return {}
  return buildMetadata({ path: guidesPath(g.slug), title: g.seoTitle ?? g.title, description: g.description, ogType: 'article' })
}

export default async function GuidePage({ params }: Props) {
  const g = getGuide((await params).slug)
  if (!g) notFound()
  const path = guidesPath(g.slug)
  const blocks = parseMarkdown(g.body)
  const toc = outline(blocks)
  const more = GUIDES.filter((x) => x.slug !== g.slug && !g.related.some((r) => r.href === guidesPath(x.slug))).slice(0, 3)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Guides', path: guidesPath() }, { name: g.title, path }]} /></div>
      <article className="prose mx-auto max-w-[var(--measure)] pt-10">
        <p className="eyebrow">{TOPIC_LABEL[g.topic]} guide · Updated <time dateTime={g.updated}>{fmt(g.updated)}</time></p>
        <h1 className="mt-3">{g.title}</h1>
        <p className="lead mt-4">{g.dek}</p>
        {toc.length > 2 && (
          <nav aria-labelledby="toc-h" className="mt-8">
            <p id="toc-h" className="eyebrow">In this guide</p>
            <ol>{toc.map((h) => <li key={h.id}><a href={`#${h.id}`}>{h.text}</a></li>)}</ol>
          </nav>
        )}
        <div className="mt-8"><Markdown blocks={blocks} /></div>
        {g.faqs.length > 0 && (
          <section aria-labelledby="faq-h">
            <h2 id="faq-h">Frequently asked questions</h2>
            {g.faqs.map((f) => (
              <div key={f.q}>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            ))}
          </section>
        )}
        <aside aria-labelledby="rel-h">
          <h2 id="rel-h">Related</h2>
          <ul>
            {g.related.map((r) => <li key={r.href}><Link href={r.href}>{r.label}</Link></li>)}
            {more.map((x) => <li key={x.slug}><Link href={guidesPath(x.slug)}>{x.title}</Link></li>)}
          </ul>
        </aside>
        <p className="provenance">General information for Australian collectors, not financial or legal advice. Fees, policies and dates change; check the official source before acting.</p>
      </article>
      <JsonLd data={article({ headline: g.title, description: g.description, path, datePublished: g.published, dateModified: g.updated })} />
      {g.faqs.length > 0 && <JsonLd data={faqPage(g.faqs)} />}
    </div>
  )
}
