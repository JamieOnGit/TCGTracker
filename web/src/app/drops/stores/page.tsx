import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { Faq } from '@/components/DropsCopy'
import { PageIntro, Stat, StatStrip } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { AU_STATE_NAMES } from '@/lib/data/types'
import { intervalLabel, monogram, storeCoverage, STORE_KIND_LABEL, type CoverageStatus } from '@/lib/domain/stock'
import { buildMetadata } from '@/lib/seo/metadata'
import { accountSightingsPath, dropsPath, inStockPath, scoutsPath, storesPath } from '@/lib/seo/urls'

export const revalidate = 300

export const metadata: Metadata = buildMetadata({
  path: storesPath(),
  title: 'Australian TCG Stores We Watch for Restocks',
  description: 'Every Australian store TCGTracker watches for Pokémon and One Piece restocks: which are checked live, how often, and which are covered by member sightings.',
})

const BADGE: Record<CoverageStatus, string> = { live: 'badge-live', setup: 'badge-lang', sightings: 'badge-lang', blocked: 'badge-warn' }
const ORDER: Record<CoverageStatus, number> = { live: 0, setup: 1, blocked: 2, sightings: 3 }

const FAQS = [
  {
    q: 'How do you check stores?',
    a: 'Our monitor reads what each store publishes openly, such as its public product catalogue, identifies itself honestly as TCGTracker’s bot, follows the store’s robots.txt and slows down when asked. We never get around a store’s bot protection.',
  },
  {
    q: 'Why is a store marked “Not reachable”?',
    a: 'Some stores block automated visitors, for example by showing a challenge page. We respect that and stop checking. Those stores are covered by member sightings: members report stock they see online or on the shelf, and other members confirm it before anyone is alerted.',
  },
  {
    q: 'Can you add my local store?',
    a: 'Yes. Report a sighting at any independent store and tell us about it; stores that publish an open online catalogue can be added to the monitor.',
  },
]

/** Store coverage: every store we watch and how, honestly. */
export default async function Stores() {
  const repo = getRepo()
  const now = new Date()
  const stores = (await repo.retailers()).map((r) => ({ r, c: storeCoverage(r, now) })).sort((a, b) => ORDER[a.c.status] - ORDER[b.c.status] || a.r.name.localeCompare(b.r.name))
  const n = (s: CoverageStatus) => stores.filter((x) => x.c.status === s).length
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: dropsPath() }, { name: 'Stores we watch', path: storesPath() }]} /></div>
      <PageIntro
        eyebrow="Store coverage · Australia"
        title="Stores we watch"
        lead="Every store in our restock feed and how we cover it. Online stores that publish their catalogue openly are checked around the clock; the rest are covered by members who see stock in store and report it."
      >
        <div className="mt-8">
          <StatStrip cols={4}>
            <Stat label="Stores" value={stores.length} small />
            <Stat label="Checked live" value={n('live')} small />
            <Stat label="Member sightings only" value={n('sightings')} small />
            <Stat label="Blocked by the store" value={n('blocked')} small />
          </StatStrip>
        </div>
      </PageIntro>

      <section className="section-tight" aria-labelledby="stores-h">
        <h2 id="stores-h">All stores</h2>
        <div className="table-wrap mt-4">
          <table className="dt">
            <caption className="sr-only">Stores we watch, how each is covered and how often it is checked</caption>
            <thead>
              <tr><th scope="col">Store</th><th scope="col" className="hide-sm">Type</th><th scope="col" className="hide-sm">State</th><th scope="col">Coverage</th><th scope="col" className="hide-sm">Checked</th></tr>
            </thead>
            <tbody>
              {stores.map(({ r, c }) => (
                <tr key={r.slug} data-coverage={c.status}>
                  <th scope="row">
                    <span className="inline-flex items-center gap-2">
                      <span className="mono" aria-hidden="true">{monogram(r.name)}</span>
                      <Link href={dropsPath(r.slug)} className="prose-link" style={{ textDecorationColor: 'transparent' }}>{r.name}</Link>
                    </span>
                  </th>
                  <td className="hide-sm">{r.kind ? STORE_KIND_LABEL[r.kind] : '—'}</td>
                  <td className="hide-sm">{r.state ? <abbr title={AU_STATE_NAMES[r.state]} style={{ textDecoration: 'none' }}>{r.state}</abbr> : 'Australia-wide'}</td>
                  <td><span className={`badge ${BADGE[c.status]}`} style={{ whiteSpace: 'normal', height: 'auto', minHeight: 20 }}>{c.status === 'live' ? '● ' : ''}{c.label}</span></td>
                  <td className="hide-sm">{c.status === 'live' ? intervalLabel(r.watchIntervalSeconds) ?? 'Around the clock' : c.status === 'sightings' || c.status === 'blocked' ? 'By members' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {repo.isDemo && <p className="provenance">Preview data.</p>}
      </section>

      <section className="section-tight" aria-labelledby="how-h">
        <h2 id="how-h">How we watch stores</h2>
        <div className="prose mt-4 max-w-[var(--measure)]">
          <p>We only read what stores publish openly to everyone. Our monitor identifies itself honestly, follows each store&apos;s robots.txt and backs off when a store asks it to slow down.</p>
          <p>When a store blocks automated access we stop checking it and say so here. Those stores, and shops without an online catalogue, are covered by <Link href={scoutsPath()}>member sightings</Link>: stock members have seen, confirmed by other members before anyone is alerted.</p>
          <p>See what is <Link href={inStockPath()}>in stock right now</Link>, or <Link href={accountSightingsPath()} rel="nofollow">report stock you have seen</Link>.</p>
        </div>
      </section>

      <Faq faqs={FAQS} title="Store coverage questions" />
      <div className="pb-16" />
    </div>
  )
}
