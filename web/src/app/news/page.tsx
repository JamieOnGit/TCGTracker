import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pagination } from '@/components/Pagination'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { fmtDate } from '@/components/Format'
import { EmptyState, PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { pastLastPage, slicePage, TABLE_PAGE_SIZE } from '@/lib/paging'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { articlePath, newsPath, NEWS_CATEGORIES } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { searchParams: Promise<SearchParams> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildMetadata({
    path: '/news/',
    title: 'Pokémon & One Piece TCG News Australia – Market Movers, Restocks & Guides',
    description: 'Set releases, restock recaps, market movers in AUD and grading guides for Australian Pokémon and One Piece collectors.',
    searchParams: await searchParams,
  })
}

const CATEGORY_NAMES: Record<string, string> = { pokemon: 'Pokémon', 'one-piece': 'One Piece', market: 'Market', drops: 'Drops', guides: 'Guides', grading: 'Grading' }

export default async function News({ searchParams }: Props) {
  const all = await getRepo().articles({ limit: 2000 })
  const page = pageNumber(await searchParams)
  if (pastLastPage(page, all.length, TABLE_PAGE_SIZE)) notFound()
  const articles = slicePage(all, page, TABLE_PAGE_SIZE)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'News', path: '/news/' }]} /></div>
      <PageIntro eyebrow="News · Australia" title="News & guides">
        <nav aria-label="Categories" className="mt-6 flex flex-wrap gap-2">{NEWS_CATEGORIES.map((c) => <Link key={c} href={newsPath(c)} className="chip-filter">{CATEGORY_NAMES[c]}</Link>)}</nav>
      </PageIntro>
      {articles.length === 0 ? <EmptyState title="The first stories are on their way." /> : (
        <ul className="grid scroll-mt-24 gap-0" id="articles">
          {articles.map((a) => (
            <li key={a.slug} className="border-b py-6" style={{ borderColor: 'var(--line)' }}>
              <p className="eyebrow">{CATEGORY_NAMES[a.category] ?? a.category} · {fmtDate(a.publishedAt)}</p>
              <h2 className="mt-2 text-xl"><Link href={articlePath(new Date(a.publishedAt), a.slug)} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{a.title}</Link></h2>
              {a.dek && <p className="muted mt-2 max-w-[var(--measure)] text-sm">{a.dek}</p>}
            </li>
          ))}
        </ul>
      )}
      <Pagination basePath="/news/" page={page} total={all.length} pageSize={TABLE_PAGE_SIZE} anchor="articles" noun="articles" />
    </div>
  )
}
