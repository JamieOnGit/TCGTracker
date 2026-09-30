import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { cardsPath, GAMES, GAME_NAMES, LANGS, LANG_NAMES, setPath } from '@/lib/seo/urls'

export const revalidate = 3600
export const metadata: Metadata = buildMetadata({
  path: '/cards/',
  title: 'Pokémon & One Piece Card Sets – English & Japanese, Prices in AUD',
  description: 'Browse every tracked Pokémon TCG and One Piece Card Game set in English and Japanese, with graded values and PSA population in Australian dollars.',
})

export default async function CardsIndex() {
  const sets = await getRepo().listSets()
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Cards', path: '/cards/' }]} /></div>
      <PageIntro eyebrow="Catalogue" title="Browse cards" lead="Every set we track, by game and language. Japanese and English printings are separate cards with their own prices." />
      <div className="grid gap-12 md:grid-cols-2">
        {GAMES.map((g) => (
          <section key={g} aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`}><Link href={cardsPath(g)} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{GAME_NAMES[g]}</Link></h2>
            {LANGS.map((l) => {
              const list = sets.filter((s) => s.game === g && s.lang === l)
              return (
                <div key={l} className="mt-6">
                  <p className="eyebrow"><Link href={cardsPath(g, l)} className="prose-link" style={{ color: 'inherit' }}>{LANG_NAMES[l]} · {list.length} sets</Link></p>
                  <ul className="mt-3 grid gap-2 text-sm">
                    {list.slice(0, 6).map((s) => <li key={s.id}><Link href={setPath(s)} className="prose-link">{s.name}</Link> <span className="muted">{s.code}</span></li>)}
                    {list.length > 6 && <li><Link href={cardsPath(g, l)} className="btn-ghost">All {list.length} sets</Link></li>}
                  </ul>
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}
