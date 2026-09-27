import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
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
    title: `${r.name} Pokémon & One Piece TCG Restocks & Pre-orders`,
    description: `Recent Pokémon TCG and One Piece Card Game restocks, pre-orders and price changes at ${r.name}, tagged against RRP.`,
  })
}

export default async function RetailerDrops({ params }: Props) {
  const r = await load((await params).retailer)
  if (!r) notFound()
  const rows = await getRepo().drops({ retailerSlug: r.slug, limit: 100 })
  return (
    <>
      <Breadcrumbs items={[{ name: 'Drops', path: '/drops/' }, { name: r.name, path: dropsPath(r.slug) }]} />
      <h1>{r.name} TCG drops</h1>
      <DropFeed rows={rows} />
    </>
  )
}
