import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { LiveDrops } from '@/components/LiveDrops'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata } from '@/lib/seo/metadata'
import { dropsPath } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { params: Promise<{ retailer: string }> }

async function load(slug: string) {
  return (await getRepo().retailers()).find((r) => r.slug === slug) ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await load((await params).retailer)
  if (!r) return {}
  return buildMetadata({
    path: dropsPath(r.slug),
    title: `${r.name} Pokémon & One Piece TCG Restocks & Pre-orders (Australia)`,
    description: `Pokémon TCG and One Piece Card Game restocks, pre-orders and price changes at ${r.name} Australia, checked around the clock and tagged against RRP in AUD.`,
  })
}

export default async function RetailerDrops({ params }: Props) {
  const r = await load((await params).retailer)
  if (!r) notFound()
  const rows = await getRepo().drops({ retailerSlug: r.slug, limit: 100 })
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: '/drops/' }, { name: r.name, path: dropsPath(r.slug) }]} /></div>
      <PageIntro eyebrow="Retail drops · Australia" title={`${r.name} restocks & pre-orders`} lead={`Pokémon and One Piece sealed product at ${r.name}, checked 24/7.${r.enabled ? '' : ' Monitoring for this retailer is being set up.'}`} />
      <LiveDrops />
      <section className="section"><h2>History</h2><div className="mt-6"><DropFeed rows={rows} /></div></section>
    </div>
  )
}
