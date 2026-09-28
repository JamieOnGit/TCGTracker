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
  rankByPriceUntilPopulation: boolean
  ebay: EbaySettings
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
  dropsPublicDelayMinutes: 1440,
  freeDelayedDropAlerts: true,
  primaryGrade: 'psa-10',
  freeDropDelayMinutes: 1440,
  rankByPriceUntilPopulation: true,
  ebay: DEFAULT_EBAY,
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
  return rules
}

export function formatAud(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100)
}
