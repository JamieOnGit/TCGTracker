import type { Metadata } from 'next'
import Link from 'next/link'
import { getRepo } from '@/lib/data'
import { buildMetadata, type SearchParams } from '@/lib/seo/metadata'
import { cardPath } from '@/lib/seo/urls'

// Internal search results are never indexed (brief 7.3) and are disallowed in robots.txt.
export const metadata: Metadata = buildMetadata({ path: '/search/', title: 'Search', description: 'Search cards.', noindex: true })

export default async function Search({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const q = (await searchParams).q
  const query = (Array.isArray(q) ? q[0] : q)?.slice(0, 80) ?? ''
  const cards = query ? await getRepo().searchCards(query, 50) : []
  return (
    <>
      <h1>Search</h1>
      <form action="/search/" role="search"><label htmlFor="q">Card name or number</label> <input id="q" name="q" defaultValue={query} /> <button>Search</button></form>
      <ul>{cards.map((c) => <li key={c.id}><Link href={cardPath(c)}>{c.name} {c.number} · {c.setName} · {c.lang.toUpperCase()}</Link></li>)}</ul>
    </>
  )
}
