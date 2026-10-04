import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { LiveDrops } from '@/components/LiveDrops'
import { LiveRefresh } from '@/components/LiveRefresh'
import { FilterBar } from '@/components/FilterBar'
import { Pagination } from '@/components/Pagination'
import { PageIntro } from '@/components/ui'
import { UpcomingReleases } from '@/components/UpcomingReleases'
import { viewerRepo } from '@/lib/data'
import { AU_STATES, AU_STATE_NAMES, type AuState } from '@/lib/data/types'
import { durationLabel, parseDropSource } from '@/lib/domain/drops'
import { listingLang, parseLang, parseSearch, searchRows, searchText } from '@/lib/domain/search'
import { countByStatus, dropStatus, FEED_SORT_LABEL, FEED_SORTS, parseGame, parseSlug, parseSort, parseStatus, sortDrops, STATUS_CHIP_LABEL, STATUS_KEYS, type StatusKey } from '@/lib/domain/stock'
import { pastLastPage, slicePage, TABLE_PAGE_SIZE } from '@/lib/paging'
import { todayAu } from '@/lib/releases'
import { buildMetadata, pageNumber, type SearchParams } from '@/lib/seo/metadata'
import { accountSightingsPath, dropsPath, dropsStatePath, GAME_NAMES, GAMES, inStockPath, LANG_NAMES, LANGS, productsPath, scoutsPath, stockPath, storesPath } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { searchParams: Promise<SearchParams> }

// ?q= / ?status= / ?game= / ?lang= / ?retailer= / ?state= / ?sort= views are noindex,follow and canonicalise to
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
const PAGE_SIZE = TABLE_PAGE_SIZE

const EMPTY: Record<StatusKey, string | undefined> = {
  all: undefined,
  restock: 'No restocks in the public history yet.',
  new: 'No new listings in the public history yet.',
  preorder: 'No pre-orders in the public history yet.',
  'price-drop': 'No price drops in the public history yet.',
  sighting: 'No confirmed member sightings in the public history yet. Seen stock in store? Report it.',
}

/**
 * One feed, as the viewer may see it: Premium members get the live table (read
 * with their session, kept live by LiveRefresh) with every filter and page;
 * everyone else gets the public history (RLS enforces the delay) and the upgrade prompt.
 */
export default async function Drops({ searchParams }: Props) {
  const sp = await searchParams
  // Legacy ?source=member is the "Member sightings" chip; ?source=monitor still filters at the source.
  const legacy = parseDropSource(sp.source)
  const status = sp.status ? parseStatus(sp.status) : legacy === 'member' ? 'sighting' : 'all'
  const game = parseGame(sp.game)
  const lang = parseLang(sp.lang)
  const query = parseSearch(sp.q)
  const sort = parseSort(sp.sort)
  const stateParam = typeof sp.state === 'string' ? sp.state.toUpperCase() : undefined
  const state = AU_STATES.find((st) => st === stateParam) as AuState | undefined
  const page = pageNumber(sp)
  const { repo, tier } = await viewerRepo()
  const live = tier === 'premium'
  const today = todayAu()
  const [retailers, rules, scouts, releases] = await Promise.all([repo.retailers(), repo.getRules(), repo.scoutLeaderboard(30, 5), repo.releases({ from: today })])
  const retailer = retailers.find((r) => r.slug === parseSlug(sp.retailer))?.slug
  const loaded = await repo.drops({ game, retailerSlug: retailer, state, source: legacy === 'monitor' ? 'monitor' : undefined, limit: FEED_LOAD })
  // Search and language narrow the feed first; the status counts are over what's left.
  const searched = searchRows(loaded, query, (d) => searchText(d.title, d.product?.name)).filter((d) => !lang || listingLang(d.title, d.product) === lang)
  const counts = countByStatus(searched)
  const matching = sortDrops(
    searched.filter((d) => status === 'all' || dropStatus(d).key === status),
    sort,
  )
  if (pastLastPage(page, matching.length, PAGE_SIZE)) notFound()
  const rows = slicePage(matching, page, PAGE_SIZE)
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
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href={stockPath()} className="btn btn-secondary btn-sm">Live stock by store</Link>
          <Link href={inStockPath()} className="btn btn-secondary btn-sm">In stock now</Link>
          <Link href={accountSightingsPath()} className="btn btn-primary btn-sm" rel="nofollow">Seen stock in store? Report it</Link>
          <Link href={storesPath()} className="prose-link text-sm">Stores we watch</Link>
          <Link href={productsPath()} className="prose-link text-sm">All products</Link>
        </div>
      </PageIntro>
      {live ? <LiveRefresh /> : <LiveDrops />}
      <div className="grid lg:grid-cols-[1fr_300px] lg:gap-12">
        <section className="section min-w-0 scroll-mt-24" aria-labelledby="hist-h" id="activity">
          <h2 id="hist-h">{live ? 'Live stock activity' : 'Stock activity'}</h2>
          <p className="muted mt-2 text-sm">
            {live ? 'Live: each event appears the moment we see it.' : `Shown ${publicDelay} after each event.`} Prices in AUD, tagged against RRP. Counts cover the latest {loaded.length} events.
          </p>
          <div className="mt-4">
            <FilterBar
              action="/drops/"
              search={{ value: query, placeholder: 'Search products, e.g. prismatic etb or char*ex', label: 'Search stock activity by product name' }}
              selects={[
                { name: 'status', label: 'Activity', value: status === 'all' ? '' : status, options: STATUS_KEYS.map((k) => ({ value: k === 'all' ? '' : k, label: `${k === 'all' ? 'All activity' : STATUS_CHIP_LABEL[k]} (${counts[k]})` })) },
                { name: 'game', label: 'Game', value: game ?? '', options: [{ value: '', label: 'All games' }, ...GAMES.map((g) => ({ value: g, label: GAME_NAMES[g] }))] },
                { name: 'lang', label: 'Language', value: lang ?? '', options: [{ value: '', label: 'English & Japanese' }, ...LANGS.map((l) => ({ value: l, label: `${LANG_NAMES[l]} (${l.toUpperCase()})` }))] },
                {
                  name: 'retailer',
                  label: 'Store',
                  value: retailer ?? '',
                  options: [
                    { value: '', label: 'All stores' },
                    ...monitored.map((r) => ({ value: r.slug, label: r.name, group: 'Checked 24/7' })),
                    ...sightingsOnly.map((r) => ({ value: r.slug, label: r.name, group: 'Member sightings' })),
                  ],
                },
                { name: 'state', label: 'State', value: state ?? '', options: [{ value: '', label: 'All of Australia' }, ...AU_STATES.map((st) => ({ value: st, label: AU_STATE_NAMES[st] }))] },
                { name: 'sort', label: 'Sort', value: sort === 'recommended' ? '' : sort, options: FEED_SORTS.map((k) => ({ value: k === 'recommended' ? '' : k, label: FEED_SORT_LABEL[k] })) },
              ]}
              summary={<span data-result-count={matching.length}>{matching.length} {matching.length === 1 ? 'event' : 'events'}{query ? ` matching “${query}”` : ''}</span>}
            />
          </div>
          <div className="mt-6"><DropFeed rows={rows} empty={query || lang || retailer || state ? 'Nothing matches these filters. Try fewer words, or * as a wildcard (e.g. char*ex).' : EMPTY[status]} /></div>
          <Pagination
            basePath="/drops/"
            page={page}
            total={matching.length}
            pageSize={PAGE_SIZE}
            params={{ q: query, status: status === 'all' ? undefined : status, game, lang, retailer, state, sort: sort === 'recommended' ? undefined : sort }}
            anchor="activity"
            noun="events"
          />
          {repo.isDemo && <p className="provenance">Preview data.</p>}
        </section>
        <aside className="grid content-start gap-10 pb-16 lg:py-24">
          <UpcomingReleases rows={releases} today={today} />
          <section aria-labelledby="browse-h">
            <h2 id="browse-h" className="text-xl">Browse drops</h2>
            <LinkList label="Checked 24/7" links={monitored.map((r) => ({ href: dropsPath(r.slug), text: r.name }))} />
            <LinkList label="Member sightings" links={sightingsOnly.map((r) => ({ href: dropsPath(r.slug), text: r.name }))} />
            <LinkList label="In store, by state" links={AU_STATES.map((st) => ({ href: dropsStatePath(st), text: st, title: AU_STATE_NAMES[st] }))} />
          </section>
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

/** A labelled, comma-separated list of crawlable links; skipped when empty. */
function LinkList({ label, links }: { label: string; links: { href: string; text: string; title?: string }[] }) {
  if (links.length === 0) return null
  return (
    <nav aria-label={label} className="mt-3 text-sm">
      <span className="tag-quiet mr-2">{label}</span>
      {links.map((l, i) => (
        <span key={l.href}>
          {i > 0 && <span className="muted">, </span>}
          <Link href={l.href} className="prose-link" title={l.title}>{l.text}</Link>
        </span>
      ))}
    </nav>
  )
}
