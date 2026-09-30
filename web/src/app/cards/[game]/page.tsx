import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { fmtDate } from '@/components/Format'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { cardsPath, GAME_NAMES, isGame, LANGS, LANG_NAMES, marketCapPath, setPath } from '@/lib/seo/urls'

export const revalidate = 3600
type Props = { params: Promise<{ game: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params
  if (!isGame(game)) return {}
  return buildMetadata({
    path: cardsPath(game),
    title: `${GAME_NAMES[game]} Card Sets – English & Japanese Prices in AUD`,
    description: `Every tracked ${GAME_NAMES[game]} set in English and Japanese: card lists, graded values and PSA population, in Australian dollars.`,
  })
}

export default async function GameHub({ params }: Props) {
  const { game } = await params
  if (!isGame(game)) notFound()
  const sets = await getRepo().listSets({ game })
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Cards', path: '/cards/' }, { name: GAME_NAMES[game], path: cardsPath(game) }]} /></div>
      <PageIntro eyebrow="Catalogue" title={`${GAME_NAMES[game]} cards`} lead={<>English and Japanese sets, newest first. <Link href={marketCapPath(game)} className="prose-link">See the {GAME_NAMES[game]} rankings</Link>.</>} />
      {LANGS.map((l) => (
        <section key={l} className="pb-12" aria-labelledby={`h-${l}`}>
          <div className="flex items-baseline justify-between">
            <h2 id={`h-${l}`}>{LANG_NAMES[l]} sets</h2>
            <Link href={cardsPath(game, l)} className="btn-ghost text-sm">View all</Link>
          </div>
          <div className="table-wrap mt-4">
            <table className="dt">
              <thead><tr><th scope="col">Set</th><th scope="col">Code</th><th scope="col" className="n">Released</th></tr></thead>
              <tbody>{sets.filter((s) => s.lang === l).map((s) => <tr key={s.id}><th scope="row"><Link href={setPath(s)} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{s.name}</Link></th><td className="muted">{s.code}</td><td className="n">{fmtDate(s.releaseDate)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
