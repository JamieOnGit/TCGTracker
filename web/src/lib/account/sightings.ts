/**
 * Member sightings and drop-alert setup: the pure, client-safe half (options,
 * zod schemas, error copy). The server actions live in lib/actions/sightings.ts
 * and lib/actions/dropSetup.ts; public.report_sighting() enforces the same
 * rules in the database, so these checks are for friendly messages only.
 */
import { z } from 'zod'
import { AU_STATES } from '@/lib/data/types'

/** Independent stores: in store only, store name required (sightings_store_rules trigger). */
export const INDEPENDENT_STORE = 'local-game-store'

export const GAME_OPTIONS = [
  { key: 'pokemon', label: 'Pokémon' },
  { key: 'one-piece', label: 'One Piece' },
] as const

/** Suggestions for the product field (a datalist, so anything else is fine too). */
export const COMMON_PRODUCTS = [
  'Elite Trainer Box',
  'Booster Bundle',
  'Booster Box',
  'Booster packs',
  'Tins',
  'Premium Collection',
  'Starter deck',
  'Special set',
] as const

export const QUANTITIES = [
  { key: 'few', label: 'A few' },
  { key: 'some', label: 'Some' },
  { key: 'plenty', label: 'Plenty' },
] as const
export type Quantity = (typeof QUANTITIES)[number]['key']

/** "Seen how long ago" choices; the RPC caps the back-dating at 240 minutes. */
export const SEEN_OPTIONS = [
  { key: 'now', label: 'Just now', minutes: 0 },
  { key: '15m', label: '15 minutes ago', minutes: 15 },
  { key: '30m', label: '30 minutes ago', minutes: 30 },
  { key: '1h', label: '1 hour ago', minutes: 60 },
  { key: '2h', label: '2 hours ago', minutes: 120 },
  { key: '4h', label: '4 hours ago', minutes: 240 },
] as const
export type SeenKey = (typeof SEEN_OPTIONS)[number]['key']

export function seenMinutes(key: string | null | undefined): number {
  return SEEN_OPTIONS.find((o) => o.key === key)?.minutes ?? 0
}

/**
 * Mirrors report_sighting(): an online sighting's link must sit under the
 * retailer's base URL (lower(url) LIKE lower(rtrim(base, '/')) || '/%').
 */
export function isOnRetailerSite(url: string, baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false
  const u = url.trim()
  if (!/^https:\/\//i.test(u)) return false
  try {
    new URL(u)
  } catch {
    return false
  }
  return u.toLowerCase().startsWith(`${baseUrl.replace(/\/+$/, '').toLowerCase()}/`)
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))

export const sightingSchema = z
  .object({
    retailerSlug: z.string().trim().min(1, 'Choose the retailer.').max(40),
    channel: z.enum(['in_store', 'online']),
    game: z.enum(['pokemon', 'one-piece']),
    product: z.string().trim().min(3, 'Say what you saw (at least 3 characters).').max(120, 'Keep the product under 120 characters.'),
    state: z.enum(AU_STATES).optional(),
    suburb: optionalText(60),
    storeName: optionalText(80),
    priceAud: z.number().positive('Enter a price in dollars, or leave it blank.').lt(10000, 'That price looks too high.').optional(),
    quantity: z.enum(['few', 'some', 'plenty']).optional(),
    purchaseLimit: z.number().int().min(1, 'Purchase limit is 1 to 20.').max(20, 'Purchase limit is 1 to 20.').optional(),
    url: optionalText(500),
    photoPath: optionalText(300),
    note: optionalText(280),
    seenMinutesAgo: z.number().int().min(0).max(240),
  })
  .superRefine((v, ctx) => {
    if (v.channel === 'in_store') {
      if (!v.state) ctx.addIssue({ code: 'custom', path: ['state'], message: 'Choose the state.' })
      if (!v.suburb || v.suburb.length < 2) ctx.addIssue({ code: 'custom', path: ['suburb'], message: 'Enter the suburb (at least 2 letters).' })
      if (v.retailerSlug === INDEPENDENT_STORE && !v.storeName) ctx.addIssue({ code: 'custom', path: ['storeName'], message: 'Add the store’s name.' })
    } else if (v.retailerSlug === INDEPENDENT_STORE) {
      ctx.addIssue({ code: 'custom', path: ['channel'], message: 'Independent game store reports are in store only.' })
    } else if (!v.url || !/^https:\/\//i.test(v.url)) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Paste the https:// link to the product on the retailer’s site.' })
    }
  })
export type SightingInput = z.input<typeof sightingSchema>

export type SightingOutcome = 'pending' | 'merged' | 'confirmed'

export function outcomeOf(row: { merged: boolean; status: string }): SightingOutcome {
  if (row.merged) return 'merged'
  return row.status === 'confirmed' ? 'confirmed' : 'pending'
}

export const OUTCOME_MESSAGE: Record<SightingOutcome, string> = {
  pending: 'Thanks — waiting for another member to confirm.',
  merged: 'Merged with an existing report — counted as a confirmation.',
  confirmed: 'Confirmed — alert sent.',
}

/** Turn a report_sighting() / sighting_votes error into copy a member can act on. */
export function sightingError(message: string | undefined): string {
  const m = (message ?? '').toLowerCase()
  if (m.includes('daily sighting limit')) return 'You’ve reached today’s limit of sighting reports. Thanks for scouting — try again tomorrow.'
  if (m.includes('online sightings need a link')) return 'That link isn’t on the retailer’s website. Paste the product page link from their site.'
  if (m.includes('words that are not allowed')) return 'Your report contains words that aren’t allowed. Please reword it.'
  if (m.includes('paused')) return 'Sighting reports are paused for the moment. Please try again later.'
  if (m.includes('independent store reports must be in store')) return 'Independent game store reports are in store only.'
  if (m.includes('please add the store name')) return 'Add the store’s name.'
  if (m.includes('unknown retailer')) return 'Choose a retailer from the list.'
  if (m.includes('photo must be your own')) return 'Upload the photo again and resend.'
  if (m.includes('sign in')) return 'Sign in again to report a sighting.'
  if (m.includes('own sighting')) return 'You can’t vote on your own report.'
  if (m.includes('already confirmed')) return 'Already confirmed — thanks!'
  if (m.includes('closed')) return 'This report is closed.'
  if (m.includes('duplicate key') || m.includes('23505')) return 'You’ve already voted on this one.'
  if (m.includes('row-level security')) return 'Only Premium members can confirm reports.'
  return 'Something went wrong. Please try again.'
}

export const VOTE_LABEL = { confirm: 'Confirm', gone: 'Sold out', fake: 'Looks fake' } as const
export type Vote = keyof typeof VOTE_LABEL

/** "7 of 10 confirmed sightings toward your next free month of Premium". */
export function rewardProgress(confirmed: number, every = 10, days = 30): { done: number; every: number; earned: number; text: string } {
  const n = Math.max(0, Math.floor(confirmed))
  const e = Math.max(1, Math.floor(every))
  const done = n % e
  const period = days === 30 ? 'month' : `${days} days`
  return {
    done,
    every: e,
    earned: Math.floor(n / e),
    text: `${done} of ${e} confirmed sightings toward your next free ${period} of Premium`,
  }
}

export const SIGHTING_STATUS: Record<string, { label: string; tone: 'neutral' | 'accent' | 'up' | 'warn' | 'down' }> = {
  pending: { label: 'Waiting for confirmation', tone: 'accent' },
  confirmed: { label: 'Confirmed', tone: 'up' },
  rejected: { label: 'Not approved', tone: 'down' },
  expired: { label: 'Expired', tone: 'neutral' },
}

// ------------------------------------------------------------ drop alert setup

/** Keywords: comma or new-line separated, trimmed, lower-cased, de-duplicated, at most 20 (DB check). */
export function parseKeywords(...inputs: (string | string[] | null | undefined)[]): string[] {
  const out: string[] = []
  for (const input of inputs) {
    const parts = Array.isArray(input) ? input : (input ?? '').split(/[,\n]/)
    for (const p of parts) {
      const k = p.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60)
      if (k.length >= 2 && !out.includes(k)) out.push(k)
    }
  }
  return out.slice(0, 20)
}

export const DROP_CHANNELS = ['email', 'onsite', 'push', 'discord'] as const
export type DropChannel = (typeof DROP_CHANNELS)[number]

/** Product types a member can follow, each covering the catalogue's own type names. */
export const PRODUCT_TYPE_GROUPS = [
  { key: 'booster-box', label: 'Booster boxes', types: ['booster-box'] },
  { key: 'etb', label: 'Elite Trainer Boxes', types: ['etb'] },
  { key: 'premium', label: 'Premium & Ultra-Premium collections', types: ['ultra-premium-collection', 'super-premium-collection', 'premium-collection'] },
  { key: 'bundle', label: 'Booster bundles', types: ['booster-bundle'] },
  { key: 'packs', label: 'Packs & blisters', types: ['blister', 'double-pack', 'booster-pack'] },
  { key: 'tins', label: 'Tins & mini tins', types: ['tin', 'mini-tin'] },
  { key: 'decks', label: 'Decks & other collections', types: ['starter-deck', 'battle-deck', 'build-and-battle-stadium', 'collection'] },
] as const
export type ProductTypeGroup = (typeof PRODUCT_TYPE_GROUPS)[number]['key']

/** Group keys -> the catalogue type names stored on drop_alert_filters.product_types. */
export function typesForGroups(keys: string[]): string[] {
  return PRODUCT_TYPE_GROUPS.filter((g) => keys.includes(g.key)).flatMap((g) => [...g.types])
}

/** Stored type names -> the groups to show ticked (a group counts once any of its types is followed). */
export function groupsForTypes(types: string[] | null | undefined): ProductTypeGroup[] {
  const set = new Set(types ?? [])
  return PRODUCT_TYPE_GROUPS.filter((g) => g.types.some((t) => set.has(t))).map((g) => g.key)
}

/** 'interests': only what the member follows (the default); 'everything': every drop matching the filters. */
export const ALERT_MODES = ['interests', 'everything'] as const
export type AlertMode = (typeof ALERT_MODES)[number]

export const dropSetupSchema = z.object({
  mode: z.enum(ALERT_MODES),
  productTypes: z.array(z.enum(PRODUCT_TYPE_GROUPS.map((g) => g.key) as [ProductTypeGroup, ...ProductTypeGroup[]])).max(PRODUCT_TYPE_GROUPS.length),
  games: z.array(z.enum(['pokemon', 'one-piece'])).min(1, 'Pick at least one game.'),
  retailerSlugs: z.array(z.string().max(40)).min(1, 'Pick at least one retailer, or choose all retailers.').nullable(),
  states: z.array(z.enum(AU_STATES)).min(1, 'Pick at least one state, or choose all states.').nullable(),
  keywords: z.array(z.string().min(2).max(60)).max(20, 'Up to 20 keywords.'),
  maxPriceAud: z.number().positive('Enter a price in dollars, or leave it blank.').lt(100000).nullable(),
  onlyAtOrBelowRrp: z.boolean(),
  includeSightings: z.boolean(),
  channels: z.record(z.enum(DROP_CHANNELS), z.boolean()),
})
export type DropSetup = z.infer<typeof dropSetupSchema>
