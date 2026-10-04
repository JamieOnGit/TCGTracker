/**
 * The site_settings the console edits, grouped into forms. Validation of the
 * stored value happens in updateSetting (lib/actions/admin.ts); this file
 * only turns what a person typed into the stored JSON shape.
 */
import { audToCents } from './format'

export type FieldKind =
  | { type: 'cents' }
  | { type: 'int'; min?: number; max?: number; unit?: string }
  | { type: 'num'; step?: number; unit?: string }
  | { type: 'bool' }
  | { type: 'enum'; options: { value: string; label: string }[] }
  | { type: 'text'; nullable: boolean; max: number }

export interface SettingField {
  key: string
  label: string
  hint?: string
  kind: FieldKind
}

export interface SettingGroup {
  id: string
  title: string
  intro?: string
  fields: SettingField[]
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'membership',
    title: 'Membership',
    intro: 'Premium price and listing quotas. Prices include GST.',
    fields: [
      { key: 'billing.premium_monthly_cents', label: 'Premium monthly price (A$)', hint: 'Shown on /premium/. The Stripe price must be changed to match.', kind: { type: 'cents' } },
      { key: 'quota.free_per_period', label: 'Free listings per period', kind: { type: 'int', min: 0, max: 1000 } },
      { key: 'quota.premium_per_period', label: 'Premium listings per period', kind: { type: 'int', min: 0, max: 10000 } },
      { key: 'quota.period', label: 'Quota period', kind: { type: 'enum', options: [{ value: 'calendar_month', label: 'Calendar month' }, { value: 'rolling_30_days', label: 'Rolling 30 days' }] } },
      { key: 'quota.count_rejected', label: 'Rejected listings count toward the quota', kind: { type: 'bool' } },
      { key: 'billing.grace_period_days', label: 'Payment grace period', hint: 'Days a past-due member keeps Premium.', kind: { type: 'int', min: 0, max: 30, unit: 'days' } },
    ],
  },
  {
    id: 'listings',
    title: 'Listings',
    fields: [
      { key: 'listings.expiry_days', label: 'Listing expiry', kind: { type: 'int', min: 7, max: 365, unit: 'days' } },
      { key: 'listings.auto_approve_trusted', label: 'Auto-approve trusted sellers', hint: 'Skips review unless the cert looks mismatched.', kind: { type: 'bool' } },
    ],
  },
  {
    id: 'market',
    title: 'Market',
    fields: [
      { key: 'market.outlier_min_ratio', label: 'Outlier ratio', hint: 'Asks below this fraction of the 30-day sold median are ignored (0–1).', kind: { type: 'num', step: 0.05 } },
      { key: 'market.floor_refresh_hours', label: 'Floor refresh', kind: { type: 'num', step: 1, unit: 'hours' } },
      { key: 'justtcg.raw_discover', label: 'Add every card in a set', hint: 'Cards with only ungraded prices are added too (most of a new set). Off: only cards with graded sales.', kind: { type: 'bool' } },
      { key: 'market.snapshot_min_aud', label: 'Daily value history from', hint: 'Cheaper cards are still ranked, without charts or % change. Keeps the database small.', kind: { type: 'num', step: 1, unit: 'A$' } },
      { key: 'justtcg.history_min_aud', label: 'Backfill a year of history from', hint: 'Only for new cards worth at least this.', kind: { type: 'num', step: 1, unit: 'A$' } },
    ],
  },
  {
    id: 'drops',
    title: 'Drops',
    fields: [
      { key: 'drops.public_delay_minutes', label: 'Public history delay', kind: { type: 'int', min: 0, max: 10080, unit: 'minutes' } },
      { key: 'drops.free_delay_minutes', label: 'Free member alert delay', kind: { type: 'int', min: 0, max: 10080, unit: 'minutes' } },
      { key: 'drops.free_delayed_alerts', label: 'Send Free members delayed alerts', kind: { type: 'bool' } },
      { key: 'drops.price_drop_pct', label: 'Price-drop alerts from', hint: 'Only alert when a store cuts the price by at least this much.', kind: { type: 'int', min: 1, max: 90, unit: '%' } },
      { key: 'drops.suppress_above_rrp_pct', label: 'Suppress marketplace sellers above RRP by', kind: { type: 'num', step: 1, unit: '%' } },
      { key: 'stock.show_retailer_images', label: 'Show store product photos', hint: 'Off until image rights are settled; stock pages use a placeholder.', kind: { type: 'bool' } },
      { key: 'stock.default_interval_seconds', label: 'Check interval for new stores', kind: { type: 'int', min: 30, max: 86400, unit: 'seconds' } },
      { key: 'releases.auto_sync', label: 'Fill the release calendar automatically', hint: 'Australian dates from Bandai (One Piece, Oceania) and JB Hi-Fi pre-orders, every 6 hours. Entries you edit are never overwritten.', kind: { type: 'bool' } },
    ],
  },
  {
    id: 'sightings',
    title: 'Member sightings',
    fields: [
      { key: 'sightings.enabled', label: 'Members can report sightings', kind: { type: 'bool' } },
      { key: 'sightings.confirmations_needed', label: 'Confirmations needed', hint: 'Other members who must confirm before the alert goes out. Set to 1 at launch while the community is small.', kind: { type: 'int', min: 1, max: 10 } },
      { key: 'sightings.confirmations_with_photo', label: 'Confirmations needed with a photo', kind: { type: 'int', min: 0, max: 10 } },
      { key: 'sightings.trusted_after', label: 'Trusted scout after', hint: 'Confirmed sightings before a scout’s reports alert without confirmation.', kind: { type: 'int', min: 1, max: 1000, unit: 'sightings' } },
      { key: 'sightings.trusted_max_reject_pct', label: 'Trusted scouts: max rejected', kind: { type: 'int', min: 0, max: 100, unit: '%' } },
      { key: 'sightings.daily_limit', label: 'Reports per member per day', kind: { type: 'int', min: 1, max: 100 } },
      { key: 'sightings.pending_expiry_minutes', label: 'Unconfirmed reports expire after', kind: { type: 'int', min: 30, max: 2880, unit: 'minutes' } },
      { key: 'sightings.gone_votes_to_close', label: '"Sold out" votes to close', kind: { type: 'int', min: 1, max: 10 } },
      { key: 'scouts.reward_every', label: 'Premium reward every', hint: 'Confirmed sightings per reward. 0 turns rewards off.', kind: { type: 'int', min: 0, max: 1000, unit: 'sightings' } },
      { key: 'scouts.reward_days', label: 'Premium reward length', kind: { type: 'int', min: 1, max: 365, unit: 'days' } },
    ],
  },
  {
    id: 'deals',
    title: 'eBay deals',
    fields: [
      { key: 'deals.enabled', label: 'Find eBay deals', hint: 'Needs the eBay developer keys on the workers (see YOUR-NEXT-STEPS.md).', kind: { type: 'bool' } },
      { key: 'deals.min_discount_pct', label: 'Buy It Now deals: at least', kind: { type: 'int', min: 5, max: 90, unit: '% under value' } },
      { key: 'deals.auction_ending_minutes', label: 'Auctions ending within', kind: { type: 'int', min: 15, max: 1440, unit: 'minutes' } },
      { key: 'deals.max_cards_per_run', label: 'Cards checked per run', kind: { type: 'int', min: 10, max: 1000 } },
      { key: 'deals.public_delay_minutes', label: 'Free members see deals after', kind: { type: 'int', min: 0, max: 10080, unit: 'minutes' } },
    ],
  },
  {
    id: 'images',
    title: 'Images',
    intro: 'Card pictures come from TCGdex, pokemontcg.io and Bandai first. Admin → Images lists any still missing.',
    fields: [
      { key: 'images.tcgplayer_fallback', label: 'Use TCGplayer pictures as a last resort', hint: 'For cards no open source has a picture for, by the exact TCGplayer id JustTCG gives each card.', kind: { type: 'bool' } },
    ],
  },
  {
    id: 'features',
    title: 'Features',
    fields: [
      { key: 'features.external_buy_fallback', label: 'External buy fallback', hint: 'Show an eBay link when a card has no listings. The eBay panel below controls the link itself.', kind: { type: 'bool' } },
    ],
  },
  {
    id: 'announcement',
    title: 'Announcement banner',
    fields: [
      { key: 'site.announcement', label: 'Banner text', hint: 'Leave empty for no banner. Up to 200 characters.', kind: { type: 'text', nullable: true, max: 200 } },
    ],
  },
]

export const ALL_SETTING_KEYS = SETTING_GROUPS.flatMap((g) => g.fields.map((f) => f.key))

export function findField(key: string): SettingField | undefined {
  for (const g of SETTING_GROUPS) for (const f of g.fields) if (f.key === key) return f
  return undefined
}

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string }

/** Form input → the JSON value stored in site_settings. Unchecked checkboxes arrive as null. */
export function parseSettingInput(kind: FieldKind, raw: string | null): Parsed {
  const s = (raw ?? '').trim()
  switch (kind.type) {
    case 'bool':
      return { ok: true, value: s === 'on' || s === 'true' }
    case 'cents': {
      const c = audToCents(s)
      return c === null ? { ok: false, error: 'Enter a dollar amount like 12.99' } : { ok: true, value: c }
    }
    case 'int': {
      if (!/^-?\d+$/.test(s)) return { ok: false, error: 'Enter a whole number' }
      return { ok: true, value: Number(s) }
    }
    case 'num': {
      const n = Number(s)
      return s === '' || !Number.isFinite(n) ? { ok: false, error: 'Enter a number' } : { ok: true, value: n }
    }
    case 'enum':
      return kind.options.some((o) => o.value === s) ? { ok: true, value: s } : { ok: false, error: 'Pick one of the options' }
    case 'text':
      if (s.length > kind.max) return { ok: false, error: `Up to ${kind.max} characters` }
      return { ok: true, value: s === '' && kind.nullable ? null : s }
  }
}

/** Stored JSON value → the string an input shows. */
export function settingInputValue(kind: FieldKind, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (kind.type === 'cents' && typeof value === 'number') return (value / 100).toFixed(2)
  return typeof value === 'string' ? value : String(value)
}
