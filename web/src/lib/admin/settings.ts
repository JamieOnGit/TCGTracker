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
    ],
  },
  {
    id: 'drops',
    title: 'Drops',
    fields: [
      { key: 'drops.public_delay_minutes', label: 'Public history delay', kind: { type: 'int', min: 0, max: 10080, unit: 'minutes' } },
      { key: 'drops.free_delay_minutes', label: 'Free member alert delay', kind: { type: 'int', min: 0, max: 10080, unit: 'minutes' } },
      { key: 'drops.free_delayed_alerts', label: 'Send Free members delayed alerts', kind: { type: 'bool' } },
      { key: 'drops.suppress_above_rrp_pct', label: 'Suppress marketplace sellers above RRP by', kind: { type: 'num', step: 1, unit: '%' } },
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
