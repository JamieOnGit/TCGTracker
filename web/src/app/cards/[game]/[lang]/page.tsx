import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { cardsPath, GAME_NAMES, isGame, isLang, LANG_NAMES, setPath } from '@/lib/seo/urls'

export const revalidate = 3600
type Props = { params: Promise<{ game: string; lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game, lang } = await params
  if (!isGame(game) || !isLang(lang)) return {}
  return buildMetadata({
    path: cardsPath(game, lang),
    title: `${GAME_NAMES[game]} ${LANG_NAMES[lang]} Sets – Card Lists & Prices`,
    description: `All ${LANG_NAMES[lang]} ${GAME_NAMES[game]} sets we track, newest first, with PSA population and AUD market cap.`,
  })
}

export default async function LangHub({ params }: Props) {
  const { game, lang } = await params
  if (!isGame(game) || !isLang(lang)) notFound()
  const sets = await getRepo().listSets({ game, lang })
  return (
    <>
      <Breadcrumbs items={[{ name: 'Cards', path: '/cards/' }, { name: GAME_NAMES[game], path: cardsPath(game) }, { name: lang.toUpperCase(), path: cardsPath(game, lang) }]} />
      <h1>{GAME_NAMES[game]} {LANG_NAMES[lang]} sets</h1>
      <table>
        <caption>Sets</caption>
        <thead><tr><th scope="col">Set</th><th scope="col">Code</th><th scope="col">Released</th></tr></thead>
        <tbody>
          {sets.map((s) => (
            <tr key={s.id}><th scope="row"><Link href={setPath(s)}>{s.name}</Link></th><td>{s.code}</td><td>{s.releaseDate ?? '—'}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
