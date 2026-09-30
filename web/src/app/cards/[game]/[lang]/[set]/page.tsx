import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { fmtDate, LangBadge } from '@/components/Format'
import { MarketCapTable, parseMarketQuery } from '@/components/MarketCapTable'
import { CardImage, PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { buildMetadata, titles, type SearchParams } from '@/lib/seo/metadata'
import { cardPath, cardsPath, GAME_NAMES, isGame, isLang, LANG_NAMES, marketCapPath, releasePath, setPath } from '@/lib/seo/urls'

export const revalidate = 3600
type Props = { params: Promise<{ game: string; lang: string; set: string }>; searchParams: Promise<SearchParams> }

async function load(p: Awaited<Props['params']>) {
  if (!isGame(p.game) || !isLang(p.lang)) return null
  return getRepo().getSet(p.game, p.lang, p.set)
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const set = await load(await params)
  if (!set) return {}
  return buildMetadata({
    path: setPath(set),
    title: titles.set({ name: set.name, gameName: GAME_NAMES[set.game], lang: set.lang }),
    description: `${set.name} (${set.code}) ${LANG_NAMES[set.lang]} card list with PSA 10 values, population and market cap in Australian dollars. Released ${fmtDate(set.releaseDate)}.`,
    searchParams: await searchParams,
  })
}

export default async function SetPage({ params, searchParams }: Props) {
  const set = await load(await params)
  if (!set) notFound()
  const repo = getRepo()
  const [cards, rules, releases] = await Promise.all([repo.listCardsInSet(set.id), repo.getRules(), repo.releases({ game: set.game })])
  const release = releases.find((r) => r.set?.slug === set.slug && r.lang === set.lang)
  const query = parseMarketQuery(await searchParams, { game: set.game, lang: set.lang, setId: set.id }, rules.primaryGrade)
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Cards', path: '/cards/' }, { name: GAME_NAMES[set.game], path: cardsPath(set.game) }, { name: LANG_NAMES[set.lang], path: cardsPath(set.game, set.lang) }, { name: set.name, path: setPath(set) }]} /></div>
      <PageIntro eyebrow={`${GAME_NAMES[set.game]} · ${LANG_NAMES[set.lang]} · ${set.code} · released ${fmtDate(set.releaseDate)}`} title={`${set.name}`} lead={set.intro ?? undefined} />
      {release && (
        <p className="muted -mt-4 mb-8 text-sm">
          Release date, products and RRP in Australia: <Link href={releasePath(release.game, release.slug)} className="prose-link">{release.title} release</Link>
        </p>
      )}
      <section aria-labelledby="top-h">
        <div className="flex items-baseline justify-between"><h2 id="top-h">Most valuable cards</h2><Link href={marketCapPath(set.game, set.lang, set.slug)} className="btn-ghost text-sm">Set rankings</Link></div>
        <div className="mt-6"><MarketCapTable query={query} basePath={setPath(set)} caption={`${set.name} cards ranked by value`} showControls={false} /></div>
      </section>
      <section className="section" aria-labelledby="all-h">
        <h2 id="all-h">Card list · {cards.length} tracked</h2>
        <div className="grid-tiles cols-4 mt-6">
          {cards.map((c) => (
            <Link key={c.id} href={cardPath(c)} className="tile">
              <div className="well"><CardImage src={c.imageUrl} alt={`${c.name} ${c.number}`} name={c.name} /></div>
              <p className="tile-name">{c.name}</p>
              <p className="card-meta">#{c.number} · {c.variant.replace('-', ' ')} <LangBadge lang={c.lang} /></p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
