import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { buildMetadata } from '@/lib/seo/metadata'
import { cardsPath, GAMES, GAME_NAMES, LANGS } from '@/lib/seo/urls'

export const metadata: Metadata = buildMetadata({
  path: '/cards/',
  title: 'Browse Pokémon & One Piece Cards by Set (EN & JP)',
  description: 'Browse every tracked Pokémon TCG and One Piece Card Game set in English and Japanese, with PSA population and prices in AUD.',
})

export default function CardsIndex() {
  return (
    <>
      <Breadcrumbs items={[{ name: 'Cards', path: '/cards/' }]} />
      <h1>Browse cards</h1>
      <ul>
        {GAMES.map((g) => (
          <li key={g}>
            <Link href={cardsPath(g)}>{GAME_NAMES[g]}</Link> —{' '}
            {LANGS.map((l) => (
              <Link key={l} href={cardsPath(g, l)}>{l.toUpperCase()} </Link>
            ))}
          </li>
        ))}
      </ul>
    </>
  )
}
