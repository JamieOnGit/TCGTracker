import type { Metadata } from 'next'
import { MarketCapPage, marketCapMetadata, type MarketCapParams } from '@/lib/marketCapPage'
import type { SearchParams } from '@/lib/seo/metadata'

export const revalidate = 300
type Props = { params: Promise<MarketCapParams>; searchParams: Promise<SearchParams> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return marketCapMetadata(await params, await searchParams)
}

export default async function Page({ params, searchParams }: Props) {
  return <MarketCapPage params={await params} searchParams={await searchParams} />
}
