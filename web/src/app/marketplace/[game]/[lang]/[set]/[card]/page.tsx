import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { gradeLabel } from '@/components/Format'
import { AntiScam, ListingList } from '@/components/ListingList'
import { getRepo } from '@/lib/data'
import { buildMetadata, titles, type SearchParams } from '@/lib/seo/metadata'
import { cardMarketplacePath, cardPath, GAME_NAMES, isGame, isLang, marketplacePath, sellPath } from '@/lib/seo/urls'

export const revalidate = 60
type Params = { game: string; lang: string; set: string; card: string }
type Props = { params: Promise<Params>; searchParams: Promise<SearchParams> }

async function load(p: Params) {
  if (!isGame(p.game) || !isLang(p.lang)) return null
  return getRepo().getCard(p.game, p.lang, p.set, p.card)
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const card = await load(await params)
  if (!card) return {}
  return buildMetadata({
    path: cardMarketplacePath(card),
    title: titles.cardMarketplace({ name: card.name, number: card.number, setName: card.setName, lang: card.lang }),
    description: `Buy ${card.name} ${card.number} (${card.setName}, ${card.lang === 'jp' ? 'Japanese' : 'English'}) from Australian sellers. Listings sorted by lowest price, in AUD.`,
    searchParams: await searchParams,
  })
}

/** The Buy button's target: all active listings for this exact card, cheapest first. */
export default async function CardMarketplace({ params, searchParams }: Props) {
  const card = await load(await params)
  if (!card) notFound()
  const sp = await searchParams
  const grade = typeof sp.grade === 'string' ? sp.grade : undefined
  const rows = await getRepo().listingsForCard(card.id, { status: 'active', gradeKey: grade })
  return (
    <>
      <Breadcrumbs items={[{ name: 'Marketplace', path: '/marketplace/' }, { name: GAME_NAMES[card.game], path: marketplacePath(card.game) }, { name: `${card.name} ${card.number} ${card.lang.toUpperCase()}`, path: cardMarketplacePath(card) }]} />
      <h1>
        {rows.length} {rows.length === 1 ? 'listing' : 'listings'} for {card.name} {card.number} ({card.setName}, {card.lang.toUpperCase()})
        {grade ? ` · ${gradeLabel(grade)}` : ''}
      </h1>
      <p>Sorted by lowest price. <Link href={cardPath(card)}>Price, population &amp; market cap for this card</Link> · <Link href={sellPath({ cardId: card.id, gradeKey: grade })} rel="nofollow">Sell yours</Link></p>
      <AntiScam />
      <ListingList rows={rows} />
    </>
  )
}
