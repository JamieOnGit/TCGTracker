'use client'
import Link from 'next/link'
import { startTransition, useActionState, useId, useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { saveDropSetup } from '@/lib/actions/dropSetup'
import type { ActionResult } from '@/lib/actions/result'
import { GAME_OPTIONS, parseKeywords, PRODUCT_TYPE_GROUPS, type AlertMode, type DropChannel, type ProductTypeGroup } from '@/lib/account/sightings'
import { AU_STATES, AU_STATE_NAMES } from '@/lib/data/types'
import { PushToggle } from './PushToggle'
import { TestAlertButton } from './TestAlertButton'

const STEP = { borderColor: 'var(--line)' }
const noop = () => () => undefined

export interface DropSetupInitial {
  mode: AlertMode
  productTypes: ProductTypeGroup[]
  games: string[]
  retailerSlugs: string[] | null
  states: string[] | null
  keywords: string[]
  maxPriceAud: number | null
  onlyAtOrBelowRrp: boolean
  includeSightings: boolean
  channels: Record<DropChannel, boolean>
  onboarded: boolean
}

/**
 * Drop alert setup: one ordinary form in numbered sections, so it works
 * without JavaScript (posts to the saveDropSetup server action). With JS it
 * adds keyword chips, the "follow sets" picker, push and a test alert.
 */
export function DropSetupWizard({ initial, retailers, sets, tier, vapidKey }: {
  initial: DropSetupInitial
  retailers: { slug: string; name: string; monitored: boolean }[]
  sets: string[] // suggested set / release names to follow
  tier: 'free' | 'premium'
  vapidKey: string | null
}) {
  const uid = useId()
  const [state, formAction, pending] = useActionState(saveDropSetup, null as ActionResult | null)
  // False while server-rendering (and without JS), true once hydrated.
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const [mode, setMode] = useState<AlertMode>(initial.mode)
  const [types, setTypes] = useState<string[]>(initial.productTypes)
  const [games, setGames] = useState(initial.games)
  const [allRetailers, setAllRetailers] = useState(initial.retailerSlugs === null)
  const [slugs, setSlugs] = useState(initial.retailerSlugs ?? retailers.map((r) => r.slug))
  const [allStates, setAllStates] = useState(initial.states === null)
  const [states, setStates] = useState<string[]>(initial.states ?? [])
  const [keywords, setKeywords] = useState(initial.keywords)
  const [kwText, setKwText] = useState('')
  const [maxPrice, setMaxPrice] = useState(initial.maxPriceAud === null ? '' : String(initial.maxPriceAud))
  const [rrp, setRrp] = useState(initial.onlyAtOrBelowRrp)
  const [sightings, setSightings] = useState(initial.includeSightings)
  const [channels, setChannels] = useState(initial.channels)
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const setKeys = sets.map((s) => s.toLowerCase())
  const addKeywords = (text: string) => {
    const next = parseKeywords(keywords, text)
    setKeywords(next)
    setKwText('')
  }
  const id = (k: string) => `${uid}-${k}`
  const errField = state && !state.ok ? state.field : undefined

  return (
    <form
      className="form-grid"
      action={formAction}
      aria-label="Drop alert setup"
      onSubmit={(e) => {
        // With JS: submit by hand so React doesn't reset the fields after the action.
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        startTransition(() => formAction(fd))
      }}
    >
      <div className={`notice ${tier === 'premium' ? 'notice-up' : ''}`}>
        {tier === 'premium' ? (
          <><strong>◆ Premium: instant alerts.</strong> You hear about restocks and confirmed member sightings the moment they happen.</>
        ) : (
          <><strong>Free plan: your alerts arrive 5 minutes after Premium members get them.</strong> Popular stock can sell out in that time. <Link className="prose-link" href="/account/billing/upgrade/">Upgrade for instant alerts</Link></>
        )}
      </div>

      <section className="border-t pt-6" style={STEP} aria-labelledby={id('s1')}>
        <h2 id={id('s1')} className="text-lg"><span className="num muted mr-2">1</span>Games</h2>
        <fieldset className="fs mt-3">
          <legend className="sr-only">Games</legend>
          <div className="flex flex-wrap gap-4">
            {GAME_OPTIONS.map((g) => (
              <label key={g.key} className="check">
                <input type="checkbox" name="game" value={g.key} checked={games.includes(g.key)} onChange={() => setGames((l) => toggle(l, g.key))} />
                {g.label}
              </label>
            ))}
          </div>
          {errField === 'games' && <p className="field-error mt-2">{state && !state.ok && state.error}</p>}
        </fieldset>
      </section>

      <section className="border-t pt-6" style={STEP} aria-labelledby={id('s2')}>
        <h2 id={id('s2')} className="text-lg"><span className="num muted mr-2">2</span>Retailers</h2>
        <fieldset className="fs mt-3">
          <legend className="sr-only">Retailers</legend>
          <label className="check mb-3">
            <input type="checkbox" name="all_retailers" checked={allRetailers} onChange={(e) => setAllRetailers(e.target.checked)} /> All retailers (including ones we add later)
          </label>
          <div className="check-grid">
            {retailers.map((r) => (
              <label key={r.slug} className={`check${allRetailers ? ' muted-check' : ''}`}>
                <input type="checkbox" name="retailer" value={r.slug} checked={allRetailers || slugs.includes(r.slug)} disabled={mounted && allRetailers} onChange={() => setSlugs((l) => toggle(l, r.slug))} />
                {r.name}
                {!r.monitored && <span className="tag-quiet">member sightings</span>}
              </label>
            ))}
          </div>
          {errField === 'retailerSlugs' && <p className="field-error mt-2">{state && !state.ok && state.error}</p>}
        </fieldset>
      </section>

      <section className="border-t pt-6" style={STEP} aria-labelledby={id('s3')}>
        <h2 id={id('s3')} className="text-lg"><span className="num muted mr-2">3</span>Your states <span className="muted text-sm">· for in-store sightings</span></h2>
        <p className="muted mt-1 text-sm">Online restocks alert you wherever you are. In-store reports only matter if you can get there.</p>
        <fieldset className="fs mt-3">
          <legend className="sr-only">States for in-store sightings</legend>
          <label className="check mb-3">
            <input type="checkbox" name="all_states" checked={allStates} onChange={(e) => setAllStates(e.target.checked)} /> All of Australia
          </label>
          <div className="check-grid">
            {AU_STATES.map((s) => (
              <label key={s} className={`check${allStates ? ' muted-check' : ''}`}>
                <input type="checkbox" name="state" value={s} checked={allStates || states.includes(s)} disabled={mounted && allStates} onChange={() => setStates((l) => toggle(l, s))} />
                {AU_STATE_NAMES[s]}
              </label>
            ))}
          </div>
          {errField === 'states' && <p className="field-error mt-2">{state && !state.ok && state.error}</p>}
        </fieldset>
      </section>

      <section className="border-t pt-6" style={STEP} aria-labelledby={id('s4')}>
        <h2 id={id('s4')} className="text-lg"><span className="num muted mr-2">4</span>What to alert on</h2>
        <fieldset className="fs mt-3">
          <legend className="sr-only">Alert me about</legend>
          <div className="grid gap-3">
            <label className="check">
              <input type="radio" name="mode" value="interests" checked={mode === 'interests'} onChange={() => setMode('interests')} />
              <span><strong>Only what I follow</strong> <span className="tag-quiet">Recommended</span><span className="muted block text-sm">The sets and product types you pick below, plus any product you tap “Notify me” on.</span></span>
            </label>
            <label className="check">
              <input type="radio" name="mode" value="everything" checked={mode === 'everything'} onChange={() => setMode('everything')} />
              <span><strong>Every drop</strong><span className="muted block text-sm">Every restock and sighting at your stores. Busy: dozens a day in a big release week.</span></span>
            </label>
          </div>
        </fieldset>
        {mode === 'interests' && mounted && keywords.length === 0 && types.length === 0 && (
          <p className="notice mt-3 text-sm" data-testid="follow-nothing">You aren’t following anything yet, so you’ll only hear about products you tap “Notify me” on. Pick a set or a product type below.</p>
        )}
        <fieldset className="fs mt-4">
          <legend>Follow product types</legend>
          <div className="flex flex-wrap gap-2">
            {PRODUCT_TYPE_GROUPS.map((g) => {
              const on = types.includes(g.key)
              return (
                <label key={g.key} className="chip-filter" aria-pressed={on} style={{ cursor: 'pointer', minHeight: 36 }}>
                  <input type="checkbox" className="sr-only" name="product_type" value={g.key} checked={on} onChange={() => setTypes((l) => toggle(l, g.key))} />
                  {on ? '✓ ' : '+ '}{g.label}
                </label>
              )
            })}
          </div>
        </fieldset>
        {sets.length > 0 && (
          <fieldset className="fs mt-3">
            <legend>Follow sets <span className="muted">(upcoming releases and recent sets)</span></legend>
            <div className="flex flex-wrap gap-2">
              {sets.map((name, i) => {
                const on = keywords.includes(setKeys[i]!)
                return (
                  <label key={name} className="chip-filter" aria-pressed={on} style={{ cursor: 'pointer', minHeight: 36 }}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      name={mounted ? undefined : 'keyword'}
                      value={setKeys[i]}
                      checked={on}
                      onChange={() => setKeywords((k) => (on ? k.filter((x) => x !== setKeys[i]) : parseKeywords(k, [setKeys[i]!])))}
                    />
                    {on ? '✓ ' : '+ '}{name}
                  </label>
                )
              })}
            </div>
          </fieldset>
        )}
        <div className="field mt-4">
          <label htmlFor={id('kw')}>{mode === 'interests' ? 'Also follow these words' : 'Keywords'} <span className="muted">{mode === 'interests' ? '(a set, character or product, e.g. prismatic or charizard)' : '(optional — alert only when the product name contains one)'}</span></label>
          {mounted ? (
            <>
              {keywords.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Your keywords">
                  {keywords.map((k) => (
                    <li key={k}>
                      <input type="hidden" name="keyword" value={k} />
                      <span className="chip-filter" style={{ minHeight: 36 }}>
                        {k}
                        <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Remove keyword ${k}`} onClick={() => setKeywords((l) => l.filter((x) => x !== k))}>
                          <X size={14} aria-hidden="true" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <input
                  id={id('kw')}
                  name="keywords_text"
                  className="input"
                  value={kwText}
                  onChange={(e) => setKwText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addKeywords(kwText)
                    }
                  }}
                  placeholder="e.g. elite trainer box"
                  aria-describedby={id('kw-hint')}
                />
                <button type="button" className="btn btn-secondary" onClick={() => addKeywords(kwText)} disabled={!kwText.trim()}>Add</button>
              </div>
            </>
          ) : (
            <input id={id('kw')} name="keywords_text" className="input" defaultValue={keywords.filter((k) => !setKeys.includes(k)).join(', ')} placeholder="e.g. elite trainer box, prismatic" aria-describedby={id('kw-hint')} />
          )}
          <p id={id('kw-hint')} className="hint">{mode === 'interests' ? 'You’re alerted when a product name contains one of these. Separate with commas; up to 20.' : 'Leave empty to hear about everything. Separate keywords with commas; up to 20.'}</p>
          {errField === 'keywords' && <p className="field-error">{state && !state.ok && state.error}</p>}
        </div>
        <div className="field mt-4" style={{ maxWidth: 280 }}>
          <label htmlFor={id('max')}>Maximum price (A$) <span className="muted">(optional)</span></label>
          <input id={id('max')} name="max_price" className="input" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="e.g. 100" aria-invalid={errField === 'max_price' ? true : undefined} />
          {errField === 'max_price' && <p className="field-error">{state && !state.ok && state.error}</p>}
        </div>
        <div className="mt-4 grid gap-3">
          <label className="check">
            <input type="checkbox" name="rrp" checked={rrp} onChange={(e) => setRrp(e.target.checked)} /> RRP only — skip scalper-priced listings
          </label>
          <label className="check">
            <input type="checkbox" name="include_sightings" checked={sightings} onChange={(e) => setSightings(e.target.checked)} /> Include member sightings (in-store and online reports confirmed by the community)
          </label>
        </div>
      </section>

      <section className="border-t pt-6" style={STEP} aria-labelledby={id('s5')}>
        <h2 id={id('s5')} className="text-lg"><span className="num muted mr-2">5</span>How to reach you</h2>
        <fieldset className="fs mt-3">
          <legend className="sr-only">Alert channels</legend>
          <div className="grid gap-3">
            <label className="check"><input type="checkbox" name="channel_email" checked={channels.email} onChange={(e) => setChannels((c) => ({ ...c, email: e.target.checked }))} /> Email</label>
            <label className="check"><input type="checkbox" name="channel_onsite" checked={channels.onsite} onChange={(e) => setChannels((c) => ({ ...c, onsite: e.target.checked }))} /> On-site (the bell and your notifications page)</label>
            <label className="check"><input type="checkbox" name="channel_push" checked={channels.push} onChange={(e) => setChannels((c) => ({ ...c, push: e.target.checked }))} /> Push notifications on devices where you&apos;ve turned them on</label>
            <label className={`check${tier === 'free' ? ' muted-check' : ''}`}>
              <input type="checkbox" name="channel_discord" checked={tier === 'premium' && channels.discord} disabled={tier === 'free'} onChange={(e) => setChannels((c) => ({ ...c, discord: e.target.checked }))} /> Discord direct message
              {tier === 'free' && <span className="tag-quiet">Premium</span>}
            </label>
          </div>
          {tier === 'free' && <p className="muted mt-2 text-xs">Discord alerts are part of Premium.</p>}
        </fieldset>
        <div className="mt-4">
          <PushToggle vapidKey={vapidKey} />
        </div>
      </section>

      <div className="step-footer">
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : initial.onboarded ? 'Save drop alerts' : 'Finish setup'}</button>
          {mounted && <TestAlertButton />}
        </div>
        {state && (
          <p className="form-status" data-ok={state.ok} role="status" data-testid="drop-setup-status">
            {state.ok ? state.message : state.error}
          </p>
        )}
      </div>
    </form>
  )
}
