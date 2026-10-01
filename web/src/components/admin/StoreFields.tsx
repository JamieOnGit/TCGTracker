import { AU_STATES } from '@/lib/data/types'
import { configList, STORE_KINDS } from '@/lib/admin/stores'
import type { RetailerRow } from '@/lib/admin/data'

const PLATFORM_LABEL = { shopify: 'Shopify', woocommerce: 'WooCommerce', custom: 'Custom (own adapter)', none: 'None (member sightings only)' } as const

/**
 * Fields shared by "Add a store" and each store's settings form. `id` keeps
 * label/input pairs unique when many forms are on the page.
 */
export function StoreFields({ id, store, allowNone = false }: { id: string; store?: RetailerRow; allowNone?: boolean }) {
  const cfg = store?.config ?? {}
  const games = Array.isArray(cfg.games) ? cfg.games.map(String) : []
  const platforms = allowNone ? (['shopify', 'woocommerce', 'custom', 'none'] as const) : (['shopify', 'woocommerce', 'custom'] as const)
  return (
    <>
      <div className="admin-grid-3">
        <div className="field">
          <label htmlFor={`${id}-pl`}>Platform</label>
          <select id={`${id}-pl`} name="platform" className="select" defaultValue={store?.platform ?? 'shopify'}>
            {platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-k`}>Kind</label>
          <select id={`${id}-k`} name="kind" className="select" defaultValue={store?.kind ?? 'specialist'}>
            <option value="">—</option>
            {STORE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-st`}>State</label>
          <select id={`${id}-st`} name="state" className="select" defaultValue={store?.state ?? ''}>
            <option value="">Australia-wide / online</option>
            {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="admin-grid-3">
        <div className="field">
          <label htmlFor={`${id}-c`}>Collections / categories</label>
          <input id={`${id}-c`} name="collections" className="input" defaultValue={configList(cfg, 'collections') || configList(cfg, 'categories')} placeholder="pokemon, one-piece" aria-describedby={`${id}-c-h`} />
          <span id={`${id}-c-h`} className="hint">Comma separated. Shopify collection handles, or WooCommerce category slugs or ids.</span>
        </div>
        <div className="field">
          <label htmlFor={`${id}-kw`}>Include keywords</label>
          <input id={`${id}-kw`} name="keywords" className="input" defaultValue={configList(cfg, 'keywords')} placeholder="optional" />
        </div>
        <div className="field">
          <label htmlFor={`${id}-ex`}>Exclude keywords</label>
          <input id={`${id}-ex`} name="exclude" className="input" defaultValue={configList(cfg, 'exclude')} placeholder="sleeves, binder" />
        </div>
      </div>
      <fieldset className="field">
        <legend className="label">Games</legend>
        <div className="flex flex-wrap gap-4">
          <label className="check"><input type="checkbox" name="games" value="pokemon" defaultChecked={!store || games.includes('pokemon')} /> Pokémon</label>
          <label className="check"><input type="checkbox" name="games" value="one-piece" defaultChecked={!store || games.includes('one-piece')} /> One Piece</label>
        </div>
      </fieldset>
    </>
  )
}
