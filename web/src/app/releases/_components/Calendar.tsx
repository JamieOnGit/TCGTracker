import Link from 'next/link'
import { JsonLd } from '@/components/JsonLd'
import { EmptyState } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { addDays, groupReleases, periodEnd, todayAu } from '@/lib/releases'
import { itemList } from '@/lib/seo/jsonld'
import { dropsPath, releasePath, type Game } from '@/lib/seo/urls'
import { Collapsed, ReleaseTable } from './ReleaseTable'

/**
 * The calendar body shared by /releases/ and /releases/{game}/: upcoming by
 * month (Australian dates), then the last 60 days, then TBC; game pages also
 * list earlier releases so past detail pages stay linked. Australian dates
 * only: Bandai (Oceania), Australian retailers and editors.
 */
export async function Calendar({ game }: { game?: Game }) {
  const repo = getRepo()
  const today = todayAu()
  const rows = await repo.releases(game ? { game } : undefined)
  const { upcoming, recent, tbc } = groupReleases(rows, today)
  const since = addDays(today, -60)
  const earlier = game ? rows.filter((r) => (periodEnd(r) ?? '9999') < since).reverse() : []
  const showGame = !game
  if (rows.length === 0) {
    // Australian dates only: no fallback to overseas set dates from the card catalogue.
    return <EmptyState title="No release dates yet" body="Australian dates are added as soon as Bandai or an Australian retailer publishes them." />
  }
  const listed = [...upcoming.flatMap((g) => g.rows), ...recent, ...tbc]
  return (
    <>
      {upcoming.length === 0 && <p className="muted text-sm">No upcoming dates announced yet.</p>}
      {upcoming.map((g) => (
        <section key={g.key} className="section-tight" aria-labelledby={`m-${g.key}`}>
          <h2 id={`m-${g.key}`}>{g.label}</h2>
          <ReleaseTable rows={g.rows} caption={`Releases in ${g.label}`} showGame={showGame} />
        </section>
      ))}
      {recent.length > 0 && (
        <section className="section-tight" aria-labelledby="recent-h">
          <h2 id="recent-h">Recently released</h2>
          <p className="muted mt-2 text-sm">Out in the last 60 days. Restocks show up on the <Link href={dropsPath()} className="prose-link">drops page</Link>.</p>
          <ReleaseTable rows={recent} caption="Released in the last 60 days" showGame={showGame} />
        </section>
      )}
      {tbc.length > 0 && (
        <section className="section-tight" aria-labelledby="tbc-h">
          <h2 id="tbc-h">Date to be confirmed</h2>
          <ReleaseTable rows={tbc} caption="Releases without a confirmed date" showGame={showGame} />
        </section>
      )}
      {earlier.length > 0 && (
        <section className="section-tight" aria-labelledby="earlier-h">
          <h2 id="earlier-h">Earlier releases</h2>
          <Collapsed rows={earlier} noun="releases" render={(part) => <ReleaseTable rows={part} caption="Earlier releases, newest first" showGame={showGame} />} />
        </section>
      )}
      <JsonLd data={itemList(listed.map((r) => ({ name: r.title, path: releasePath(r.game, r.slug) })))} />
    </>
  )
}
