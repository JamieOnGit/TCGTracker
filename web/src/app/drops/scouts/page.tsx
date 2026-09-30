import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { Faq } from '@/components/DropsCopy'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import type { ScoutRow } from '@/lib/data/types'
import type { SightingRules } from '@/lib/domain/rules'
import { durationLabel } from '@/lib/domain/drops'
import { buildMetadata } from '@/lib/seo/metadata'
import { accountSightingsPath, scoutsPath } from '@/lib/seo/urls'

export const revalidate = 300

export const metadata: Metadata = buildMetadata({
  path: scoutsPath(),
  title: 'TCGTracker Scouts: Member Pokémon & One Piece Stock Sightings',
  description: 'How TCGTracker members report Pokémon and One Piece stock they see in Kmart, BIG W, Target and other Australian stores, how sightings are confirmed, and the scout leaderboard.',
})

function faqs(s: SightingRules, freeDelay: string) {
  return [
    {
      q: 'How does a sighting become an alert?',
      a: `A member reports the store, suburb, product, quantity and purchase limit. It alerts once ${s.confirmationsNeeded} other members confirm it (${s.confirmationsWithPhoto} if the report has a photo), or straight away if a trusted scout or a moderator reported or checked it. Premium members are alerted instantly; Free members ${freeDelay} later.`,
    },
    {
      q: 'Who can see a report before it is confirmed?',
      a: 'Only Premium members, moderators and the person who reported it. Only Premium members and moderators can confirm a report, and nobody can vote on their own.',
    },
    {
      q: 'What is a trusted scout?',
      a: `A member with at least ${s.trustedAfter} confirmed sightings and no more than ${s.trustedMaxRejectPct}% of their reports rejected. Their reports alert without waiting for confirmations. Trust is recalculated automatically, so it is lost if too many reports are rejected.`,
    },
    {
      q: 'What happens when the stock sells out?',
      a: `Any member who can see a sighting can vote "sold out". After ${s.goneVotesToClose} votes it is marked "Reported sold out" in the feed, so nobody makes a wasted trip.`,
    },
    {
      q: 'How do scout rewards work?',
      a: `Every ${s.rewardEvery} confirmed sightings earns ${s.rewardDays} days of Premium, added automatically to your account. Rejected, expired and merged reports don't count.`,
    },
    {
      q: 'Do you use bots to check stock?',
      a: 'Our retailer monitors check public product pages at a polite rate. We never bypass retailer bot protection, solve CAPTCHAs or auto-checkout. In-store stock comes only from members who have seen it with their own eyes.',
    },
  ]
}

function ScoutTable({ rows, caption }: { rows: ScoutRow[]; caption: string }) {
  if (rows.length === 0) return <p className="muted mt-4 text-sm">No confirmed sightings in this period yet.</p>
  return (
    <div className="table-wrap mt-4">
      <table className="dt">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col">Rank</th><th scope="col">Scout</th><th scope="col">States</th><th scope="col" className="num">Confirmed</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.username}><td className="num">{i + 1}</td><th scope="row">{r.username}</th><td>{r.states.join(', ') || '—'}</td><td className="num">{r.confirmed}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** How community sightings work, the rules, and the public leaderboards. */
export default async function Scouts() {
  const repo = getRepo()
  const [rules, month, year] = await Promise.all([repo.getRules(), repo.scoutLeaderboard(30, 10), repo.scoutLeaderboard(365, 20)])
  const s = rules.sightings
  const freeDelay = durationLabel(rules.freeDropDelayMinutes)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: '/drops/' }, { name: 'Scouts', path: scoutsPath() }]} /></div>
      <PageIntro eyebrow="Community sightings · Australia" title="TCGTracker Scouts" lead="Kmart, BIG W and Target restock in store long before their websites catch up. Scouts are members who report what they see on the shelf, so everyone else hears about it in minutes, not days.">
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={accountSightingsPath()} className="btn btn-primary btn-sm" rel="nofollow">Report a sighting</Link>
          <Link href="/drops/?source=member" className="btn btn-secondary btn-sm">See member sightings</Link>
        </div>
      </PageIntro>

      <section className="section-tight" aria-labelledby="how-h">
        <h2 id="how-h">How it works</h2>
        <ol className="prose mt-6 max-w-[var(--measure)] list-decimal pl-5">
          <li><strong>Report.</strong> Pick the retailer, state and suburb, then the product, price, how many are left and any purchase limit. A photo of the shelf helps it confirm faster. Online finds need the retailer link. You can report up to {s.dailyLimit} sightings a day.</li>
          <li><strong>Confirm.</strong> Premium members who see the same stock confirm it. {s.confirmationsNeeded} confirmations ({s.confirmationsWithPhoto} with a photo) turn a report into an alert. A second report of the same store and game within {durationLabel(s.mergeWindowMinutes)} counts as a confirmation.</li>
          <li><strong>Alert.</strong> A confirmed sighting goes out like any restock: instantly to Premium members by push, email, Discord and on-site, and to Free members {freeDelay} later.</li>
          <li><strong>Sold out.</strong> {s.goneVotesToClose} &ldquo;sold out&rdquo; votes mark it gone. Reports nobody confirms expire after {durationLabel(s.pendingExpiryMinutes)}.</li>
          <li><strong>Moderation.</strong> Members can flag a report as fake, and a report with as many flags as confirmations won&apos;t alert. Moderators can confirm or reject any report. A rejected report is withdrawn from the feed and counts against the reporter&apos;s trust.</li>
        </ol>
      </section>

      <section className="section-tight" aria-labelledby="rewards-h">
        <h2 id="rewards-h">Trusted scouts &amp; rewards</h2>
        <div className="prose mt-6 max-w-[var(--measure)]">
          <p>After {s.trustedAfter} confirmed sightings, with no more than {s.trustedMaxRejectPct}% rejected, you become a trusted scout: your reports alert straight away.</p>
          <p>Every {s.rewardEvery} confirmed sightings earns you {s.rewardDays} days of Premium, added to your account automatically.</p>
        </div>
      </section>

      <section className="section-tight" aria-labelledby="rules-h">
        <h2 id="rules-h">Scout etiquette</h2>
        <ul className="prose mt-6 max-w-[var(--measure)] list-disc pl-5">
          <li>Photograph the shelf, not people. Never photograph staff or other shoppers.</li>
          <li>Respect purchase limits and store staff. Don&apos;t ask staff to check the backroom or hold stock for you.</li>
          <li>Only report stock that is on the shelf for sale. No reports of lay-by, held or backroom stock, and no &ldquo;might be coming Thursday&rdquo; speculation.</li>
          <li>No fake or copied reports. Accounts that post them are banned.</li>
          <li>Be kind in the queue. Everyone is there for the same reason.</li>
        </ul>
      </section>

      <section className="section-tight" aria-labelledby="lb30-h">
        <h2 id="lb30-h">Top scouts: last 30 days</h2>
        <ScoutTable rows={month} caption="Top scouts by confirmed sightings, last 30 days" />
      </section>
      <section className="section-tight" aria-labelledby="lb365-h">
        <h2 id="lb365-h">Top scouts: last 12 months</h2>
        <ScoutTable rows={year} caption="Top scouts by confirmed sightings, last 12 months" />
        {repo.isDemo && <p className="provenance">Preview data.</p>}
      </section>

      <Faq faqs={faqs(s, freeDelay)} />
    </div>
  )
}
