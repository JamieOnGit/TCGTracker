import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { formatAud } from '@/lib/domain/rules'
import { staticMeta } from '@/lib/staticPage'

export const revalidate = 3600
export const metadata = staticMeta('/premium/', 'TCG Trade Premium – Instant Restock Alerts & 30 Listings a Month', 'Premium: instant Pokémon and One Piece restock and pre-order alerts from Australian retailers, 30 marketplace listings a month and a Premium badge. A$12.99/month incl. GST, cancel any time.')

const FAQ: [string, string][] = [
  ['How fast are Premium alerts?', 'We check each retailer around the clock, every minute or two for watched products. Premium alerts go out the moment a change is detected, by email and on-site (Discord optional). Free members get the same alerts 24 hours later.'],
  ['Which retailers do you watch?', 'JB Hi-Fi, BIG W, Kmart, Target, EB Games and Premium Bandai AU, with more to come. You choose which games and retailers you want alerts for.'],
  ['Can I cancel any time?', 'Yes. Cancel in two clicks from Account → Billing. Premium stays on until the end of the month you have paid for, and you keep any listings already live.'],
  ['What happens to my listings if I downgrade?', 'Live listings stay live. New listings are limited to the Free quota of 5 a month.'],
  ['Is GST included?', 'Yes. A$12.99 a month includes GST.'],
]

export default async function Premium() {
  const rules = await getRepo().getRules()
  const price = formatAud(rules.premiumMonthlyCents).replace('$', 'A$')
  const delay = Math.round(rules.freeDropDelayMinutes / 60)
  const rows: [string, string, string][] = [
    ['Market cap rankings, prices, population, news', 'Yes', 'Yes'],
    ['Marketplace listings per month', String(rules.freeQuota), `Up to ${rules.premiumQuota}`],
    ['Message buyers & sellers on-site', 'Yes', 'Yes'],
    ['Email alerts: messages, listings, wishlist, saved searches', 'Yes', 'Yes'],
    ['Retail restock & pre-order alerts', `${delay >= 24 ? `${delay / 24} day` : `${delay} hours`} delay`, 'Instant'],
    ['Premium badge on profile & listings', '—', '◆'],
  ]
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Premium', path: '/premium/' }]} /></div>
      <PageIntro eyebrow="Membership" title="Be first when stock lands." lead="Restocks at Australian retailers sell out in minutes. Premium tells you the moment they happen." />
      <div className="grid gap-0 md:grid-cols-2" style={{ borderTop: '1px solid var(--line)' }}>
        <section className="py-10 md:pr-10" aria-labelledby="free-h">
          <h2 id="free-h">Free</h2>
          <p className="num mt-4" style={{ fontSize: 'var(--text-3xl)', fontWeight: 300 }}>A$0</p>
          <ul className="muted mt-6 grid gap-2 text-sm">
            <li>✓ Rankings, prices and card pages</li>
            <li>✓ {rules.freeQuota} marketplace listings a month</li>
            <li>✓ On-site messaging and email alerts</li>
            <li>✓ Retail drop alerts, {delay >= 24 ? `${delay / 24} day` : `${delay} hours`} after they happen</li>
          </ul>
          <Link href="/login/" className="btn btn-secondary mt-8">Create a free account</Link>
        </section>
        <section className="py-10 md:border-l md:pl-10" style={{ borderColor: 'var(--line)' }} aria-labelledby="prem-h">
          <p><span className="badge badge-premium">◆ Recommended</span></p>
          <h2 id="prem-h" className="mt-3">Premium</h2>
          <p className="mt-4"><span className="num" style={{ fontSize: 'var(--text-3xl)', fontWeight: 300 }}>{price}</span> <span className="muted text-sm">/ month AUD, incl. GST</span></p>
          <ul className="mt-6 grid gap-2 text-sm">
            <li>✓ <strong>Instant</strong> restock &amp; pre-order alerts: JB Hi-Fi, BIG W, Kmart, Target and more</li>
            <li>✓ Up to {rules.premiumQuota} marketplace listings a month</li>
            <li>✓ Premium badge on your profile and listings</li>
            <li>✓ Choose games and retailers; email, on-site and Discord</li>
          </ul>
          <form action="/account/billing/upgrade/" method="get"><button className="btn btn-primary mt-8" type="submit">Get Premium</button></form>
          <p className="muted mt-3 text-xs">Cancel any time. Billed monthly by Stripe.</p>
        </section>
      </div>
      <section className="section" aria-labelledby="cmp-h">
        <h2 id="cmp-h">Compare</h2>
        <div className="table-wrap mt-6">
          <table className="dt">
            <thead><tr><th scope="col">Feature</th><th scope="col">Free</th><th scope="col">Premium</th></tr></thead>
            <tbody>{rows.map(([f, a, b]) => <tr key={f}><th scope="row">{f}</th><td>{a}</td><td>{b}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="faq-h">
        <h2 id="faq-h">Questions</h2>
        <div className="mt-6">
          {FAQ.map(([q, a]) => (
            <details key={q} className="border-b py-4" style={{ borderColor: 'var(--line)' }}>
              <summary className="cursor-pointer text-base">{q}</summary>
              <p className="muted mt-3 max-w-[var(--measure)] text-sm">{a}</p>
            </details>
          ))}
        </div>
      </section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }).replace(/</g, '\\u003c') }} />
    </div>
  )
}
