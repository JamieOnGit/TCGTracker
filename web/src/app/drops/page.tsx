import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { LiveDrops } from '@/components/LiveDrops'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { dropsPath } from '@/lib/seo/urls'

export const revalidate = 300

export const metadata: Metadata = buildMetadata({
  path: '/drops/',
  title: 'Pokémon & One Piece TCG Restocks & Pre-orders in Australia',
  description: 'Pokémon TCG and One Piece Card Game restocks, pre-orders and price drops at JB Hi-Fi, BIG W, Kmart, Target, EB Games and Premium Bandai AU, checked 24/7 and tagged against RRP.',
})

/** Public, delayed history (RLS enforces the delay) + the Premium live panel. */
export default async function Drops() {
  const repo = getRepo()
  const [rows, retailers, rules] = await Promise.all([repo.drops({ limit: 100 }), repo.retailers(), repo.getRules()])
  const hours = Math.round(rules.dropsPublicDelayMinutes / 60)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: '/drops/' }]} /></div>
      <PageIntro eyebrow="Retail drops · Australia · AEST/AEDT" title="Restocks & pre-orders" lead={`We check Australian retailers around the clock for Pokémon and One Piece sealed product. Premium members are alerted instantly; everyone else ${hours >= 24 ? `${Math.round(hours / 24)} day` : `${hours} hours`} later.`}>
        <nav aria-label="Retailers" className="mt-6 flex flex-wrap gap-2">
          {retailers.map((r) => <Link key={r.slug} href={dropsPath(r.slug)} className="chip-filter">{r.name}</Link>)}
        </nav>
      </PageIntro>
      <LiveDrops />
      <section className="section" aria-labelledby="hist-h">
        <h2 id="hist-h">Recent drops</h2>
        <p className="muted mt-2 text-sm">Shown {hours >= 24 ? `${Math.round(hours / 24)} day` : `${hours} hours`} after each event. Prices in AUD, tagged against RRP.</p>
        <div className="mt-6"><DropFeed rows={rows} /></div>
        {repo.isDemo && <p className="provenance">Preview data.</p>}
      </section>
    </div>
  )
}
