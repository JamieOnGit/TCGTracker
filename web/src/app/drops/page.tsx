import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { LiveDrops } from '@/components/LiveDrops'
import { PageIntro, SegLinks } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { AU_STATES, AU_STATE_NAMES } from '@/lib/data/types'
import { durationLabel, parseDropSource } from '@/lib/domain/drops'
import { buildMetadata, type SearchParams } from '@/lib/seo/metadata'
import { accountSightingsPath, dropsPath, dropsStatePath, scoutsPath } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { searchParams: Promise<SearchParams> }

// ?source= views are noindex,follow and canonicalise to /drops/ (buildMetadata treats any param as a facet).
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return buildMetadata({
    path: '/drops/',
    title: 'Pokémon & One Piece TCG Restocks & Pre-orders in Australia',
    description: 'Pokémon TCG and One Piece Card Game restocks, pre-orders and member in-store sightings at JB Hi-Fi, BIG W, Kmart, Target, EB Games and Premium Bandai AU, tagged against RRP.',
    searchParams: await searchParams,
  })
}

const EMPTY = {
  all: undefined,
  monitor: 'No retailer monitor events in the public history yet.',
  member: 'No confirmed member sightings in the public history yet. Seen stock in store? Report it.',
}

/** Public, delayed history (RLS enforces the delay) + the Premium live panel. */
export default async function Drops({ searchParams }: Props) {
  const source = parseDropSource((await searchParams).source)
  const repo = getRepo()
  const [rows, retailers, rules, scouts] = await Promise.all([repo.drops({ source, limit: 100 }), repo.retailers(), repo.getRules(), repo.scoutLeaderboard(30, 5)])
  const publicDelay = durationLabel(rules.dropsPublicDelayMinutes)
  const freeDelay = durationLabel(rules.freeDropDelayMinutes)
  const s = rules.sightings
  const monitored = retailers.filter((r) => r.monitored)
  const sightingsOnly = retailers.filter((r) => !r.monitored)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: '/drops/' }]} /></div>
      <PageIntro eyebrow="Retail drops · Australia · AEST/AEDT" title="Restocks & pre-orders" lead={`Pokémon and One Piece sealed product at Kmart, BIG W, Target, JB Hi-Fi, EB Games, Toymate, Myer and independent game stores: online stores checked around the clock, and members report what they see on the shelf. Premium members are alerted instantly; everyone else ${freeDelay} later.`}>
        <div className="mt-6 grid gap-3">
          <ChipNav label="Monitored 24/7" links={monitored.map((r) => ({ href: dropsPath(r.slug), text: r.name }))} />
          <ChipNav label="Member sightings" links={sightingsOnly.map((r) => ({ href: dropsPath(r.slug), text: r.name }))} />
          <ChipNav label="By state" links={AU_STATES.map((st) => ({ href: dropsStatePath(st), text: st, title: AU_STATE_NAMES[st] }))} />
        </div>
        <div className="mt-6">
          <Link href={accountSightingsPath()} className="btn btn-primary btn-sm" rel="nofollow">Seen stock in store? Report it</Link>
        </div>
      </PageIntro>
      <LiveDrops />
      <div className="grid lg:grid-cols-[1fr_300px] lg:gap-12">
        <section className="section min-w-0" aria-labelledby="hist-h">
          <h2 id="hist-h">Recent drops</h2>
          <p className="muted mt-2 text-sm">Shown {publicDelay} after each event. Prices in AUD, tagged against RRP.</p>
          <div className="mt-4">
            <SegLinks
              label="Source"
              options={[
                { href: '/drops/', label: 'All', current: !source },
                { href: '/drops/?source=monitor', label: 'Retailer monitors', current: source === 'monitor' },
                { href: '/drops/?source=member', label: 'Member sightings', current: source === 'member' },
              ]}
            />
          </div>
          <div className="mt-6"><DropFeed rows={rows} empty={EMPTY[source ?? 'all']} /></div>
          {repo.isDemo && <p className="provenance">Preview data.</p>}
        </section>
        <aside className="grid content-start gap-10 pb-16 lg:py-24">
          <section aria-labelledby="scouts-h">
            <h2 id="scouts-h" className="text-xl">Top scouts this month</h2>
            {scouts.length === 0 ? (
              <p className="muted mt-3 text-sm">No confirmed sightings in the last 30 days yet.</p>
            ) : (
              <ol className="mt-3">
                {scouts.map((sc, i) => (
                  <li key={sc.username} className="flex items-baseline justify-between gap-3 border-b py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
                    <span className="min-w-0"><span className="num muted mr-2">{i + 1}</span>{sc.username}{sc.states.length > 0 && <span className="muted"> · {sc.states.join(', ')}</span>}</span>
                    <span className="num" aria-label={`${sc.confirmed} confirmed sightings`}>{sc.confirmed}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 text-sm"><Link href={scoutsPath()} className="prose-link">How scouting works &amp; full leaderboard</Link></p>
          </section>
          <section aria-labelledby="how-h">
            <h2 id="how-h" className="text-xl">How alerts work</h2>
            <dl className="mt-3 grid gap-3 text-sm">
              <div><dt className="font-medium">Premium: instant</dt><dd className="muted">Push, email, Discord and the on-site live feed, the moment a monitor or a confirmed sighting fires.</dd></div>
              <div><dt className="font-medium">Free: {freeDelay} later</dt><dd className="muted">The same alerts by email and on-site, after a delay. The public history on this page appears {publicDelay} after each event.</dd></div>
              <div><dt className="font-medium">Sightings are confirmed by members</dt><dd className="muted">A report alerts once {s.confirmationsNeeded} other members confirm it ({s.confirmationsWithPhoto} if it has a photo), a trusted scout reports it, or a moderator checks it.</dd></div>
            </dl>
            <p className="mt-3 text-sm"><Link href="/premium/" className="prose-link">Compare Free and Premium</Link></p>
          </section>
        </aside>
      </div>
    </div>
  )
}

/** A labelled row of chip links; skipped when empty. */
function ChipNav({ label, links }: { label: string; links: { href: string; text: string; title?: string }[] }) {
  if (links.length === 0) return null
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="tag-quiet mr-1">{label}</span>
      {links.map((l) => <Link key={l.href} href={l.href} className="chip-filter" title={l.title}>{l.text}</Link>)}
    </nav>
  )
}
