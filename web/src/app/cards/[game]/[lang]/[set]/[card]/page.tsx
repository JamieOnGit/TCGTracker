import type { Metadata } from 'next'
import Link from 'next/link'
import { Fragment } from 'react'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DataNotice } from '@/components/DataNotice'
import { basisLabel, fmtAud, fmtInt, gradeLabel } from '@/components/Format'
import { JsonLd } from '@/components/JsonLd'
import { getRepo } from '@/lib/data'
import { resolveBuyButton } from '@/lib/domain/buyButton'
import { cardProduct } from '@/lib/seo/jsonld'
import { buildMetadata, titles } from '@/lib/seo/metadata'
import {
  articlePath,
  cardMarketplacePath,
  cardPath,
  cardsPath,
  GAME_NAMES,
  isGame,
  isLang,
  listingPath,
  setPath,
} from '@/lib/seo/urls'

export const revalidate = 900
type Params = { game: string; lang: string; set: string; card: string }
type Props = { params: Promise<Params> }

async function load(p: Params) {
  if (!isGame(p.game) || !isLang(p.lang)) return null
  return getRepo().getCard(p.game, p.lang, p.set, p.card)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = await load(await params)
  if (!card) return {}
  const grades = await getRepo().cardGrades(card.id)
  const psa10 = grades.find((g) => g.gradeKey === 'psa-10')
  return buildMetadata({
    path: cardPath(card),
    title: titles.card({ name: card.name, number: card.number, printedTotal: card.printedTotal, setName: card.setName, lang: card.lang }),
    description: `${card.name} ${card.number} (${card.setName}, ${card.lang === 'jp' ? 'Japanese' : 'English'}): PSA 10 population ${fmtInt(psa10?.population)}, floor ${fmtAud(psa10?.floorAud)}, market cap ${fmtAud(psa10?.marketCapAud)}. Prices in AUD.`,
  })
}

export default async function CardPage({ params }: Props) {
  const card = await load(await params)
  if (!card) notFound()
  const repo = getRepo()
  const [grades, stats, active, closed, news, related, rules, counterpart] = await Promise.all([
    repo.cardGrades(card.id),
    repo.listingStats([card.id]),
    repo.listingsForCard(card.id, { status: 'active' }),
    repo.listingsForCard(card.id, { status: 'closed' }),
    repo.articlesForCard(card.id),
    repo.listCardsInSet(card.setId),
    repo.getRules(),
    card.counterpartCardId ? repo.getCardsByIds([card.counterpartCardId]).then((c) => c[0] ?? null) : Promise.resolve(null),
  ])
  const primary = rules.primaryGrade
  const [popHistory, capHistory] = await Promise.all([repo.popHistory(card.id, primary), repo.marketCapHistory(card.id, primary)])
  const buy = resolveBuyButton({ card, gradeKey: primary, stats, externalFallback: rules.externalBuyFallback })
  const prices = active.map((l) => l.priceAud)
  const number = card.printedTotal ? `${card.number}/${card.printedTotal}` : card.number

  return (
    <>
      <Breadcrumbs
        items={[
          { name: 'Cards', path: '/cards/' },
          { name: GAME_NAMES[card.game], path: cardsPath(card.game) },
          { name: card.lang.toUpperCase(), path: cardsPath(card.game, card.lang) },
          { name: card.setName, path: setPath({ game: card.game, lang: card.lang, slug: card.setSlug }) },
          { name: card.name, path: cardPath(card) },
        ]}
      />
      <h1>
        {card.name} {number} · {card.setName} · {card.lang.toUpperCase()}
      </h1>
      <p>
        {card.lang === 'jp' ? 'Japanese' : 'English'} version.{' '}
        {counterpart ? (
          <Link href={cardPath(counterpart)}>
            See the {counterpart.lang === 'jp' ? 'Japanese' : 'English'} version ({counterpart.setName} {counterpart.number})
          </Link>
        ) : (
          'No linked counterpart in the other language yet.'
        )}
      </p>
      <p>
        {buy.kind === 'listings' ? (
          <Link href={buy.href}>{buy.label}</Link>
        ) : (
          <>
            {buy.label} · <Link href={buy.setAlertHref} rel="nofollow">Set alert</Link> · <Link href={buy.sellHref} rel="nofollow">Sell yours</Link>
          </>
        )}{' '}
        · <Link href={cardMarketplacePath(card)}>All listings for this card</Link>
      </p>

      <h2>Market cap by grade</h2>
      <table>
        <caption>Population × floor price, AUD</caption>
        <thead>
          <tr><th scope="col">Grade</th><th scope="col">PSA pop</th><th scope="col">Floor</th><th scope="col">Basis</th><th scope="col">Market cap</th><th scope="col">Last sale</th><th scope="col">30d median sold</th></tr>
        </thead>
        <tbody>
          {grades.map((g) => (
            <tr key={g.gradeKey}>
              <th scope="row">{gradeLabel(g.gradeKey)}</th>
              <td>{fmtInt(g.population)}</td>
              <td>{fmtAud(g.floorAud)}</td>
              <td>{basisLabel(g.basis)}{g.sampleSize ? ` (n=${g.sampleSize})` : ''}</td>
              <td>{fmtAud(g.marketCapAud)}</td>
              <td>{fmtAud(g.lastSoldAud)}</td>
              <td>{fmtAud(g.medianSold30dAud)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <DataNotice asOf={grades[0]?.observedAt?.slice(0, 10) ?? null} sources="see methodology" demo={repo.isDemo} />

      <h2>{gradeLabel(primary)} population history</h2>
      <table>
        <caption>Chart data (the chart itself renders from this table)</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Population</th></tr></thead>
        <tbody>{popHistory.slice(-10).map((p) => <tr key={p.date}><td>{p.date}</td><td>{fmtInt(p.value)}</td></tr>)}</tbody>
      </table>

      <h2>{gradeLabel(primary)} market cap history</h2>
      <table>
        <caption>Daily market cap, AUD</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Market cap</th></tr></thead>
        <tbody>{capHistory.slice(-10).map((p) => <tr key={p.date}><td>{p.date}</td><td>{fmtAud(p.value)}</td></tr>)}</tbody>
      </table>

      <h2>Active listings</h2>
      {active.length === 0 ? (
        <p>No active listings. <Link href={buy.kind === 'none' ? buy.sellHref : '/account/listings/new/'} rel="nofollow">Sell yours</Link></p>
      ) : (
        <ul>{active.map((l) => <li key={l.id}><Link href={listingPath(l.id, l.title)}>{l.title}</Link> — {fmtAud(l.priceAud)} ({l.state})</li>)}</ul>
      )}

      <h2>Sold history</h2>
      {closed.length === 0 ? <p>No sales recorded on our marketplace yet.</p> : (
        <table>
          <caption>Recent sales on our marketplace</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Grade</th><th scope="col">Price</th></tr></thead>
          <tbody>{closed.map((l) => <tr key={l.id}><td>{l.closedAt?.slice(0, 10)}</td><td>{gradeLabel(l.gradeKey)}</td><td>{fmtAud(l.priceAud)}</td></tr>)}</tbody>
        </table>
      )}

      <h2>Related news</h2>
      {news.length === 0 ? <p>No articles yet.</p> : (
        <ul>{news.map((a) => <li key={a.slug}><Link href={articlePath(new Date(a.publishedAt), a.slug)}>{a.title}</Link></li>)}</ul>
      )}

      <h2>More from {card.setName}</h2>
      <ul>{related.filter((c) => c.id !== card.id).slice(0, 12).map((c) => <li key={c.id}><Link href={cardPath(c)}>{c.number} {c.name}</Link></li>)}</ul>

      <h2>Identifiers</h2>
      <dl>
        <dt>card_id</dt><dd><code>{card.id}</code></dd>
        <dt>PSA spec</dt><dd>{card.psaSpecId ?? '—'}</dd>
        {card.externalIds.map((e) => (
          <Fragment key={e.source}>
            <dt>{e.source}</dt>
            <dd>{e.externalId}</dd>
          </Fragment>
        ))}
      </dl>

      <JsonLd
        data={cardProduct({
          name: `${card.name} ${number} ${card.setName} (${card.lang.toUpperCase()})`,
          path: cardPath(card),
          image: card.imageUrl,
          cardId: card.id,
          sku: `${card.setCode}-${card.number}-${card.lang}`,
          brand: card.game === 'pokemon' ? 'Pokémon TCG' : 'One Piece Card Game',
          offers: prices.length ? { lowAud: Math.min(...prices), highAud: Math.max(...prices), count: prices.length } : null,
        })}
      />
    </>
  )
}
