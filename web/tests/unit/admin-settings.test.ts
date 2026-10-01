import { describe, expect, it } from 'vitest'
import { ALL_SETTING_KEYS, findField, parseSettingInput, settingInputValue } from '@/lib/admin/settings'

describe('settings form parsing', () => {
  it('covers the brief’s editable settings', () => {
    for (const k of ['billing.premium_monthly_cents', 'quota.free_per_period', 'quota.count_rejected', 'listings.auto_approve_trusted', 'drops.suppress_above_rrp_pct', 'features.external_buy_fallback', 'site.announcement']) {
      expect(ALL_SETTING_KEYS).toContain(k)
    }
  })
  it('the premium price is typed in A$ and stored in cents', () => {
    const f = findField('billing.premium_monthly_cents')!
    expect(parseSettingInput(f.kind, '12.99')).toEqual({ ok: true, value: 1299 })
    expect(parseSettingInput(f.kind, 'twelve').ok).toBe(false)
    expect(settingInputValue(f.kind, 1299)).toBe('12.99')
  })
  it('checkboxes: present = true, missing = false', () => {
    const f = findField('quota.count_rejected')!
    expect(parseSettingInput(f.kind, 'on')).toEqual({ ok: true, value: true })
    expect(parseSettingInput(f.kind, null)).toEqual({ ok: true, value: false })
  })
  it('ints, numbers and enums', () => {
    expect(parseSettingInput(findField('quota.free_per_period')!.kind, '5')).toEqual({ ok: true, value: 5 })
    expect(parseSettingInput(findField('quota.free_per_period')!.kind, '5.5').ok).toBe(false)
    expect(parseSettingInput(findField('market.outlier_min_ratio')!.kind, '0.5')).toEqual({ ok: true, value: 0.5 })
    expect(parseSettingInput(findField('quota.period')!.kind, 'rolling_30_days')).toEqual({ ok: true, value: 'rolling_30_days' })
    expect(parseSettingInput(findField('quota.period')!.kind, 'weekly').ok).toBe(false)
  })
  it('an empty announcement clears the banner', () => {
    const f = findField('site.announcement')!
    expect(parseSettingInput(f.kind, '  ')).toEqual({ ok: true, value: null })
    expect(parseSettingInput(f.kind, 'x'.repeat(201)).ok).toBe(false)
  })
})

describe('every admin setting is editable', () => {
  it('has a server-side validator for each field on the settings page', async () => {
    const { SETTING_VALIDATORS } = await import('@/lib/admin/settingValidators')
    const missing = ALL_SETTING_KEYS.filter((k) => !(k in SETTING_VALIDATORS))
    expect(missing).toEqual([])
  })
})
