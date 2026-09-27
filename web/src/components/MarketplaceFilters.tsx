import type { MarketplaceQuery } from '@/lib/data'
import type { SearchParams } from '@/lib/seo/metadata'
import { isGame, isLang, type Game } from '@/lib/seo/urls'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const num = (v: string | undefined) => (v && !Number.isNaN(Number(v)) ? Number(v) : undefined)

export function parseMarketplaceQuery(sp: SearchParams, game?: Game): MarketplaceQuery {
  const g = one(sp.game)
  const l = one(sp.lang)
  const t = one(sp.type)
  const sort = one(sp.sort)
  return {
    game: game ?? (g && isGame(g) ? g : undefined),
    lang: l && isLang(l) ? l : undefined,
    gradeKey: one(sp.grade)?.slice(0, 12),
    listingType: t === 'graded_single' || t === 'raw_single' || t === 'sealed' ? t : undefined,
    state: one(sp.state)?.toUpperCase().slice(0, 3),
    priceMin: num(one(sp.price_min)),
    priceMax: num(one(sp.price_max)),
    q: one(sp.q)?.slice(0, 80),
    sort: sort === 'price-asc' || sort === 'price-desc' ? sort : 'newest',
    page: Math.max(1, Number(one(sp.page)) || 1),
    pageSize: 48,
  }
}

export function Filters({ action }: { action: string }) {
  return (
    <form action={action} aria-label="Filter listings">
      <label>Language <select name="lang" defaultValue=""><option value="">Any</option><option value="en">EN</option><option value="jp">JP</option></select></label>
      <label>Type <select name="type" defaultValue=""><option value="">Any</option><option value="graded_single">Graded</option><option value="raw_single">Raw</option><option value="sealed">Sealed</option></select></label>
      <label>Grade <input name="grade" placeholder="psa-10" /></label>
      <label>State <select name="state" defaultValue=""><option value="">Any</option>{['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>Min A$ <input name="price_min" inputMode="numeric" /></label>
      <label>Max A$ <input name="price_max" inputMode="numeric" /></label>
      <label>Search <input name="q" type="search" /></label>
      <label>Sort <select name="sort" defaultValue="newest"><option value="newest">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select></label>
      <button type="submit">Apply</button>
    </form>
  )
}

