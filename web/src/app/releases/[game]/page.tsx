import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { absoluteUrl, GAME_NAMES, isGame, releasesPath, setPath } from '@/lib/seo/urls'

export const revalidate = 3600
type Props = { params: Promise<{ game: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params
  if (!isGame(game)) return {}
  return buildMetadata({
    path: releasesPath(game),
    title: `${GAME_NAMES[game]} TCG Release Calendar Australia (EN & JP)`,
    description: `Upcoming and recent ${GAME_NAMES[game]} set release dates in English and Japanese.`,
  })
}

export default async function Releases({ params }: Props) {
  const { game } = await params
  if (!isGame(game)) notFound()
  const sets = await getRepo().listSets({ game })
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = sets.filter((s) => s.releaseDate && s.releaseDate >= today)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Releases', path: releasesPath(game) }]} /></div>
      <PageIntro eyebrow="Release calendar · Australia" title={`${GAME_NAMES[game]} release dates`} lead="English and Japanese sets. Australian English releases usually match the global date." />
      <div className="table-wrap">
        <table className="dt">
          <caption className="sr-only">Release dates</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Set</th><th scope="col">Language</th></tr></thead>
          <tbody>{sets.map((s) => <tr key={s.id}><td className="num">{s.releaseDate ? new Date(s.releaseDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBC'}</td><th scope="row"><Link href={setPath(s)} className="prose-link">{s.name}</Link></th><td>{s.lang.toUpperCase()}</td></tr>)}</tbody>
        </table>
      </div>
      {upcoming.length > 0 && (
        <JsonLd data={upcoming.map((s) => ({ '@context': 'https://schema.org', '@type': 'Event', name: `${s.name} (${s.lang.toUpperCase()}) release`, startDate: s.releaseDate, eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled', location: { '@type': 'VirtualLocation', url: absoluteUrl(setPath(s)) } }))} />
      )}
    </div>
  )
}
