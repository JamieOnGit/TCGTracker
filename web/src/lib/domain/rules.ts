/**
 * Business rules. The source of truth is the `site_settings` table (editable
 * in the admin console); these defaults mirror its seed values in
 * supabase/migrations/20260927000100_foundations.sql and are only used when the
 * database isn't configured (demo mode, unit tests).
 */
import { DEFAULT_EBAY, ebaySettingsFromRows, type EbaySettings } from './ebay'

export type QuotaPeriod = 'calendar_month' | 'rolling_30_days'

export interface Rules {
  premiumMonthlyCents: number
  premiumAnnualCents: number | null
  founderMonthlyCents: number | null
  gracePeriodDays: number
  freeQuota: number
  premiumQuota: number
  quotaPeriod: QuotaPeriod
  countRejected: boolean
  defaultTimezone: string
  listingExpiryDays: number
  soldVisibleDays: number
  minPhotos: number
  externalBuyFallback: boolean
  dropsPublicDelayMinutes: number
  freeDelayedDropAlerts: boolean
  primaryGrade: string
  freeDropDelayMinutes: number
  /** Visitors who aren't signed in see store stock this late; members see it live. */
  stockPublicDelayMinutes: number
  rankByPriceUntilPopulation: boolean
  ebay: EbaySettings
  sightings: SightingRules
  /** `stock.show_retailer_images`: show stores' product photos on stock pages (off until image rights are settled). */
  stockShowRetailerImages: boolean
}

/**
 * Member sightings and scout rewards (`sightings.*` / `scouts.*` in
 * site_settings; seeded in 20260930000100_sightings_releases_push.sql).
 */
export interface SightingRules {
  enabled: boolean
  confirmationsNeeded: number
  confirmationsWithPhoto: number
  trustedAfter: number
  trustedMaxRejectPct: number
  dailyLimit: number
  mergeWindowMinutes: number
  pendingExpiryMinutes: number
  goneVotesToClose: number
  rewardEvery: number
  rewardDays: number
}

export const DEFAULT_SIGHTING_RULES: SightingRules = {
  enabled: true,
  confirmationsNeeded: 2,
  confirmationsWithPhoto: 1,
  trustedAfter: 5,
  trustedMaxRejectPct: 10,
  dailyLimit: 10,
  mergeWindowMinutes: 180,
  pendingExpiryMinutes: 360,
  goneVotesToClose: 2,
  rewardEvery: 10,
  rewardDays: 30,
}

const SIGHTING_KEYS: Record<string, keyof SightingRules> = {
  'sightings.enabled': 'enabled',
  'sightings.confirmations_needed': 'confirmationsNeeded',
  'sightings.confirmations_with_photo': 'confirmationsWithPhoto',
  'sightings.trusted_after': 'trustedAfter',
  'sightings.trusted_max_reject_pct': 'trustedMaxRejectPct',
  'sightings.daily_limit': 'dailyLimit',
  'sightings.merge_window_minutes': 'mergeWindowMinutes',
  'sightings.pending_expiry_minutes': 'pendingExpiryMinutes',
  'sightings.gone_votes_to_close': 'goneVotesToClose',
  'scouts.reward_every': 'rewardEvery',
  'scouts.reward_days': 'rewardDays',
}

/** Sighting settings from site_settings rows. Bad values (non-numeric, negative) keep the default. */
export function sightingRulesFromRows(rows: { key: string; value: unknown }[]): SightingRules {
  const out: SightingRules = { ...DEFAULT_SIGHTING_RULES }
  for (const { key, value } of rows) {
    const field = SIGHTING_KEYS[key]
    if (field === undefined) continue
    if (field === 'enabled') {
      if (typeof value === 'boolean') out.enabled = value
      else if (value === 'true' || value === 'false') out.enabled = value === 'true'
      continue
    }
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
    if (Number.isInteger(n) && n >= 0) out[field] = n
  }
  return out
}

export const DEFAULT_RULES: Rules = {
  premiumMonthlyCents: 1299,
  premiumAnnualCents: null,
  founderMonthlyCents: null,
  gracePeriodDays: 7,
  freeQuota: 5,
  premiumQuota: 30,
  quotaPeriod: 'calendar_month',
  countRejected: true,
  defaultTimezone: 'Australia/Melbourne',
  listingExpiryDays: 60,
  soldVisibleDays: 90,
  minPhotos: 2,
  externalBuyFallback: true,
  dropsPublicDelayMinutes: 5,
  freeDelayedDropAlerts: true,
  primaryGrade: 'raw',
  freeDropDelayMinutes: 5,
  stockPublicDelayMinutes: 10,
  rankByPriceUntilPopulation: true,
  ebay: DEFAULT_EBAY,
  sightings: DEFAULT_SIGHTING_RULES,
  stockShowRetailerImages: false,
}

const KEY_MAP: Record<string, keyof Rules> = {
  'billing.premium_monthly_cents': 'premiumMonthlyCents',
  'billing.premium_annual_cents': 'premiumAnnualCents',
  'billing.founder_monthly_cents': 'founderMonthlyCents',
  'billing.grace_period_days': 'gracePeriodDays',
  'quota.free_per_period': 'freeQuota',
  'quota.premium_per_period': 'premiumQuota',
  'quota.period': 'quotaPeriod',
  'quota.count_rejected': 'countRejected',
  'quota.default_timezone': 'defaultTimezone',
  'listings.expiry_days': 'listingExpiryDays',
  'listings.sold_visible_days': 'soldVisibleDays',
  'listings.min_photos': 'minPhotos',
  'features.external_buy_fallback': 'externalBuyFallback',
  'drops.public_delay_minutes': 'dropsPublicDelayMinutes',
  'drops.free_delayed_alerts': 'freeDelayedDropAlerts',
  'market.primary_grade': 'primaryGrade',
  'drops.free_delay_minutes': 'freeDropDelayMinutes',
  'stock.public_delay_minutes': 'stockPublicDelayMinutes',
  'market.rank_by_price_until_population': 'rankByPriceUntilPopulation',
}

/** Build Rules from site_settings rows ({key, value}). Unknown keys are ignored. */
export function rulesFromSettings(rows: { key: string; value: unknown }[]): Rules {
  const rules: Rules = { ...DEFAULT_RULES }
  for (const { key, value } of rows) {
    const field = KEY_MAP[key]
    if (field !== undefined) (rules as unknown as Record<string, unknown>)[field] = value
  }
  rules.ebay = ebaySettingsFromRows(rows)
  rules.sightings = sightingRulesFromRows(rows)
  // Only an explicit true switches retailer photos on.
  const img = rows.find((r) => r.key === 'stock.show_retailer_images')?.value
  rules.stockShowRetailerImages = img === true || img === 'true'
  return rules
}

export function formatAud(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100)
}
