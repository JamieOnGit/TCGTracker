import Link from 'next/link'
import type { ReleaseRow } from '@/lib/data/types'
import { CONFIDENCE_LABEL, formatReleaseDateShort, groupReleases, KIND_LABEL } from '@/lib/releases'
import { GAME_NAMES, releasePath, releasesHubPath, releasesIcsPath } from '@/lib/seo/urls'

/** How many upcoming releases the Drops page shows before "Full calendar". */
export const UPCOMING_ON_DROPS = 6

/**
 * The next few Australian release dates, compact, for the Drops page sidebar:
 * every row links to its release page (internal links for the calendar), and
 * the full calendar and .ics feed are one tap away.
 */
export function UpcomingReleases({ rows, today }: { rows: ReleaseRow[]; today: string }) {
  const upcoming = groupReleases(rows, today).upcoming.flatMap((g) => g.rows).slice(0, UPCOMING_ON_DROPS)
  return (
    <section aria-labelledby="releases-h" data-testid="upcoming-releases">
      <h2 id="releases-h" className="text-xl">Release calendar</h2>
      <p className="muted mt-1 text-sm">Australian release dates (AEST/AEDT).</p>
      {upcoming.length === 0 ? (
        <p className="muted mt-3 text-sm">No upcoming dates announced yet.</p>
      ) : (
        <ol className="mt-3">
          {upcoming.map((r) => (
            <li key={r.id} className="grid grid-cols-[4.75rem_1fr] gap-x-3 border-b py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
              <span className="num muted whitespace-nowrap">
                {r.releaseDate && r.datePrecision === 'day' ? <time dateTime={r.releaseDate}>{formatReleaseDateShort(r)}</time> : formatReleaseDateShort(r)}
              </span>
              <span className="min-w-0">
                <Link href={releasePath(r.game, r.slug)} className="prose-link">{r.title}</Link>
                <span className="muted block text-xs">
                  {GAME_NAMES[r.game]} · {r.lang.toUpperCase()}
                  {r.kind !== 'set_release' && <> · {KIND_LABEL[r.kind]}</>} · {CONFIDENCE_LABEL[r.confidence]}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href={releasesHubPath()} className="prose-link">Full release calendar</Link>
        <a href={releasesIcsPath()} className="prose-link">Add to your calendar (.ics)</a>
      </p>
    </section>
  )
}
