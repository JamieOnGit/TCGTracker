/**
 * Admin → Drops → stores: validation and config building for the "Add a
 * store" and "Store settings" forms. Pure (no data access) so it is unit
 * tested; the server actions in lib/actions/admin.ts call it.
 *
 * Generic stores are monitored from the catalogue they publish openly
 * (Shopify collections, WooCommerce Store API categories). A store that
 * blocks automated access gets a blocked_reason and is covered by member
 * sightings; nothing here works around a block.
 */
import { z } from 'zod'
import { AU_STATES } from '@/lib/data/types'
import { slugify } from '@/lib/seo/urls'

export const STORE_PLATFORMS = ['shopify', 'woocommerce', 'custom', 'none'] as const
export type StorePlatform = (typeof STORE_PLATFORMS)[number]
export const STORE_KINDS = ['specialist', 'big-box', 'toy', 'department', 'marketplace', 'official', 'other'] as const

/** Slugs that are routes under /drops/ (or states), so a store can't take them. */
const RESERVED = new Set(['in-stock', 'stores', 'scouts', ...AU_STATES.map((s) => s.toLowerCase())])

/** "pokemon, one-piece-tcg ,, 123" → ['pokemon', 'one-piece-tcg', '123'] (trimmed, unique, max 30). */
export function commaList(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return [...new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 30)
}

const handle = z.string().max(120).regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/, 'Collections and categories are handles, slugs or ids (letters, numbers, - and _)')
const keyword = z.string().max(60)

const configFields = z.object({
  platform: z.enum(STORE_PLATFORMS),
  collections: z.array(handle),
  keywords: z.array(keyword),
  exclude: z.array(keyword),
  games: z.array(z.enum(['pokemon', 'one-piece'])),
  kind: z.union([z.enum(STORE_KINDS), z.literal('')]),
  state: z.union([z.enum(AU_STATES), z.literal('')]),
})

export const newStoreSchema = configFields.extend({
  name: z.string().trim().min(2, 'Give the store a name').max(80),
  baseUrl: z
    .url({ protocol: /^https$/, error: 'Enter the store’s web address, starting with https://' })
    .max(200)
    .transform((u) => u.replace(/\/+$/, '')),
  enabled: z.boolean(),
})

export const storeSettingsSchema = configFields.extend({
  blockedReason: z.string().trim().max(200, 'Keep the reason under 200 characters'),
})

export type ConfigFields = z.infer<typeof configFields>

/** "Add a store" form → fields for zod. */
export function readNewStore(form: FormData): Record<string, unknown> {
  return { ...readConfigFields(form), name: String(form.get('name') ?? ''), baseUrl: String(form.get('base_url') ?? '').trim(), enabled: form.get('enabled') === 'on' }
}

/** Form → fields for zod. Checkbox groups arrive as repeated keys. */
export function readConfigFields(form: FormData): Record<string, unknown> {
  return {
    platform: form.get('platform'),
    collections: commaList(form.get('collections')),
    keywords: commaList(form.get('keywords')),
    exclude: commaList(form.get('exclude')),
    games: form.getAll('games').map(String),
    kind: String(form.get('kind') ?? ''),
    state: String(form.get('state') ?? ''),
  }
}

/**
 * The retailers.config object for a platform. Shopify reads `collections`
 * (handles), WooCommerce `categories` (slugs or ids). Keys the form doesn't
 * manage are kept from the current config.
 */
export function buildStoreConfig(f: Pick<ConfigFields, 'platform' | 'collections' | 'keywords' | 'exclude' | 'games'>, current: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current }
  for (const k of ['collections', 'categories', 'keywords', 'exclude', 'games']) delete out[k]
  if (f.platform === 'shopify' && f.collections.length) out.collections = f.collections
  if (f.platform === 'woocommerce' && f.collections.length) out.categories = f.collections.map((c) => (/^\d+$/.test(c) ? Number(c) : c))
  if (f.keywords.length) out.keywords = f.keywords
  if (f.exclude.length) out.exclude = f.exclude
  if (f.games.length) out.games = f.games
  return out
}

/** Collections/categories from a stored config, for the edit form. */
export function configList(config: Record<string, unknown> | null | undefined, key: 'collections' | 'categories' | 'keywords' | 'exclude' | 'games'): string {
  const v = config?.[key]
  return Array.isArray(v) ? v.map(String).join(', ') : ''
}

/**
 * The worker adapter for a platform. Generic stores share the shopify /
 * woocommerce adapters; "custom" keeps a hand-written adapter if the store
 * has one, otherwise it has none yet (member sightings only, can't be enabled).
 */
export function adapterFor(platform: StorePlatform, currentAdapter?: string): string {
  if (platform === 'shopify' || platform === 'woocommerce') return platform
  if (platform === 'custom' && currentAdapter && !['shopify', 'woocommerce', 'none'].includes(currentAdapter)) return currentAdapter
  return 'none'
}

/** A new store's slug from its name; null when it would clash with a /drops/ route or state. */
export function storeSlug(name: string): string | null {
  const s = slugify(name).slice(0, 60).replace(/-$/, '')
  return s.length >= 2 && !RESERVED.has(s) ? s : null
}
