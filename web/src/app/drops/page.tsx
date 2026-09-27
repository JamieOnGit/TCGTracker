import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { dropsPath } from '@/lib/seo/urls'

export const revalidate = 300

export const metadata: Metadata = buildMetadata({
  path: '/drops/',
  title: 'Pokémon & One Piece TCG Restocks & Pre-orders in Australia',
  description: 'Recent Pokémon TCG and One Piece Card Game drops, restocks and pre-orders at Premium Bandai AU, JB Hi-Fi, EB Games, BIG W and Kmart, tagged against RRP.',
})

/**
 * Public, DELAYED history (brief 9.5). The query runs as anon, so RLS only
 * returns events older than drops.public_delay_minutes. Premium members get
 * the instant feed at /account/drops/ and by email/on-site alerts.
 */
export default async function Drops() {
  const repo = getRepo()
  const [rows, retailers, rules] = await Promise.all([repo.drops({ limit: 100 }), repo.retailers(), repo.getRules()])
  return (
    <>
      <Breadcrumbs items={[{ name: 'Drops', path: '/drops/' }]} />
      <h1>Retail drops, restocks &amp; pre-orders</h1>
      <p>
        This public history is shown at least {rules.dropsPublicDelayMinutes} minutes after each event.{' '}
        <Link href="/premium/">Premium members get instant alerts</Link> by email and on-site.
      </p>
      <nav aria-label="Retailers">
        {retailers.map((r) => <Link key={r.slug} href={dropsPath(r.slug)}>{r.name} </Link>)}
      </nav>
      <DropFeed rows={rows} />
      {repo.isDemo && <p className="demo-banner">Demo data: no retailer monitors are running yet.</p>}
    </>
  )
}
