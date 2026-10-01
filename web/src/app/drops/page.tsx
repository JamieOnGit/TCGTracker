import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { LiveDrops } from '@/components/LiveDrops'
import { PageIntro, SegLinks } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { AU_STATES, AU_STATE_NAMES } from '@/lib/data/types'
import { durationLabel, parseDropSource } from '@/lib/domain/drops'
import { countByStatus, dropStatus, feedHref, parseGame, parseSort, parseStatus, STATUS_CHIP_LABEL, STATUS_KEYS, type StatusKey } from '@/lib/domain/stock'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { accountSightingsPath, dropsPath, dropsStatePath, GAME_NAMES, GAMES, inStockPath, productsPath, scoutsPath, storesPath } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { searchParams: Promise<SearchParams> }

// ?status= / ?game= / ?sort= views are noindex,follow and canonicalise to
// /drops/ (buildMetadata treats any param as a facet); ?page= is noindex too.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams
  return buildMetadata({
    path: '/drops/',
    title: 'Pokémon & One Piece TCG Restocks & Pre-orders in Australia',
    description: 'Pokémon TCG and One Piece Card Game restocks, pre-orders and member in-store sightings at JB Hi-Fi, BIG W, Kmart, Target, EB Games and Premium Bandai AU, tagged against RRP.',
    searchParams: sp,
    noindex: pageNumber(sp) > 1,
  })
}

/** Events loaded per view (counts are over these); the first page is server-rendered. */
const FEED_LOAD = 300
const PAGE_SIZE = 50

const EMPTY: Record<StatusKey, string | undefined> = {
  all: undefined,
  restock: 'No restocks in the public history yet.',
  new: 'No new listings in the public history yet.',
  preorder: 'No pre-orders in the public history yet.',
  'price-drop': 'No price drops in the public history yet.',
  sighting: 'No confirmed member sightings in the public history yet. Seen stock in store? Report it.',
}

/** Public, delayed history (RLS enforces the delay) + the Premium live panel. */
export default async function Drops({ searchParams }: Props) {
  const sp = await searchParams
  // Legacy ?source=member is the "Member sightings" chip; ?source=monitor still filters at the source.
  const legacy = parseDropSource(sp.source)
  const status = sp.status ? parseStatus(sp.status) : legacy === 'member' ? 'sighting' : 'all'
  const game = parseGame(sp.game)
  const sort = parseSort(sp.sort)
  const page = Math.min(pageNumber(sp), Math.ceil(FEED_LOAD / PAGE_SIZE))
  const repo = getRepo()
  const [loaded, retailers, rules, scouts] = await Promise.all([
    repo.drops({ game, source: legacy === 'monitor' ? 'monitor' : undefined, limit: FEED_LOAD }),
    repo.retailers(),
    repo.getRules(),
    repo.scoutLeaderboard(30, 5),
  ])
  const counts = countByStatus(loaded)
  const matching = loaded
    .filter((d) => status === 'all' || dropStatus(d).key === status)
    .sort((a, b) => (sort === 'oldest' ? a.occurredAt.localeCompare(b.occurredAt) : b.occurredAt.localeCompare(a.occurredAt)))
  const rows = matching.slice(0, page * PAGE_SIZE)
  const q = { status, game, sort }
  const publicDelay = durationLabel(rules.dropsPublicDelayMinutes)
  const freeDelay = durationLabel(rules.freeDropDelayMinutes)
  const s = rules.sightings
  // A store that blocks automated access is covered by member sightings only.
  const monitored = retailers.filter((r) => r.monitored && !r.blockedReason)
  const sightingsOnly = retailers.filter((r) => !r.monitored || r.blockedReason)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: '/drops/' }]} /></div>
      <PageIntro eyebrow="Retail drops · Australia · AEST/AEDT" title="Restocks & pre-orders" lead={`Pokémon and One Piece sealed product at Kmart, BIG W, Target, JB Hi-Fi, EB Games, Toymate, Myer and independent game stores: online stores checked around the clock, and members report what they see on the shelf. Premium members are alerted instantly; everyone else ${freeDelay} later.`}>
        <div className="mt-6 grid gap-3">
          <ChipNav label="Monitored 24/7" links={monitored.map((r) => ({ href: dropsPath(r.slug), text: r.name }))} />
          <ChipNav label="Member sightings" links={sightingsOnly.map((r) => ({ href: dropsPath(r.slug), text: r.name }))} />
          <ChipNav label="By state" links={AU_STATES.map((st) => ({ href: dropsStatePath(st), text: st, title: AU_STATE_NAMES[st] }))} />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href={inStockPath()} className="btn btn-secondary btn-sm">In stock now</Link>
          <Link href={accountSightingsPath()} className="btn btn-primary btn-sm" rel="nofollow">Seen stock in store? Report it</Link>
          <Link href={storesPath()} className="prose-link text-sm">Stores we watch</Link>
          <Link href={productsPath()} className="prose-link text-sm">All products</Link>
        </div>
      </PageIntro>
      <LiveDrops />
      <div className="grid lg:grid-cols-[1fr_300px] lg:gap-12">
        <section className="section min-w-0" aria-labelledby="hist-h">
          <h2 id="hist-h">Stock activity</h2>
          <p className="muted mt-2 text-sm">Shown {publicDelay} after each event. Prices in AUD, tagged against RRP. Counts cover the latest {loaded.length} events.</p>
          <nav aria-label="Status" className="mt-4 flex flex-wrap gap-2">
            {STATUS_KEYS.map((k) => (
              <Link key={k} href={feedHref('/drops/', { ...q, status: k })} className="chip-filter tap" aria-current={status === k ? 'page' : undefined} scroll={false} data-status-chip={k}>
                {STATUS_CHIP_LABEL[k]} <span className="count">{counts[k]}</span>
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex flex-wrap gap-3">
            <SegLinks label="Game" options={[{ href: feedHref('/drops/', { ...q, game: undefined }), label: 'All games', current: !game }, ...GAMES.map((g) => ({ href: feedHref('/drops/', { ...q, game: g }), label: GAME_NAMES[g], current: game === g }))]} />
            <SegLinks label="Sort" options={[{ href: feedHref('/drops/', { ...q, sort: 'newest' }), label: 'Newest', current: sort === 'newest' }, { href: feedHref('/drops/', { ...q, sort: 'oldest' }), label: 'Oldest', current: sort === 'oldest' }]} />
          </div>
          <div className="mt-6"><DropFeed rows={rows} empty={EMPTY[status]} /></div>
          {matching.length > rows.length && (
            <p className="mt-6 flex flex-wrap items-center gap-3">
              <Link href={feedHref('/drops/', { ...q, page: page + 1 })} className="btn btn-secondary btn-sm" scroll={false}>Load more</Link>
              <span className="muted text-xs">Showing {rows.length} of {matching.length}</span>
            </p>
          )}
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
