import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { PageIntro } from '@/components/ui'
import { buildMetadata } from '@/lib/seo/metadata'
import { accountDropAlertsPath, GAME_NAMES, GAMES, guidesPath, releasesHubPath, releasesIcsPath, releasesPath } from '@/lib/seo/urls'
import { Calendar } from './_components/Calendar'

export const revalidate = 3600

export const metadata: Metadata = buildMetadata({
  path: releasesHubPath(),
  title: 'Pokémon & One Piece TCG Release Dates in Australia',
  description: 'Pokémon TCG and One Piece Card Game release dates in Australia, English and Japanese, with RRP in AUD, pre-order dates, stockists and a calendar feed.',
})

/** All games on one calendar. */
export default function ReleasesHub() {
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Releases', path: releasesHubPath() }]} /></div>
      <PageIntro
        eyebrow="Release calendar · Australia · AEST/AEDT"
        title="Pokémon & One Piece release dates"
        lead="Australian release dates for English and Japanese sets and products. Each date is marked Official, Retailer listing or Unconfirmed, and updated as announcements land."
      >
        <nav aria-label="Release calendars by game" className="mt-6 flex flex-wrap gap-2">
          {GAMES.map((g) => <Link key={g} href={releasesPath(g)} className="chip-filter">{GAME_NAMES[g]} releases</Link>)}
          <a href={releasesIcsPath()} className="chip-filter">Add to calendar (.ics)</a>
        </nav>
      </PageIntro>
      <Calendar />
      <section className="section" aria-labelledby="how-h">
        <h2 id="how-h">How we date releases</h2>
        <div className="prose mt-4">
          <p>
            Dates are Australian calendar dates. <strong>Official</strong> means announced by the publisher or its Australian distributor. <strong>Retailer listing</strong> means an Australian retailer has published a date, and those can move. <strong>Unconfirmed</strong> is reported but not yet backed by either. When only a month or quarter is known we say so rather than guess a day.
          </p>
          <p>
            Want a heads-up? Set a reminder on any release, <Link href={accountDropAlertsPath()}>turn on drop alerts</Link> for restocks and pre-orders, or subscribe to the <a href={releasesIcsPath()}>calendar feed</a> in Google Calendar, Apple Calendar or Outlook. New to collecting in Australia? Start with our <Link href={guidesPath('buy-pokemon-cards-at-rrp-australia')}>guide to buying at RRP</Link>.
          </p>
        </div>
      </section>
    </div>
  )
}
