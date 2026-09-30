import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
import { PageIntro } from '@/components/ui'
import { GUIDES, TOPIC_LABEL, type Guide } from '@/content/guides'
import { itemList } from '@/lib/seo/jsonld'
import { buildMetadata } from '@/lib/seo/metadata'
import { dropsPath, guidesPath, releasesHubPath } from '@/lib/seo/urls'

export const metadata: Metadata = buildMetadata({
  path: guidesPath(),
  title: 'Pokémon & One Piece TCG Guides for Australian Collectors',
  description: 'Guides for Australian Pokémon and One Piece collectors: buying at RRP, retailer restocks, grading from Australia, spotting fakes, JP vs EN and selling safely.',
})

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Guides hub: each guide is a pillar page linking out to the data pages. */
export default function Guides() {
  const topics = (Object.keys(TOPIC_LABEL) as Guide['topic'][]).map((t) => ({ t, guides: GUIDES.filter((g) => g.topic === t) })).filter((x) => x.guides.length)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Guides', path: guidesPath() }]} /></div>
      <PageIntro
        eyebrow="Guides · Australia"
        title="Collector guides"
        lead={<>Plain-English guides for collecting Pokémon and One Piece cards in Australia. For live information, pair them with the <Link href={dropsPath()} className="prose-link">restock feed</Link> and the <Link href={releasesHubPath()} className="prose-link">release calendar</Link>.</>}
      />
      {topics.map(({ t, guides }) => (
        <section key={t} className="section-tight" aria-labelledby={`t-${t}`}>
          <h2 id={`t-${t}`}>{TOPIC_LABEL[t]}</h2>
          <ul className="mt-4">
            {guides.map((g) => (
              <li key={g.slug} className="border-b py-5" style={{ borderColor: 'var(--line)' }}>
                <Link href={guidesPath(g.slug)} className="tile">
                  <span className="tile-name block">{g.title}</span>
                </Link>
                <p className="muted mt-2 max-w-[var(--measure)] text-sm">{g.dek}</p>
                <p className="muted mt-1 text-xs">Updated <time dateTime={g.updated}>{fmt(g.updated)}</time></p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <JsonLd data={itemList(GUIDES.map((g) => ({ name: g.title, path: guidesPath(g.slug) })))} />
    </div>
  )
}
