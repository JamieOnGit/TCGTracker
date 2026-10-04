import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { fmtDate } from '@/components/Format'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { Pagination } from '@/components/Pagination'
import { pastLastPage, slicePage, TABLE_PAGE_SIZE } from '@/lib/paging'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { cardsPath, GAME_NAMES, isGame, isLang, LANG_NAMES, marketCapPath, setPath } from '@/lib/seo/urls'

export const revalidate = 3600
type Props = { params: Promise<{ game: string; lang: string }>; searchParams: Promise<SearchParams> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { game, lang } = await params
  if (!isGame(game) || !isLang(lang)) return {}
  return buildMetadata({
    path: cardsPath(game, lang),
    title: `${GAME_NAMES[game]} ${LANG_NAMES[lang]} Sets – Card Lists & Prices in AUD`,
    description: `All ${LANG_NAMES[lang]} ${GAME_NAMES[game]} sets we track, newest first, with graded values and PSA population in Australian dollars.`,
    searchParams: await searchParams,
  })
}

export default async function LangHub({ params, searchParams }: Props) {
  const { game, lang } = await params
  if (!isGame(game) || !isLang(lang)) notFound()
  const all = await getRepo().listSets({ game, lang })
  const page = pageNumber(await searchParams)
  if (pastLastPage(page, all.length, TABLE_PAGE_SIZE)) notFound()
  const sets = slicePage(all, page, TABLE_PAGE_SIZE)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Cards', path: '/cards/' }, { name: GAME_NAMES[game], path: cardsPath(game) }, { name: LANG_NAMES[lang], path: cardsPath(game, lang) }]} /></div>
      <PageIntro eyebrow={`${GAME_NAMES[game]} · ${LANG_NAMES[lang]}`} title={`${GAME_NAMES[game]} ${LANG_NAMES[lang]} sets`} lead={<><Link href={marketCapPath(game, lang)} className="prose-link">Rankings for {LANG_NAMES[lang]} {GAME_NAMES[game]}</Link> · <Link href={cardsPath(game, lang === 'en' ? 'jp' : 'en')} className="prose-link">{lang === 'en' ? 'Japanese' : 'English'} sets</Link></>} />
      <div className="table-wrap scroll-mt-24" id="sets">
        <table className="dt">
          <caption className="sr-only">Sets</caption>
          <thead><tr><th scope="col">Set</th><th scope="col">Code</th><th scope="col" className="n">Released</th><th scope="col" className="n hide-sm">Rankings</th></tr></thead>
          <tbody>
            {sets.map((s) => (
              <tr key={s.id}>
                <th scope="row"><Link href={setPath(s)} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{s.name}</Link></th>
                <td className="muted">{s.code}</td>
                <td className="n">{fmtDate(s.releaseDate)}</td>
                <td className="n hide-sm"><Link href={marketCapPath(s.game, s.lang, s.slug)} className="prose-link">View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination basePath={cardsPath(game, lang)} page={page} total={all.length} pageSize={TABLE_PAGE_SIZE} anchor="sets" noun="sets" />
    </div>
  )
}
