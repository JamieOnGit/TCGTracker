import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { fmtAud2, fmtDate } from '@/components/Format'
import { JsonLd } from '@/components/JsonLd'
import { Markdown } from '@/components/Markdown'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { CONFIDENCE_HELP, formatReleaseDate, isUpcoming, KIND_LABEL, releaseDescription, releasePageTitle, todayAu } from '@/lib/releases'
import { releaseEvent } from '@/lib/seo/jsonld'
import { buildMetadata } from '@/lib/seo/metadata'
import {
  accountDropAlertsPath,
  dropsPath,
  GAME_NAMES,
  guidesPath,
  isGame,
  LANG_NAMES,
  marketCapPath,
  productPath,
  releasePath,
  releasesHubPath,
  releasesIcsPath,
  releasesPath,
  setPath,
} from '@/lib/seo/urls'
import { ConfidenceBadge, ReleaseTable } from '../../_components/ReleaseTable'
import { RemindButton } from '../../_components/RemindButton'

// /releases/{game}/{slug}/ — past releases stay indexable: people search "X release date" long after.
export const revalidate = 3600
type Props = { params: Promise<{ game: string; slug: string }> }

const load = cache(async (game: string, slug: string) => (isGame(game) ? getRepo().getRelease(game, slug) : null))

const PUBLISHER = { pokemon: 'The Pokémon Company', 'one-piece': 'Bandai' } as const

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game, slug } = await params
  const r = await load(game, slug)
  if (!r) return {}
  return buildMetadata({ path: releasePath(r.game, r.slug), title: releasePageTitle(r), description: releaseDescription(r) })
}

export default async function ReleaseDetail({ params }: Props) {
  const { game, slug } = await params
  const r = await load(game, slug)
  if (!r) notFound()
  const repo = getRepo()
  const path = releasePath(r.game, r.slug)
  const today = todayAu()
  const upcoming = isUpcoming(r, today)
  const when = formatReleaseDate(r)
  const [retailers, siblings, sealed] = await Promise.all([
    repo.retailers(),
    repo.releases({ game: r.game, from: today }),
    r.set ? repo.listSealedProducts({ game: r.game, lang: r.lang }) : Promise.resolve([]),
  ])
  // Sealed product pages for this release's set (live stock and prices per store).
  const productPages = r.set ? sealed.filter((p) => p.set?.slug === r.set!.slug) : []
  const stockists = r.retailerSlugs.map((s) => retailers.find((x) => x.slug === s)).filter((x) => x !== undefined)
  const next = siblings.filter((s) => s.id !== r.id).slice(0, 5)
  const dayKnown = r.datePrecision === 'day' && r.releaseDate
  const precisionNote =
    r.datePrecision === 'day' ? null : r.datePrecision === 'tbc' || !r.releaseDate ? 'No date has been announced yet.' : `Only the ${r.datePrecision} is known so far; we'll add the exact day when it is confirmed.`

  return (
    <div className="container-x">
      <div className="pt-6">
        <Breadcrumbs items={[{ name: 'Releases', path: releasesHubPath() }, { name: GAME_NAMES[r.game], path: releasesPath(r.game) }, { name: r.title, path }]} />
      </div>
      <PageIntro
        eyebrow={`${GAME_NAMES[r.game]} TCG · ${LANG_NAMES[r.lang]} · ${KIND_LABEL[r.kind]}`}
        title={`${r.title} release date`}
        lead={
          <>
            {when === 'TBC' ? 'Australian release date to be confirmed.' : `${upcoming ? (r.datePrecision === 'day' ? 'Out' : 'Expected') : 'Released'} in Australia ${r.datePrecision === 'day' ? 'on' : 'in'} `}
            {when !== 'TBC' && <strong>{dayKnown ? <time dateTime={r.releaseDate!}>{when}</time> : when}</strong>}
            {when !== 'TBC' && '.'} {r.summary}
          </>
        }
      >
        <div className="mt-6 flex flex-wrap items-start gap-3">
          {upcoming && <RemindButton releaseId={r.id} nextPath={path} />}
          <Link href={accountDropAlertsPath()} className="btn btn-holo">Get alerts when it lands</Link>
          {dayKnown && <a href={releasesIcsPath(r.game)} className="btn btn-ghost">Add to calendar</a>}
        </div>
      </PageIntro>

      <section className="section-tight" aria-labelledby="facts-h">
        <h2 id="facts-h" className="sr-only">Key facts</h2>
        <dl className="dl-rows max-w-[var(--measure)]">
          <dt>Australian release</dt>
          <dd>{when}{precisionNote && <span className="muted block text-xs">{precisionNote}</span>}</dd>
          <dt>Status</dt>
          <dd><ConfidenceBadge confidence={r.confidence} /><span className="muted block text-xs">{CONFIDENCE_HELP[r.confidence]}</span></dd>
          <dt>Language</dt>
          <dd>{LANG_NAMES[r.lang]} ({r.lang.toUpperCase()})</dd>
          <dt>Type</dt>
          <dd>{KIND_LABEL[r.kind]}</dd>
          {r.set && (
            <>
              <dt>Set</dt>
              <dd><Link href={setPath(r.set)} className="prose-link">{r.set.name} card list &amp; prices</Link></dd>
            </>
          )}
        </dl>
      </section>

      {r.products.length > 0 && (
        <section className="section-tight" aria-labelledby="products-h">
          <h2 id="products-h">Products and RRP</h2>
          <div className="table-wrap mt-4">
            <table className="dt">
              <caption className="sr-only">Products in this release with Australian RRP</caption>
              <thead><tr><th scope="col">Product</th><th scope="col" className="num">RRP (AUD)</th></tr></thead>
              <tbody>
                {r.products.map((p) => (
                  <tr key={p.name}><th scope="row">{p.name}</th><td className="num">{p.rrpAud === null ? 'TBC' : fmtAud2(p.rrpAud)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted mt-2 text-xs">RRP is the recommended retail price in Australian dollars where known. Retailers set their own prices, and some launch at, above or below RRP.</p>
        </section>
      )}

      {productPages.length > 0 && (
        <section className="section-tight" aria-labelledby="pp-h">
          <h2 id="pp-h">Stock and prices by product</h2>
          <ul className="mt-4 grid gap-2">
            {productPages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
                <Link href={productPath(p)} className="prose-link">{p.name}</Link>
                <span className="muted">{p.inStockCount > 0 ? `In stock at ${p.inStockCount} ${p.inStockCount === 1 ? 'store' : 'stores'}` : 'Not in stock right now'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section-tight" aria-labelledby="buy-h">
        <h2 id="buy-h">Where to buy in Australia</h2>
        {stockists.length > 0 ? (
          <>
            <p className="muted mt-2 text-sm">Retailers expected to stock it. Each link shows that retailer&apos;s recent restocks and pre-orders.</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {stockists.map((s) => <li key={s.slug}><Link href={dropsPath(s.slug)} className="chip-filter">{s.name}</Link></li>)}
            </ul>
          </>
        ) : (
          <p className="muted mt-2 text-sm">Stockists haven&apos;t been confirmed yet. Follow the <Link href={dropsPath()} className="prose-link">Australian restock feed</Link> for pre-orders as they open.</p>
        )}
        <p className="mt-4 text-sm">Tip: read <Link href={guidesPath('buy-pokemon-cards-at-rrp-australia')} className="prose-link">how to buy at RRP in Australia</Link> before launch day.</p>
      </section>

      {r.bodyMd && (
        <section className="section-tight" aria-labelledby="details-h">
          <h2 id="details-h">Details</h2>
          <div className="prose mt-4"><Markdown source={r.bodyMd} /></div>
        </section>
      )}

      <section className="section-tight">
        <p className="provenance">
          {r.sourceName && (
            <>
              Source:{' '}
              {r.sourceUrl ? <a href={r.sourceUrl} rel="nofollow noopener" target="_blank" className="prose-link">{r.sourceName}</a> : r.sourceName}
              {' · '}
            </>
          )}
          Last updated <time dateTime={r.updatedAt}>{fmtDate(r.updatedAt)}</time>. Dates are Australian (AEST/AEDT).
          {r.set && <> See the <Link href={marketCapPath(r.set.game, r.set.lang, r.set.slug)} className="prose-link">{r.set.name} market cap</Link>.</>}
        </p>
      </section>

      {next.length > 0 && (
        <section className="section-tight" aria-labelledby="next-h">
          <h2 id="next-h">More upcoming {GAME_NAMES[r.game]} releases</h2>
          <ReleaseTable rows={next} caption={`Upcoming ${GAME_NAMES[r.game]} releases`} />
          <p className="mt-4 text-sm"><Link href={releasesPath(r.game)} className="prose-link">Full {GAME_NAMES[r.game]} release calendar</Link></p>
        </section>
      )}

      <JsonLd
        data={releaseEvent({
          name: releasePageTitle(r),
          description: releaseDescription(r),
          path,
          startDate: dayKnown ? r.releaseDate : null,
          organizer: PUBLISHER[r.game],
        })}
      />
    </div>
  )
}
