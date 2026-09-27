import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { cardsPath, GAME_NAMES, isGame, LANGS, LANG_NAMES, setPath } from '@/lib/seo/urls'

export const revalidate = 3600
type Props = { params: Promise<{ game: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params
  if (!isGame(game)) return {}
  return buildMetadata({
    path: cardsPath(game),
    title: `${GAME_NAMES[game]} Card Sets – English & Japanese`,
    description: `Every tracked ${GAME_NAMES[game]} set in English and Japanese, with card lists, PSA population and AUD prices.`,
  })
}

export default async function GameHub({ params }: Props) {
  const { game } = await params
  if (!isGame(game)) notFound()
  const sets = await getRepo().listSets({ game })
  return (
    <>
      <Breadcrumbs items={[{ name: 'Cards', path: '/cards/' }, { name: GAME_NAMES[game], path: cardsPath(game) }]} />
      <h1>{GAME_NAMES[game]} cards</h1>
      {LANGS.map((l) => (
        <section key={l} aria-labelledby={`h-${l}`}>
          <h2 id={`h-${l}`}><Link href={cardsPath(game, l)}>{LANG_NAMES[l]} sets</Link></h2>
          <ul>
            {sets.filter((s) => s.lang === l).map((s) => (
              <li key={s.id}><Link href={setPath(s)}>{s.name}</Link> ({s.code})</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
