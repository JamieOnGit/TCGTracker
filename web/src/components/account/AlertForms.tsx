'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { addWishlist, deleteSearch, removeWishlist, saveDropFilters } from '@/lib/actions/alerts'
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

const GAMES = [
  { key: 'pokemon', label: 'Pokémon' },
  { key: 'one-piece', label: 'One Piece' },
]

export function DropFiltersForm({ initial, retailers, tier }: {
  initial: { games: string[]; retailerSlugs: string[] | null; onlyAtOrBelowRrp: boolean }
  retailers: { slug: string; name: string; enabled: boolean }[]
  tier: 'free' | 'premium'
}) {
  const [games, setGames] = useState<string[]>(initial.games)
  const [all, setAll] = useState(initial.retailerSlugs === null)
  const [slugs, setSlugs] = useState<string[]>(initial.retailerSlugs ?? retailers.map((r) => r.slug))
  const [rrp, setRrp] = useState(initial.onlyAtOrBelowRrp)
  const [state, setState] = useState<ActionResult | null>(null)
  const [pending, start] = useTransition()
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const gamesErr = games.length === 0 ? 'Pick at least one game.' : null
  const retailersErr = !all && slugs.length === 0 ? 'Pick at least one retailer, or choose all retailers.' : null

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault()
        if (gamesErr || retailersErr) return setState({ ok: false, error: gamesErr ?? retailersErr ?? '' })
        start(async () => setState(await saveDropFilters({ games, retailerSlugs: all ? null : slugs, onlyAtOrBelowRrp: rrp })))
      }}
    >
      <div className={`notice ${tier === 'premium' ? 'notice-up' : ''}`}>
        {tier === 'premium' ? (
          <><strong>◆ Premium: instant alerts.</strong> You hear about restocks and new listings the moment our monitors see them.</>
        ) : (
          <><strong>Free plan: alerts arrive 24 hours after the drop.</strong> Premium members get them instantly. <Link className="prose-link" href="/account/billing/upgrade/">Upgrade</Link></>
        )}
      </div>
      <fieldset className="fs" aria-describedby={gamesErr ? 'games-err' : undefined}>
        <legend>Games</legend>
        <div className="flex flex-wrap gap-4">
          {GAMES.map((g) => (
            <label key={g.key} className="check">
              <input type="checkbox" name="games" value={g.key} checked={games.includes(g.key)} onChange={() => setGames((l) => toggle(l, g.key))} />
              {g.label}
            </label>
          ))}
        </div>
        {gamesErr && <p id="games-err" className="field-error mt-2">{gamesErr}</p>}
      </fieldset>
      <fieldset className="fs" aria-describedby={retailersErr ? 'ret-err' : 'ret-hint'}>
        <legend>Retailers</legend>
        <label className="check mb-3">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All retailers (including ones we add later)
        </label>
        <div className="check-grid">
          {retailers.map((r) => (
            <label key={r.slug} className={`check${all ? ' muted-check' : ''}`}>
              <input type="checkbox" value={r.slug} disabled={all} checked={all || slugs.includes(r.slug)} onChange={() => setSlugs((l) => toggle(l, r.slug))} />
              {r.name}
              {!r.enabled && <span className="tag-quiet">coming soon</span>}
            </label>
          ))}
        </div>
        <p id="ret-hint" className="hint mt-2 text-xs muted">Retailers marked coming soon aren&apos;t monitored yet; your choice applies as soon as they are.</p>
        {retailersErr && <p id="ret-err" className="field-error mt-2">{retailersErr}</p>}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={rrp} onChange={(e) => setRrp(e.target.checked)} /> Only alert me when the price is at or below RRP
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save drop alerts'}</button>
        {state && <p className="form-status" data-ok={state.ok} role="status">{state.ok ? state.message : state.error}</p>}
      </div>
    </form>
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
