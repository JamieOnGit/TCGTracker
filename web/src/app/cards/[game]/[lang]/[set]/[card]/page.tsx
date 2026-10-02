import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Fragment } from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { LineChart } from '@/components/Charts'
import { DataNotice } from '@/components/DataNotice'
import { Change, fmtAud, fmtAudShort, fmtDate, fmtInt, gradeLabel, LangBadge, basisLabel } from '@/components/Format'
import { JsonLd } from '@/components/JsonLd'
import { ListingTile } from '@/components/ListingTile'
import { CardImage, Eyebrow, SegLinks, Stat, StatStrip } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { resolveBuyButton } from '@/lib/domain/buyButton'
import { gradeOptions, graderOf, isPriceKey, sortGradeKeys } from '@/lib/domain/grades'
import { EBAY_DISCLOSURE, ebaySearchUrl } from '@/lib/domain/ebay'
import { cardProduct } from '@/lib/seo/jsonld'
import { buildMetadata, titles, type SearchParams } from '@/lib/seo/metadata'
import { articlePath, cardMarketplacePath, cardPath, cardsPath, GAME_NAMES, isGame, isLang, setPath } from '@/lib/seo/urls'

export const revalidate = 900
type Params = { game: string; lang: string; set: string; card: string }
type Props = { params: Promise<Params>; searchParams: Promise<SearchParams> }

async function load(p: Params) {
  if (!isGame(p.game) || !isLang(p.lang)) return null
  return getRepo().getCard(p.game, p.lang, p.set, p.card)
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const card = await load(await params)
  if (!card) return {}
  const grades = await getRepo().cardGrades(card.id)
  const psa10 = grades.find((g) => g.gradeKey === 'psa-10')
  const raw = grades.find((g) => g.gradeKey === 'raw')
  return buildMetadata({
    path: cardPath(card),
    title: titles.card({ name: card.name, number: card.number, printedTotal: card.printedTotal, setName: card.setName, lang: card.lang }),
    description: `${card.name} ${card.number} (${card.setName}, ${card.lang === 'jp' ? 'Japanese' : 'English'})${raw?.floorAud ? ` market price ${fmtAud(raw.floorAud)},` : ''} PSA 10 value ${fmtAud(psa10?.floorAud)} in Australian dollars${psa10?.population ? `, PSA 10 population ${fmtInt(psa10.population)}` : ''}. Price history, grades, and copies for sale in Australia.`,
    searchParams: await searchParams,
  })
}

export default async function CardPage({ params, searchParams }: Props) {
  const card = await load(await params)
  if (!card) notFound()
  const sp = await searchParams
  const repo = getRepo()
  const rules = await repo.getRules()
  // Any PSA/BGS/CGC/SGC grade can be asked for; ?grade= pages are noindex facets.
  const gradeKey = isPriceKey(sp.grade) ? sp.grade : rules.primaryGrade
  const [gradeRows, stats, active, closed, news, related, counterpart, history] = await Promise.all([
    repo.cardGrades(card.id),
    repo.listingStats([card.id]),
    repo.listingsForCard(card.id, { status: 'active' }),
    repo.listingsForCard(card.id, { status: 'closed' }),
    repo.articlesForCard(card.id),
    repo.listCardsInSet(card.setId),
    card.counterpartCardId ? repo.getCardsByIds([card.counterpartCardId]).then((c) => c[0] ?? null) : Promise.resolve(null),
    repo.valueHistory(card.id, gradeKey),
  ])
  const grades = sortGradeKeys(gradeRows.map((x) => x.gradeKey)).map((k) => gradeRows.find((x) => x.gradeKey === k)!)
  const options = gradeOptions(grades.map((x) => x.gradeKey))
  const g = grades.find((x) => x.gradeKey === gradeKey)
  const isPsa = graderOf(gradeKey) === 'psa'
  const first = history[0]?.value
  const last = history.at(-1)?.value
  const change30 = first && last ? ((last - first) / first) * 100 : null
  const spanDays = history.length > 1 ? Math.round((new Date(history.at(-1)!.date).getTime() - new Date(history[0]!.date).getTime()) / 86_400_000) : 0
  const ebay = rules.externalBuyFallback
    ? ebaySearchUrl({ cardId: card.id, name: card.name, number: card.number, setName: card.setName, lang: card.lang, game: card.game, gradeKey }, rules.ebay)
    : null
  const buy = resolveBuyButton({ card, gradeKey, stats, externalFallback: Boolean(ebay), externalUrl: ebay })
  const number = card.printedTotal ? `${card.number}/${card.printedTotal}` : card.number
  const prices = active.map((l) => l.priceAud)
  const totalPop = grades.reduce((s, x) => s + (x.population ?? 0), 0)

  return (
    <div className="container-x">
      <div className="pt-6">
        <Breadcrumbs
          items={[
            { name: 'Cards', path: '/cards/' },
            { name: GAME_NAMES[card.game], path: cardsPath(card.game) },
            { name: card.lang === 'jp' ? 'Japanese' : 'English', path: cardsPath(card.game, card.lang) },
            { name: card.setName, path: setPath({ game: card.game, lang: card.lang, slug: card.setSlug }) },
            { name: `${card.name} #${card.number}`, path: cardPath(card) },
          ]}
        />
      </div>

      <section className="grid gap-10 pt-8 lg:grid-cols-12 lg:gap-16">
        <div className="min-w-0 lg:col-span-5">
          <div className="well lg:sticky lg:top-[calc(var(--header-h)+24px)]" style={{ padding: 48 }}>
            <div className="w-full max-w-[320px]">
              <CardImage src={card.imageUrl} alt={`${card.name} ${number} ${card.setName} ${card.lang === 'jp' ? 'Japanese' : 'English'} card`} name={card.name} />
            </div>
          </div>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <Eyebrow>
            {card.setName} · {number} · {card.variant.replace('-', ' ')}
          </Eyebrow>
          <h1 className="mt-3 flex flex-wrap items-center gap-3">
            {card.name} <LangBadge lang={card.lang} />
          </h1>
          <p className="muted mt-3 text-sm">
            {card.lang === 'jp' ? 'Japanese' : 'English'} printing.{' '}
            {counterpart ? (
              <Link href={cardPath(counterpart)} className="prose-link">
                See the {counterpart.lang === 'jp' ? 'Japanese' : 'English'} version ({counterpart.setName} #{counterpart.number})
              </Link>
            ) : (
              'No linked printing in the other language yet.'
            )}
          </p>

          <div className="mt-8">
            <SegLinks
              label="Grade"
              options={(options.includes(gradeKey) ? options : [...options, gradeKey]).map((k) => ({ href: k === rules.primaryGrade ? cardPath(card) : `${cardPath(card)}?grade=${k}`, label: gradeLabel(k), current: k === gradeKey, rel: k === rules.primaryGrade ? undefined : 'nofollow' }))}
            />
            <div className="mt-6 flex flex-wrap items-baseline gap-4">
              <p className="num" style={{ fontSize: 'var(--text-4xl)', fontWeight: 300, lineHeight: 1 }}>{fmtAud(g?.floorAud)}</p>
              <Change value={change30} chip period={spanDays ? `${spanDays}d` : undefined} />
            </div>
            <p className="muted mt-2 text-xs">
              {gradeLabel(gradeKey)} · {basisLabel(g?.basis ?? null)}
              {g?.sampleSize ? ` from ${g.sampleSize} asks` : ''} · as of {fmtDate(g?.observedAt)}
              {g?.lastSoldAud ? ` · last sale ${fmtAud(g.lastSoldAud)}` : ''}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {buy.kind === 'listings' ? (
              <Link href={buy.href} className="btn btn-primary">Buy on TCGTracker · {buy.count} from {fmtAudShort(buy.fromAud)}</Link>
            ) : (
              <>
                {buy.external && <a href={buy.external.href} className="btn btn-secondary" rel="sponsored nofollow noopener" target="_blank" data-buy="ebay">Check eBay Australia ↗</a>}
                <Link href={buy.setAlertHref} className="btn btn-holo" rel="nofollow">Alert me when listed</Link>
              </>
            )}
            <Link href={buy.kind === 'none' ? buy.sellHref : `/account/listings/new/?card=${card.id}&grade=${gradeKey}`} className="btn btn-secondary" rel="nofollow">Sell yours</Link>
          </div>
          {buy.kind === 'none' && buy.external && rules.ebay.affiliateEnabled && <p className="subtle mt-2 text-xs">{EBAY_DISCLOSURE}</p>}

          <div className="mt-10">
            <StatStrip cols={3}>
              <Stat small label={`${gradeLabel(gradeKey)} market cap`} value={fmtAudShort(g?.marketCapAud)} sub={g?.population ? `${fmtInt(g.population)} graded × ${fmtAud(g.floorAud)}` : isPsa ? 'Awaiting population data' : 'Market cap uses PSA grades'} />
              <Stat small label={`${gradeLabel(gradeKey)} population`} value={fmtInt(g?.population)} sub={totalPop ? `${Math.round(((g?.population ?? 0) / totalPop) * 100)}% of graded copies` : isPsa ? 'PSA' : 'Not tracked yet'} />
              <Stat small label="For sale in Australia" value={active.length} sub={prices.length ? `from ${fmtAud(Math.min(...prices))}` : 'None listed yet'} />
            </StatStrip>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="history-h">
        <h2 id="history-h">{gradeLabel(gradeKey)} value history</h2>
        <div className="mt-6"><LineChart points={history} label={`${card.name} ${gradeLabel(gradeKey)} value in AUD over time`} /></div>
        <details className="mt-4">
          <summary className="muted cursor-pointer text-sm">Show the numbers</summary>
          <div className="table-wrap mt-3">
            <table className="dt">
              <caption className="sr-only">Daily {gradeLabel(gradeKey)} value, AUD</caption>
              <thead><tr><th scope="col">Date</th><th scope="col" className="n">Value (A$)</th></tr></thead>
              <tbody>{history.slice(-30).reverse().map((p) => <tr key={p.date}><td>{fmtDate(p.date)}</td><td className="n">{fmtAud(p.value).replace('A$', '')}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
        <DataNotice asOf={g?.observedAt ?? null} demo={repo.isDemo} sources="JustTCG market prices from recent sales (raw and graded, converted from USD), TCGTracker marketplace" />
      </section>

      <section aria-labelledby="grades-h">
        <h2 id="grades-h">By grade</h2>
        <p className="muted mt-2 max-w-[var(--measure)] text-sm">PSA grades drive market cap. BGS, CGC and SGC values are shown for comparison: the same card can sell for different amounts in each company’s slab.</p>
        <div className="table-wrap mt-6">
          <table className="dt">
            <caption className="sr-only">{card.name} value, population and market cap by grading company and grade</caption>
            <thead><tr><th scope="col">Grade</th><th scope="col" className="n">Value (A$)</th><th scope="col" className="n">Population</th><th scope="col" className="n hide-sm">Market cap</th><th scope="col" className="n hide-sm">Last sale</th><th scope="col" className="n hide-md">30d median sold</th></tr></thead>
            <tbody>
              {grades.map((x) => (
                <tr key={x.gradeKey} aria-selected={x.gradeKey === gradeKey}>
                  <th scope="row"><Link href={x.gradeKey === rules.primaryGrade ? cardPath(card) : `${cardPath(card)}?grade=${x.gradeKey}`} rel="nofollow" className="prose-link">{gradeLabel(x.gradeKey)}</Link></th>
                  <td className="n">{fmtAud(x.floorAud).replace('A$', '')}</td>
                  <td className="n">{fmtInt(x.population)}</td>
                  <td className="n hide-sm">{fmtAudShort(x.marketCapAud)}</td>
                  <td className="n hide-sm">{fmtAud(x.lastSoldAud)}</td>
                  <td className="n hide-md">{fmtAud(x.medianSold30dAud)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" aria-labelledby="listings-h">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="listings-h">For sale in Australia</h2>
          <Link href={cardMarketplacePath(card)} className="btn-ghost text-sm">All listings for this card</Link>
        </div>
        {active.length === 0 ? (
          <p className="muted mt-4">No copies listed yet. <Link href={buy.kind === 'none' ? buy.setAlertHref : '/account/alerts/'} className="prose-link" rel="nofollow">Get an alert</Link> when one is.</p>
        ) : (
          <div className="grid-tiles cols-4 mt-6">{active.slice(0, 8).map((l) => <ListingTile key={l.id} l={l} marketAud={grades.find((x) => x.gradeKey === l.gradeKey)?.floorAud} />)}</div>
        )}
        {closed.length > 0 && (
          <>
            <h3 className="mt-12">Recent sales on TCGTracker</h3>
            <div className="table-wrap mt-4">
              <table className="dt">
                <thead><tr><th scope="col">Date</th><th scope="col">Grade</th><th scope="col" className="n">Price (A$)</th></tr></thead>
                <tbody>{closed.slice(0, 10).map((l) => <tr key={l.id}><td>{fmtDate(l.closedAt)}</td><td>{gradeLabel(l.gradeKey)}</td><td className="n">{fmtAud(l.priceAud).replace('A$', '')}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="grid gap-12 md:grid-cols-2">
        <div>
          <h2>More from {card.setName}</h2>
          <ul className="mt-4 grid gap-2 text-sm">
            {related.filter((c) => c.id !== card.id).slice(0, 12).map((c) => (
              <li key={c.id}><Link href={cardPath(c)} className="prose-link">{c.name} #{c.number}</Link></li>
            ))}
            <li><Link href={setPath({ game: card.game, lang: card.lang, slug: card.setSlug })} className="prose-link">Full {card.setName} card list →</Link></li>
          </ul>
        </div>
        <div>
          <h2>News</h2>
          {news.length === 0 ? <p className="muted mt-4 text-sm">No articles mention this card yet.</p> : (
            <ul className="mt-4 grid gap-2 text-sm">{news.map((a) => <li key={a.slug}><Link href={articlePath(new Date(a.publishedAt), a.slug)} className="prose-link">{a.title}</Link></li>)}</ul>
          )}
          <h3 className="mt-10">Identifiers</h3>
          <dl className="dl-rows mt-2">
            <dt>card_id</dt><dd><code className="text-xs">{card.id}</code></dd>
            <dt>Set code</dt><dd>{card.setCode}</dd>
            <dt>PSA spec</dt><dd>{card.psaSpecId ?? '—'}</dd>
            {card.externalIds.map((e) => (
              <Fragment key={e.source}><dt>{e.source}</dt><dd>{e.externalId}</dd></Fragment>
            ))}
          </dl>
        </div>
      </section>

      <JsonLd
        data={cardProduct({
          name: `${card.name} ${number} ${card.setName} (${card.lang === 'jp' ? 'Japanese' : 'English'})`,
          path: cardPath(card),
          image: card.imageUrl,
          cardId: card.id,
          sku: `${card.setCode}-${card.number}-${card.lang}`,
          brand: card.game === 'pokemon' ? 'Pokémon TCG' : 'One Piece Card Game',
          offers: prices.length ? { lowAud: Math.min(...prices), highAud: Math.max(...prices), count: prices.length } : null,
          values: grades.filter((x) => x.floorAud !== null && isPriceKey(x.gradeKey)).map((x) => ({ name: x.gradeKey === 'raw' ? 'Market price (ungraded, Near Mint)' : `${gradeLabel(x.gradeKey)} value`, aud: x.floorAud! })),
        })}
      />
    </div>
  )
}
