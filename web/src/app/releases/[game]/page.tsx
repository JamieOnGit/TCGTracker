import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { PageIntro } from '@/components/ui'
import { buildMetadata } from '@/lib/seo/metadata'
import { accountDropAlertsPath, cardsPath, dropsPath, GAME_NAMES, GAMES, guidesPath, isGame, releasesHubPath, releasesIcsPath, releasesPath, type Game } from '@/lib/seo/urls'
import { Calendar } from '../_components/Calendar'

export const revalidate = 3600
type Props = { params: Promise<{ game: string }> }

export function generateStaticParams() {
  return GAMES.map((game) => ({ game }))
}

const COPY: Record<Game, { description: string; lead: string; guide: [string, string] }> = {
  pokemon: {
    description: 'Pokémon TCG release dates in Australia: upcoming English and Japanese sets, pre-order dates, RRP in AUD and where to buy at JB Hi-Fi, BIG W, Kmart, Target and EB Games.',
    lead: 'English and Japanese Pokémon TCG sets and products. English sets generally launch in Australia on the global release date; Japanese sets come out in Japan first and reach Australia through importers and specialist stores.',
    guide: ['japanese-vs-english-pokemon-cards', 'Japanese vs English Pokémon cards'],
  },
  'one-piece': {
    description: 'One Piece Card Game release dates in Australia: upcoming English and Japanese booster sets, starter decks, pre-orders, RRP in AUD and where to buy.',
    lead: 'English and Japanese One Piece Card Game boosters, starter decks and premium products. Japanese sets have historically released in Japan before their English versions, so check which language a date refers to.',
    guide: ['one-piece-card-game-australia', 'One Piece Card Game in Australia'],
  },
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params
  if (!isGame(game)) return {}
  return buildMetadata({
    path: releasesPath(game),
    title: `${GAME_NAMES[game]} TCG Release Dates in Australia (EN & JP)`,
    description: COPY[game].description,
  })
}

export default async function GameReleases({ params }: Props) {
  const { game } = await params
  if (!isGame(game)) notFound()
  const c = COPY[game]
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Releases', path: releasesHubPath() }, { name: GAME_NAMES[game], path: releasesPath(game) }]} /></div>
      <PageIntro eyebrow="Release calendar · Australia · AEST/AEDT" title={`${GAME_NAMES[game]} release dates`} lead={c.lead}>
        <nav aria-label="Calendar options" className="mt-6 flex flex-wrap gap-2">
          <a href={releasesIcsPath(game)} className="chip-filter">Add {GAME_NAMES[game]} dates to your calendar (.ics)</a>
          <Link href={accountDropAlertsPath()} className="chip-filter">Get drop alerts</Link>
        </nav>
      </PageIntro>
      <Calendar game={game} />
      <section className="section" aria-labelledby="more-h">
        <h2 id="more-h">Around release day</h2>
        <div className="prose mt-4">
          <p>
            Stock at Australian retailers often arrives in waves after release day, and popular products can sell quickly. Watch the <Link href={dropsPath()}>restock and pre-order feed</Link>, browse the <Link href={cardsPath(game)}>{GAME_NAMES[game]} card catalogue</Link> for set lists and prices in AUD, or read <Link href={guidesPath(c.guide[0])}>{c.guide[1]}</Link>.
          </p>
        </div>
      </section>
    </div>
  )
}
