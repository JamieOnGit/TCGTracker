'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { addWishlist, deleteSearch, removeWishlist } from '@/lib/actions/alerts'
import type { ActionResult } from '@/lib/actions/result'
import { parseAud } from '@/lib/account/format'

export function RemoveAlertButton({ id, kind, label }: { id: number; kind: 'wishlist' | 'search'; label: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending}
        aria-label={`${kind === 'wishlist' ? 'Remove alert for' : 'Delete saved search'} ${label}`}
        onClick={() =>
          start(async () => {
            const res = kind === 'wishlist' ? await removeWishlist(id) : await deleteSearch(id)
            if (!res.ok) setError(res.error)
            router.refresh()
          })
        }
      >
        {pending ? 'Removing…' : kind === 'wishlist' ? 'Remove' : 'Delete'}
      </button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </span>
  )
}

export function WishlistConfirm({ cardId, cardLabel, initialGrade, grades }: { cardId: string; cardLabel: string; initialGrade: string; grades: { key: string; label: string }[] }) {
  const [grade, setGrade] = useState(initialGrade)
  const [max, setMax] = useState('')
  const [state, setState] = useState<ActionResult | null>(null)
  const [pending, start] = useTransition()
  const maxErr = max && parseAud(max) === null ? 'Enter a price in dollars, or leave it blank.' : null

  if (state?.ok) {
    return (
      <div className="panel" role="status" data-testid="alert-set">
        <h2>Alert set</h2>
        <p className="mt-2">{state.message}</p>
        <p className="muted mt-2 text-sm">We&apos;ll email you and show a notification when {cardLabel} is listed{grade !== 'any' ? ` in ${grades.find((g) => g.key === grade)?.label}` : ''}.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/account/alerts/" className="btn btn-primary">See all my alerts</Link>
          <Link href="/marketplace/" className="btn btn-secondary">Browse the marketplace</Link>
        </div>
      </div>
    )
  }
  return (
    <form
      className="form-grid panel"
      onSubmit={(e) => {
        e.preventDefault()
        if (maxErr) return
        start(async () => setState(await addWishlist(cardId, grade === 'any' ? null : grade, max ? (parseAud(max) ?? undefined) : undefined)))
      }}
    >
      <div className="field">
        <label htmlFor="grade">Grade</label>
        <select id="grade" className="select" value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="any">Any grade</option>
          {grades.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="max">Maximum price (A$) <span className="muted">(optional)</span></label>
        <input id="max" className="input" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} aria-invalid={maxErr ? true : undefined} aria-describedby={maxErr ? 'max-err max-hint' : 'max-hint'} />
        <p id="max-hint" className="hint">Only tell me about listings at or under this price.</p>
        {maxErr && <p id="max-err" className="field-error">{maxErr}</p>}
      </div>
      {state && !state.ok && <p className="field-error" role="alert">{state.error}</p>}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Setting alert…' : 'Notify me when it’s listed'}</button>
      </div>
    </form>
  )
}
