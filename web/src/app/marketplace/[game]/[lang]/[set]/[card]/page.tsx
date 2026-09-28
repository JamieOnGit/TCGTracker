import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AntiScam } from '@/components/AntiScam'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { fmtAud, gradeLabel, LangBadge } from '@/components/Format'
import { ListingTile } from '@/components/ListingTile'
import { EmptyState, Eyebrow, SegLinks } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { EBAY_DISCLOSURE, ebaySearchUrl } from '@/lib/domain/ebay'
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
    description: `${card.name} ${card.number} (${card.setName}, ${card.lang === 'jp' ? 'Japanese' : 'English'}) for sale from Australian sellers, cheapest first, in AUD. Message sellers on TCG Trade.`,
    searchParams: await searchParams,
  })
}

/** The Buy button's destination: every active listing for this exact card, cheapest first. */
export default async function CardMarketplace({ params, searchParams }: Props) {
  const card = await load(await params)
  if (!card) notFound()
  const sp = await searchParams
  const grade = typeof sp.grade === 'string' ? sp.grade.slice(0, 12) : undefined
  const repo = getRepo()
  const [rows, grades, rules] = await Promise.all([repo.listingsForCard(card.id, { status: 'active', gradeKey: grade }), repo.cardGrades(card.id), repo.getRules()])
  const ebay = rules.externalBuyFallback ? ebaySearchUrl({ cardId: card.id, name: card.name, number: card.number, setName: card.setName, lang: card.lang, game: card.game, gradeKey: grade ?? null }, rules.ebay) : null
  const base = cardMarketplacePath(card)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Marketplace', path: '/marketplace/' }, { name: GAME_NAMES[card.game], path: marketplacePath(card.game) }, { name: `${card.name} #${card.number}`, path: base }]} /></div>
      <div className="pb-8 pt-10">
        <Eyebrow>{card.setName} · #{card.number} · for sale in Australia</Eyebrow>
        <h1 className="mt-3 flex flex-wrap items-center gap-3">{card.name} <LangBadge lang={card.lang} /></h1>
        <p className="lead mt-3">
          {rows.length} {rows.length === 1 ? 'listing' : 'listings'}{grade ? ` in ${gradeLabel(grade)}` : ''}, cheapest first.{' '}
          <Link href={cardPath(card)} className="prose-link">Price history &amp; population</Link>
        </p>
        <div className="mt-6">
          <SegLinks label="Grade" options={[{ href: base, label: 'All grades', current: !grade }, ...grades.map((g) => ({ href: `${base}?grade=${g.gradeKey}&sort=price-asc`, label: `${gradeLabel(g.gradeKey)} · ${fmtAud(g.floorAud)}`, current: grade === g.gradeKey, rel: 'nofollow' }))]} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={`No ${grade ? gradeLabel(grade) + ' ' : ''}copies listed yet.`}
          body="Set an alert and we'll email you the moment one is listed, or check eBay Australia in the meantime."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href={`/account/alerts/new/?card=${card.id}${grade ? `&grade=${grade}` : ''}`} className="btn btn-holo" rel="nofollow">Alert me when listed</Link>
              {ebay && <a href={ebay} className="btn btn-secondary" rel="sponsored nofollow noopener" target="_blank" data-buy="ebay">Check eBay Australia ↗</a>}
              <Link href={sellPath({ cardId: card.id, gradeKey: grade })} className="btn btn-secondary" rel="nofollow">Sell yours</Link>
              {ebay && rules.ebay.affiliateEnabled && <p className="subtle w-full text-xs">{EBAY_DISCLOSURE}</p>}
            </div>
          }
        />
      ) : (
        <div className="grid-tiles cols-4">{rows.map((l) => <ListingTile key={l.id} l={l} marketAud={grades.find((g) => g.gradeKey === l.gradeKey)?.floorAud} />)}</div>
      )}
      <div className="mt-12"><AntiScam /></div>
    </div>
  )
}
