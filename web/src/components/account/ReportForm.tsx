'use client'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { report } from '@/lib/actions/messages'
import type { ActionResult } from '@/lib/actions/result'

const REASONS = [
  { key: 'scam', label: 'Scam or fraud', hint: 'Asking for money with no intention to send the item, fake payment proof…' },
  { key: 'off_platform_payment', label: 'Pushing an unprotected payment', hint: 'PayPal Friends & Family, bank transfer to strangers, gift cards, crypto.' },
  { key: 'counterfeit', label: 'Fake, proxy or resealed product' },
  { key: 'misrepresented', label: 'Misrepresented item', hint: 'Wrong grade, condition, language or photos.' },
  { key: 'offensive', label: 'Abusive or offensive' },
  { key: 'spam', label: 'Spam' },
  { key: 'other', label: 'Something else' },
] as const

export function ReportForm({ targetType, targetId, backHref }: { targetType: 'listing' | 'user' | 'conversation' | 'message'; targetId: string; backHref: string }) {
  const [reason, setReason] = useState<string>('')
  const [details, setDetails] = useState('')
  const [state, setState] = useState<ActionResult | null>(null)
  const [pending, start] = useTransition()
  const reasonErr = state && !state.ok && !reason ? 'Choose a reason.' : null

  if (state?.ok) {
    return (
      <div className="panel" role="status" data-testid="report-done">
        <h2>Report sent</h2>
        <p className="mt-2">{state.message} We don&apos;t tell the other member who reported them.</p>
        <p className="muted mt-2 text-sm">If you&apos;ve lost money, also contact your bank or payment provider and report it to Scamwatch (scamwatch.gov.au).</p>
        <Link href={backHref} className="btn btn-secondary mt-5">Go back</Link>
      </div>
    )
  }
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault()
        if (!reason) return setState({ ok: false, error: 'Choose a reason.' })
        start(async () => setState(await report({ targetType, targetId, reason, details: details.trim() || undefined })))
      }}
    >
      <fieldset className="fs" aria-describedby={reasonErr ? 'reason-err' : undefined}>
        <legend>What&apos;s wrong?</legend>
        <div className="grid gap-3">
          {REASONS.map((r) => (
            <label key={r.key} className="check items-start">
              <input type="radio" name="reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} style={{ marginTop: 2 }} />
              <span>
                {r.label}
                {'hint' in r && <span className="hint block text-xs muted">{r.hint}</span>}
              </span>
            </label>
          ))}
        </div>
        {reasonErr && <p id="reason-err" className="field-error mt-2" role="alert">{reasonErr}</p>}
      </fieldset>
      <div className="field">
        <label htmlFor="details">Details <span className="muted">(optional)</span></label>
        <textarea id="details" className="textarea" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} aria-describedby="details-hint" />
        <p id="details-hint" className="hint">Anything that helps our moderators: what was said, links, dates.</p>
      </div>
      {state && !state.ok && reason && <p className="field-error" role="alert">{state.error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Sending…' : 'Send report'}</button>
        <Link href={backHref} className="btn btn-ghost self-center">Cancel</Link>
      </div>
    </form>
  )
}
