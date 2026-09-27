import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { MarketCapTable, parseMarketQuery } from '@/components/MarketCapTable'
import { getRepo } from '@/lib/data'
import { buildMetadata, titles, type SearchParams } from '@/lib/seo/metadata'
import { cardPath, cardsPath, GAME_NAMES, isGame, isLang, marketCapPath, setPath } from '@/lib/seo/urls'

export const revalidate = 3600
type Props = { params: Promise<{ game: string; lang: string; set: string }>; searchParams: Promise<SearchParams> }

async function load(p: Awaited<Props['params']>) {
  if (!isGame(p.game) || !isLang(p.lang)) return null
  return getRepo().getSet(p.game, p.lang, p.set)
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const set = await load(await params)
  if (!set) return {}
  return buildMetadata({
    path: setPath(set),
    title: titles.set({ name: set.name, gameName: GAME_NAMES[set.game], lang: set.lang }),
    description: `${set.name} (${set.code}) ${set.lang === 'jp' ? 'Japanese' : 'English'} card list with PSA 10 population, floor prices and market cap in AUD.`,
    searchParams: await searchParams,
  })
}

export default async function SetPage({ params, searchParams }: Props) {
  const set = await load(await params)
  if (!set) notFound()
  const repo = getRepo()
  const [cards, rules] = await Promise.all([repo.listCardsInSet(set.id), repo.getRules()])
  const query = parseMarketQuery(await searchParams, { game: set.game, lang: set.lang, setId: set.id }, rules.primaryGrade)
  return (
    <>
      <Breadcrumbs items={[{ name: 'Cards', path: '/cards/' }, { name: GAME_NAMES[set.game], path: cardsPath(set.game) }, { name: set.lang.toUpperCase(), path: cardsPath(set.game, set.lang) }, { name: set.name, path: setPath(set) }]} />
      <h1>{set.name} ({set.lang.toUpperCase()}) card list &amp; prices</h1>
      {set.intro && <p>{set.intro}</p>}
      <p><Link href={marketCapPath(set.game, set.lang, set.slug)}>Set market cap ranking</Link></p>
      <MarketCapTable query={query} basePath={setPath(set)} caption={`Top ${set.name} cards by market cap`} />
      <h2>All cards in {set.name}</h2>
      <ul>
        {cards.map((c) => (
          <li key={c.id}><Link href={cardPath(c)}>{c.number} {c.name}</Link> ({c.variant})</li>
        ))}
      </ul>
    </>
  )
}
