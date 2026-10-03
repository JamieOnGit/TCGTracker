import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { JsonLd } from '@/components/JsonLd'
import { effectivePrimaryGrade, MarketCapTable, parseMarketQuery } from '@/components/MarketCapTable'
import { PageIntro } from '@/components/ui'
import { getRepo, type SetRow } from '@/lib/data'
import { dataset } from '@/lib/seo/jsonld'
import { buildMetadata, titles, type SearchParams } from '@/lib/seo/metadata'
import { GAME_NAMES, isGame, isLang, LANG_NAMES, marketCapPath, type Game, type Lang } from '@/lib/seo/urls'

export interface MarketCapParams {
  game?: string
  lang?: string
  set?: string
}

async function resolveScope(p: MarketCapParams): Promise<{ game?: Game; lang?: Lang; set?: SetRow; label: string; path: string } | null> {
  if (p.game !== undefined && !isGame(p.game)) return null
  if (p.lang !== undefined && !isLang(p.lang)) return null
  const game = p.game as Game | undefined
  const lang = p.lang as Lang | undefined
  let set: SetRow | undefined
  if (p.set !== undefined) {
    set = (await getRepo().getSet(game!, lang!, p.set)) ?? undefined
    if (!set) return null
  }
  const label = set ? `${set.name} (${GAME_NAMES[game!]} ${lang!.toUpperCase()})` : [game ? GAME_NAMES[game] : 'Pokémon & One Piece', lang ? LANG_NAMES[lang] : null].filter(Boolean).join(' ')
  return { game, lang, set, label, path: marketCapPath(game, lang, set?.slug) }
}

export async function marketCapMetadata(params: MarketCapParams, searchParams: SearchParams): Promise<Metadata> {
  const scope = await resolveScope(params)
  if (!scope) return {}
  return buildMetadata({
    path: scope.path,
    title: titles.marketCap(scope.label),
    description: `${scope.label} graded card rankings in Australian dollars: PSA 10 values, market cap and 7/30 day moves, updated daily.`,
    searchParams,
  })
}

export async function MarketCapPage({ params, searchParams }: { params: MarketCapParams; searchParams: SearchParams }) {
  const scope = await resolveScope(params)
  if (!scope) notFound()
  const rules = await getRepo().getRules()
  const query = parseMarketQuery(searchParams, { game: scope.game, lang: scope.lang, setId: scope.set?.id }, await effectivePrimaryGrade(rules.primaryGrade))
  const crumbs: { name: string; path: string }[] = [] // Home (= all-games market cap) is prepended by Breadcrumbs
  if (scope.game) crumbs.push({ name: GAME_NAMES[scope.game], path: marketCapPath(scope.game) })
  if (scope.lang) crumbs.push({ name: scope.lang.toUpperCase(), path: marketCapPath(scope.game, scope.lang) })
  if (scope.set) crumbs.push({ name: scope.set.name, path: scope.path })
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={crumbs} /></div>
      <PageIntro eyebrow="Market cap · AUD" title={`${scope.label} market cap`} lead="Graded cards ranked by value in Australian dollars. Japanese and English printings are ranked separately." />
      <MarketCapTable query={query} basePath={scope.path} caption={`${scope.label} cards ranked by market cap`} />
      <JsonLd data={dataset({ name: `${scope.label} graded card market cap (AUD)`, description: 'Graded population × floor price, daily, in AUD.', path: scope.path, dateModified: new Date().toISOString().slice(0, 10) })} />
    </div>
  )
}
