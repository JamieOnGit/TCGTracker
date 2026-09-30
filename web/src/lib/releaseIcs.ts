import 'server-only'
import { getRepo } from '@/lib/data'
import { buildIcs } from '@/lib/ics'
import { CONFIDENCE_LABEL, KIND_LABEL } from '@/lib/releases'
import { absoluteUrl, GAME_NAMES, releasePath, type Game } from '@/lib/seo/urls'

/**
 * The .ics feeds behind /releases/calendar.ics and /releases/{game}/calendar.ics.
 * Only day-precision releases become events (a month isn't a date); UIDs are
 * the release id, so calendar apps update an event when its date moves.
 */
export async function releaseIcsResponse(game?: Game): Promise<Response> {
  const rows = await getRepo().releases(game ? { game } : undefined)
  const name = game ? `${GAME_NAMES[game]} TCG releases (Australia)` : 'Pokémon & One Piece TCG releases (Australia)'
  const body = buildIcs({
    name,
    description: 'Australian release dates from TCG Trade. Day-confirmed dates only.',
    events: rows
      .filter((r) => r.datePrecision === 'day' && r.releaseDate)
      .map((r) => ({
        uid: `${r.id}@tcgtrade.com.au`,
        date: r.releaseDate!,
        summary: `${r.title} (${r.lang.toUpperCase()})${r.kind === 'set_release' ? '' : ` – ${KIND_LABEL[r.kind]}`}`,
        description: [`${GAME_NAMES[r.game]} TCG · ${CONFIDENCE_LABEL[r.confidence]}`, r.summary, absoluteUrl(releasePath(r.game, r.slug))].filter(Boolean).join('\n'),
        url: absoluteUrl(releasePath(r.game, r.slug)),
        updatedAt: r.updatedAt,
      })),
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${game ?? 'tcg'}-releases.ics"`,
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      'X-Robots-Tag': 'noindex',
    },
  })
}
