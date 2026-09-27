import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
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
    <>
      <Breadcrumbs items={[{ name: 'Releases', path: releasesPath(game) }]} />
      <h1>{GAME_NAMES[game]} release calendar</h1>
      <table>
        <caption>Release dates</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Set</th><th scope="col">Language</th></tr></thead>
        <tbody>{sets.map((s) => <tr key={s.id}><td>{s.releaseDate ?? 'TBC'}</td><th scope="row"><Link href={setPath(s)}>{s.name}</Link></th><td>{s.lang.toUpperCase()}</td></tr>)}</tbody>
      </table>
      {upcoming.length > 0 && (
        <JsonLd data={upcoming.map((s) => ({ '@context': 'https://schema.org', '@type': 'Event', name: `${s.name} (${s.lang.toUpperCase()}) release`, startDate: s.releaseDate, eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled', location: { '@type': 'VirtualLocation', url: absoluteUrl(setPath(s)) } }))} />
      )}
    </>
  )
}
