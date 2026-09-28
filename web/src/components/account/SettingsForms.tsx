'use client'
import { useActionState, useState } from 'react'
import { updateProfile } from '@/lib/actions/auth'
import { savePreferences } from '@/lib/actions/alerts'
import type { ActionResult } from '@/lib/actions/result'
import { ALERT_TYPES, AU_STATES, CHANNELS } from '@/lib/account/format'

export function ProfileForm({ initial }: { initial: { username: string; displayName: string; locationState: string; postcode: string } }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateProfile, null)
  // Controlled: React resets uncontrolled forms after an action, which would wipe input on a validation error.
  const [v, setV] = useState(initial)
  const bind = (k: keyof typeof initial) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: e.target.value })) })
  const f = state && !state.ok ? state.field : undefined
  const err = (k: string) => (f === k && state && !state.ok ? state.error : null)
  const describe = (k: string, hint?: string) => [hint, err(k) ? `${k}-err` : null].filter(Boolean).join(' ') || undefined
  return (
    <form action={action} className="form-grid" noValidate>
      <div className="form-row">
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" className="input" {...bind('username')} autoComplete="username" required minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9_\-]{2,29}" aria-invalid={err('username') ? true : undefined} aria-describedby={describe('username', 'username-hint')} />
          <p id="username-hint" className="hint">Shown on your listings and seller page. Lowercase letters, numbers, - and _.</p>
          {err('username') && <p id="username-err" className="field-error" role="alert">{err('username')}</p>}
        </div>
        <div className="field">
          <label htmlFor="displayName">Display name <span className="muted">(optional)</span></label>
          <input id="displayName" name="displayName" className="input" {...bind('displayName')} maxLength={60} autoComplete="nickname" aria-invalid={err('displayName') ? true : undefined} aria-describedby={describe('displayName')} />
          {err('displayName') && <p id="displayName-err" className="field-error" role="alert">{err('displayName')}</p>}
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="locationState">State</label>
          <select id="locationState" name="locationState" className="select" {...bind('locationState')}>
            <option value="">Prefer not to say</option>
            {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <p className="hint">Shown on your seller page and used as the default for new listings.</p>
        </div>
        <div className="field">
          <label htmlFor="postcode">Postcode <span className="muted">(private)</span></label>
          <input id="postcode" name="postcode" className="input" {...bind('postcode')} inputMode="numeric" maxLength={4} autoComplete="postal-code" aria-invalid={err('postcode') ? true : undefined} aria-describedby={describe('postcode', 'pc-hint')} />
          <p id="pc-hint" className="hint">Never shown to other members. Pre-fills new listings.</p>
          {err('postcode') && <p id="postcode-err" className="field-error" role="alert">{err('postcode')}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>
        {state && (state.ok || !state.field) && <p className="form-status" data-ok={state.ok} role="status">{state.ok ? state.message : state.error}</p>}
      </div>
    </form>
  )
}

export function PreferencesForm({ matrix, isPremium }: { matrix: Record<string, boolean>; isPremium: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(savePreferences, null)
  const [checked, setChecked] = useState(matrix)
  return (
    <form action={action} data-testid="prefs-form">
      <div className="table-wrap">
        <table className="pref-table">
          <caption className="sr-only">Notification preferences: alert types by channel</caption>
          <thead>
            <tr>
              <th scope="col">Alert</th>
              {CHANNELS.map((c) => <th key={c.key} scope="col" className="c">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ALERT_TYPES.map((t) => (
              <tr key={t.key}>
                <th scope="row">
                  {t.label}
                  {t.key === 'marketing' && <span className="badge badge-raw ml-2">Opt-in</span>}
                  {'hint' in t && t.hint && <span className="hint">{t.key === 'drop' && isPremium ? 'Premium: instant.' : t.hint}</span>}
                </th>
                {CHANNELS.map((c) => {
                  const name = `${t.key}:${c.key}`
                  const onlyEmail = t.key === 'marketing' || t.key === 'weekly_digest'
                  if (onlyEmail && c.key !== 'email') return <td key={c.key} className="c"><span className="subtle" aria-label="Not available">—</span></td>
                  return (
                    <td key={c.key} className="c">
                      <input type="checkbox" name={name} checked={Boolean(checked[name])} onChange={(e) => setChecked((o) => ({ ...o, [name]: e.target.checked }))} aria-label={`${t.label} by ${c.label.toLowerCase()}`} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mt-3 text-xs">
        Transactional alerts (messages, listing reviews, billing) are on by default. Marketing emails and the weekly digest are only sent if you tick them (Spam Act 2003),
        and every email has a one-click unsubscribe. Discord delivery starts once you link your Discord account.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save preferences'}</button>
        {state && <p className="form-status" data-ok={state.ok} role="status">{state.ok ? state.message : state.error}</p>}
      </div>
    </form>
  )
}
