import { ActionForm } from '@/components/admin/ActionForm'
import { AdminHeader } from '@/components/admin/bits'
import { EbayPanel } from '@/components/admin/EbayPanel'
import { saveSettings } from '@/lib/actions/admin'
import { settingValues } from '@/lib/admin/data'
import { requireSection } from '@/lib/admin/guard'
import { ALL_SETTING_KEYS, SETTING_GROUPS, settingInputValue, type SettingField } from '@/lib/admin/settings'
import { ebaySettingsFromRows, type EbayCardQuery } from '@/lib/domain/ebay'

export const metadata = { title: 'Settings' }

const EBAY_KEYS = ['ebay.enabled', 'ebay.site', 'ebay.affiliate_enabled', 'ebay.campaign_id', 'ebay.custom_id', 'ebay.rotation_id']
const FALLBACK_SAMPLE: EbayCardQuery = { cardId: 'sample', name: 'Charizard ex', number: '199', setName: '151', lang: 'en', game: 'pokemon', gradeKey: 'psa-10' }

function Field({ f, value }: { f: SettingField; value: unknown }) {
  const id = `s-${f.key.replace(/\W/g, '-')}`
  const hintId = f.hint ? `${id}-h` : undefined
  const v = settingInputValue(f.kind, value)
  if (f.kind.type === 'bool') {
    return (
      <div className="field">
        <label className="check" htmlFor={id}>
          <input id={id} type="checkbox" name={f.key} defaultChecked={value === true} aria-describedby={hintId} />
          {f.label}
        </label>
        {f.hint && <span id={hintId} className="hint">{f.hint}</span>}
      </div>
    )
  }
  const unit = f.kind.type === 'int' || f.kind.type === 'num' ? f.kind.unit : f.kind.type === 'cents' ? 'A$' : undefined
  return (
    <div className="field">
      <label htmlFor={id}>{f.label}{unit && unit !== 'A$' ? ` (${unit})` : ''}</label>
      {f.kind.type === 'enum' ? (
        <select id={id} name={f.key} className="select" defaultValue={v} aria-describedby={hintId}>
          {f.kind.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : f.kind.type === 'text' ? (
        <input id={id} name={f.key} className="input" defaultValue={v} maxLength={f.kind.max} aria-describedby={hintId} />
      ) : (
        <input
          id={id}
          name={f.key}
          className="input num"
          inputMode={f.kind.type === 'int' ? 'numeric' : 'decimal'}
          defaultValue={v}
          required
          aria-describedby={hintId}
        />
      )}
      {f.hint && <span id={hintId} className="hint">{f.hint}</span>}
    </div>
  )
}

export default async function AdminSettings() {
  const { sb } = await requireSection('settings')
  const [values, top] = await Promise.all([
    settingValues(sb, [...ALL_SETTING_KEYS, ...EBAY_KEYS]),
    sb.from('market_cap_rankings').select('card_id,grade_key').eq('grade_key', 'psa-10').order('rank_value', { ascending: false }).limit(1).maybeSingle(),
  ])
  let sample = FALLBACK_SAMPLE
  if (top.data) {
    const { data: c } = await sb.from('cards').select('id,name,number,lang,game,set:sets(name)').eq('id', top.data.card_id).maybeSingle()
    if (c) {
      const card = c as unknown as { id: string; name: string; number: string; lang: 'en' | 'jp'; game: 'pokemon' | 'one-piece'; set: { name: string } | null }
      sample = { cardId: card.id, name: card.name, number: card.number, setName: card.set?.name ?? '', lang: card.lang, game: card.game, gradeKey: top.data.grade_key as string }
    }
  }
  const ebay = ebaySettingsFromRows(EBAY_KEYS.map((key) => ({ key, value: values[key] })).filter((r) => r.value !== undefined))

  return (
    <>
      <AdminHeader title="Settings" lead="Business rules live in the database, not in code. Changes apply straight away and are audit-logged." />
      <nav aria-label="Setting groups" className="mb-8 flex flex-wrap gap-2">
        {SETTING_GROUPS.map((g) => <a key={g.id} className="chip-filter" href={`#${g.id}`}>{g.title}</a>)}
        <a className="chip-filter" href="#ebay">eBay affiliate</a>
      </nav>
      <div className="grid gap-8">
        {SETTING_GROUPS.map((g) => (
          <section key={g.id} id={g.id} className="admin-panel" aria-labelledby={`${g.id}-h`}>
            <h2 id={`${g.id}-h`} className="admin-h2">{g.title}</h2>
            {g.intro && <p className="muted text-sm">{g.intro}</p>}
            <ActionForm action={saveSettings} submitLabel={`Save ${g.title.toLowerCase()}`} className="admin-form mt-4" ariaLabel={`${g.title} settings`}>
              <input type="hidden" name="keys" value={g.fields.map((f) => f.key).join(',')} />
              <div className="admin-grid-2">
                {g.fields.map((f) => <Field key={f.key} f={f} value={values[f.key]} />)}
              </div>
            </ActionForm>
          </section>
        ))}
        <EbayPanel initial={ebay} sample={sample} />
      </div>
    </>
  )
}
