import type { Metadata } from 'next'
import Link from 'next/link'
import { LangBadge } from '@/components/Format'
import { EmptyState, PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata, type SearchParams } from '@/lib/seo/metadata'
import { cardPath } from '@/lib/seo/urls'

// Internal search results are never indexed (brief 7.3) and are disallowed in robots.txt.
export const metadata: Metadata = buildMetadata({ path: '/search/', title: 'Search cards', description: 'Search Pokémon and One Piece cards.', noindex: true })

export default async function Search({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const q = (await searchParams).q
  const query = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 80) ?? ''
  const cards = query ? await getRepo().searchCards(query, 60) : []
  return (
    <div className="container-x">
      <PageIntro eyebrow="Search" title={query ? `Results for “${query}”` : 'Search cards'} />
      <form action="/search/" role="search" className="flex max-w-xl gap-3">
        <label htmlFor="q" className="sr-only">Card name, number or set</label>
        <input id="q" name="q" defaultValue={query} className="input" placeholder="e.g. Charizard 199, OP05-119, Umbreon" autoFocus />
        <button className="btn btn-primary">Search</button>
      </form>
      {query && cards.length === 0 && <EmptyState title="No cards found." body="Try a card number (199, OP05-119) or a shorter name." />}
      <ul className="mt-8">
        {cards.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3" style={{ borderColor: 'var(--line)' }}>
            <Link href={cardPath(c)} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{c.name} <span className="muted">#{c.number}</span></Link>
            <span className="card-meta">{c.setName} <LangBadge lang={c.lang} /></span>
          </li>
        ))}
      </ul>
    </div>
  )
}
