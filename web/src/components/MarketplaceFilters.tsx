import type { MarketplaceQuery } from '@/lib/data'
import { GRID_PAGE_SIZE } from '@/lib/paging'
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
    pageSize: GRID_PAGE_SIZE,
  }
}

/** The filters as query parameters, so page 2 keeps them (game is in the path on /marketplace/{game}/). */
export function marketplaceParams(q: MarketplaceQuery, { withGame = true } = {}): Record<string, string | undefined> {
  return {
    game: withGame ? q.game : undefined,
    lang: q.lang,
    grade: q.gradeKey,
    type: q.listingType,
    state: q.state,
    price_min: q.priceMin?.toString(),
    price_max: q.priceMax?.toString(),
    q: q.q,
    sort: q.sort !== 'newest' ? q.sort : undefined,
  }
}

export function Filters({ action, current }: { action: string; current?: Partial<MarketplaceQuery> }) {
  const c = current ?? {}
  return (
    <form action={action} aria-label="Filter listings" className="grid gap-5">
      <div className="field">
        <label htmlFor="f-q">Search</label>
        <input id="f-q" name="q" type="search" className="input" defaultValue={c.q} placeholder="Card, set or number" />
      </div>
      <div className="field">
        <label htmlFor="f-lang">Language</label>
        <select id="f-lang" name="lang" className="select" defaultValue={c.lang ?? ''}><option value="">English & Japanese</option><option value="en">English</option><option value="jp">Japanese</option></select>
      </div>
      <div className="field">
        <label htmlFor="f-type">Type</label>
        <select id="f-type" name="type" className="select" defaultValue={c.listingType ?? ''}><option value="">Any</option><option value="graded_single">Graded slab</option><option value="raw_single">Raw single</option><option value="sealed">Sealed product</option></select>
      </div>
      <div className="field">
        <label htmlFor="f-grade">Grade</label>
        <select id="f-grade" name="grade" className="select" defaultValue={c.gradeKey ?? ''}><option value="">Any</option>{['psa-10', 'psa-9', 'psa-8', 'bgs-9.5', 'cgc-10', 'raw'].map((g) => <option key={g} value={g}>{g === 'raw' ? 'Raw' : g.toUpperCase().replace('-', ' ')}</option>)}</select>
      </div>
      <div className="field">
        <label htmlFor="f-state">Seller&apos;s state</label>
        <select id="f-state" name="state" className="select" defaultValue={c.state ?? ''}><option value="">All of Australia</option>{['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="label mb-2">Price (A$)</legend>
        <input aria-label="Minimum price" name="price_min" inputMode="numeric" className="input" placeholder="Min" defaultValue={c.priceMin} />
        <input aria-label="Maximum price" name="price_max" inputMode="numeric" className="input" placeholder="Max" defaultValue={c.priceMax} />
      </fieldset>
      <div className="field">
        <label htmlFor="f-sort">Sort</label>
        <select id="f-sort" name="sort" className="select" defaultValue={c.sort ?? 'newest'}><option value="newest">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select>
      </div>
      <div className="flex gap-3"><button type="submit" className="btn btn-primary flex-1">Show listings</button><a href={action} className="btn btn-secondary">Clear</a></div>
    </form>
  )
}
