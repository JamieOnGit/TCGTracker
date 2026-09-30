'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { reportSighting } from '@/lib/actions/sightings'
import type { ActionResult } from '@/lib/actions/result'
import { ATTACHMENT_MAX_BYTES, checkImageFile, extFor, parseAud } from '@/lib/account/format'
import {
  COMMON_PRODUCTS, GAME_OPTIONS, INDEPENDENT_STORE, QUANTITIES, SEEN_OPTIONS, isOnRetailerSite, seenMinutes, type SeenKey, type SightingOutcome,
} from '@/lib/account/sightings'
import { AU_STATES, AU_STATE_NAMES } from '@/lib/data/types'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { prepareImage, uuid } from './imageTools'

type Retailer = { slug: string; name: string; baseUrl: string; monitored: boolean }
type Result = ActionResult<{ id: number; outcome: SightingOutcome }>

/**
 * Report stock seen in a store or online. Validates what it can in the
 * browser (link on the retailer's site, price, limit), resizes the photo to
 * ≤1600px WebP and uploads it to sighting-photos/<uid>/, then calls the
 * report_sighting RPC through a server action.
 */
export function SightingForm({ retailers, userId, defaultState }: { retailers: Retailer[]; userId: string; defaultState: string | null }) {
  const router = useRouter()
  const ids = useId()
  const [channel, setChannel] = useState<'in_store' | 'online'>('in_store')
  const [retailer, setRetailer] = useState('')
  const [game, setGame] = useState<'pokemon' | 'one-piece'>('pokemon')
  const [product, setProduct] = useState('')
  const [state, setState] = useState(defaultState && (AU_STATES as readonly string[]).includes(defaultState) ? defaultState : '')
  const [suburb, setSuburb] = useState('')
  const [store, setStore] = useState('')
  const [url, setUrl] = useState('')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const [limit, setLimit] = useState('')
  const [seen, setSeen] = useState<SeenKey>('now')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<Result | null>(null)
  const [pending, start] = useTransition()
  const id = (k: string) => `${ids}-${k}`
  const selected = retailers.find((r) => r.slug === retailer)
  // Independent game stores: in store only, and the store name is required (DB trigger enforces it too).
  const independent = retailer === INDEPENDENT_STORE
  const monitored = retailers.filter((r) => r.monitored)
  const others = retailers.filter((r) => !r.monitored)

  function validate(): Record<string, string> {
    const e: Record<string, string> = {}
    if (!retailer) e.retailer = 'Choose the retailer.'
    if (product.trim().length < 3) e.product = 'Say what you saw (at least 3 characters).'
    if (channel === 'in_store') {
      if (!state) e.state = 'Choose the state.'
      if (suburb.trim().length < 2) e.suburb = 'Enter the suburb.'
      if (independent && !store.trim()) e.store = 'Add the store’s name.'
    } else if (!url.trim()) {
      e.url = 'Paste the link to the product page.'
    } else if (selected && !isOnRetailerSite(url, selected.baseUrl)) {
      e.url = `The link must be on ${selected.name}’s website (${selected.baseUrl.replace(/\/+$/, '')}/…).`
    }
    if (price && parseAud(price) === null) e.price = 'Enter a price in dollars, or leave it blank.'
    if (limit && !(/^\d{1,2}$/.test(limit) && Number(limit) >= 1 && Number(limit) <= 20)) e.limit = 'Purchase limit is 1 to 20.'
    if (note.length > 280) e.note = 'Keep the note to 280 characters.'
    return e
  }

  function pickPhoto(file: File | null) {
    setErrors((e) => ({ ...e, photo: '' }))
    if (preview) URL.revokeObjectURL(preview)
    if (!file) {
      setPhoto(null)
      setPreview(null)
      return
    }
    const bad = checkImageFile(file, 40 * 1024 * 1024)
    if (bad) return setErrors((e) => ({ ...e, photo: bad }))
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  async function uploadPhoto(): Promise<string | null> {
    if (!photo) return null
    const sb = supabaseBrowser()
    if (!sb) throw new Error('Photo uploads need the Supabase connection.')
    const img = await prepareImage(photo)
    if (img.bytes > ATTACHMENT_MAX_BYTES) throw new Error('That photo is over 5 MB even after resizing. Try a smaller one.')
    const path = `${userId}/${uuid()}.${extFor(img.mime)}`
    const up = await sb.storage.from('sighting-photos').upload(path, img.blob, { contentType: img.mime, upsert: false, cacheControl: '31536000' })
    if (up.error) throw new Error('Photo upload failed. Check your connection, or send the report without a photo.')
    return path
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    setResult(null)
    if (Object.keys(e).length) {
      document.getElementById(id(Object.keys(e)[0]!))?.focus()
      return
    }
    start(async () => {
      let photoPath: string | null = null
      try {
        photoPath = await uploadPhoto()
      } catch (err) {
        setErrors({ photo: err instanceof Error ? err.message : 'Photo upload failed.' })
        return
      }
      const res = await reportSighting({
        retailerSlug: retailer,
        channel,
        game,
        product,
        state: channel === 'in_store' ? state : undefined,
        suburb: channel === 'in_store' ? suburb : undefined,
        storeName: channel === 'in_store' ? store : undefined,
        url: channel === 'online' ? url.trim() : undefined,
        priceAud: price ? (parseAud(price) ?? undefined) : undefined,
        quantity: qty || undefined,
        purchaseLimit: limit ? Number(limit) : undefined,
        photoPath: photoPath ?? undefined,
        note: note || undefined,
        seenMinutesAgo: seenMinutes(seen),
      })
      setResult(res)
      if (!res.ok && res.field) setErrors({ [res.field]: res.error })
      if (res.ok) router.refresh()
    })
  }

  function reset() {
    setProduct('')
    setStore('')
    setUrl('')
    setPrice('')
    setQty('')
    setLimit('')
    setNote('')
    setSeen('now')
    pickPhoto(null)
    setResult(null)
  }

  if (result?.ok) {
    const outcome = result.data?.outcome ?? 'pending'
    return (
      <div className="form-grid" role="status" data-testid="sighting-result" data-outcome={outcome}>
        <div className={`notice ${outcome === 'confirmed' ? 'notice-up' : ''}`}>
          <strong>{result.message}</strong>
          {outcome === 'pending' && <> Reports need a confirmation from another member (one is enough with a photo). Unconfirmed reports expire after 6 hours.</>}
          {outcome === 'confirmed' && <> Members who follow {selected?.name ?? 'this retailer'} are being notified now.</>}
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" onClick={reset}>Report another</button>
          <Link href="/account/alerts/drops/" className="btn btn-secondary">Set up my drop alerts</Link>
        </div>
      </div>
    )
  }

  const err = (k: string) =>
    errors[k] ? (
      <p id={id(`${k}-err`)} className="field-error">
        {errors[k]}
      </p>
    ) : null
  const aria = (k: string, hint?: string) => ({
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': [errors[k] ? id(`${k}-err`) : null, hint ? id(`${k}-hint`) : null].filter(Boolean).join(' ') || undefined,
  })

  return (
    <form className="form-grid" onSubmit={submit} noValidate aria-label="Report a sighting">
      <fieldset className="fs">
        <legend>Where did you see it?</legend>
        <div className="seg-wrap">
          <div className="seg seg-lg" role="radiogroup" aria-label="Where">
            {(['in_store', 'online'] as const).map((c) => (
              <label key={c}>
                <input type="radio" name="channel" value={c} checked={channel === c} disabled={c === 'online' && independent} onChange={() => setChannel(c)} />
                <span>{c === 'in_store' ? 'In store' : 'Online'}</span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <div className="form-row">
        <div className="field">
          <label htmlFor={id('retailer')}>Retailer</label>
          <select
            id={id('retailer')}
            className="select"
            value={retailer}
            onChange={(e) => {
              setRetailer(e.target.value)
              if (e.target.value === INDEPENDENT_STORE) setChannel('in_store')
            }}
            {...aria('retailer')}
          >
            <option value="">Choose…</option>
            {monitored.length > 0 && (
              <optgroup label="Monitored 24/7">
                {monitored.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Other stores">
                {others.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
              </optgroup>
            )}
          </select>
          {err('retailer')}
        </div>
        <fieldset className="fs">
          <legend>Game</legend>
          <div className="seg seg-lg" role="radiogroup" aria-label="Game">
            {GAME_OPTIONS.map((g) => (
              <label key={g.key}>
                <input type="radio" name="game" value={g.key} checked={game === g.key} onChange={() => setGame(g.key)} />
                <span>{g.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="field">
        <label htmlFor={id('product')}>Product</label>
        <input id={id('product')} className="input" list={id('products')} value={product} maxLength={120} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Prismatic Evolutions Elite Trainer Box" {...aria('product', 'x')} />
        <datalist id={id('products')}>
          {COMMON_PRODUCTS.map((p) => <option key={p} value={p} />)}
        </datalist>
        <p id={id('product-hint')} className="hint">Name the set if you can see it — members filter alerts by keywords.</p>
        {err('product')}
      </div>

      {channel === 'in_store' ? (
        <div className="form-row three">
          <div className="field">
            <label htmlFor={id('state')}>State</label>
            <select id={id('state')} className="select" value={state} onChange={(e) => setState(e.target.value)} {...aria('state')}>
              <option value="">Choose…</option>
              {AU_STATES.map((s) => <option key={s} value={s}>{AU_STATE_NAMES[s]}</option>)}
            </select>
            {err('state')}
          </div>
          <div className="field">
            <label htmlFor={id('suburb')}>Suburb</label>
            <input id={id('suburb')} className="input" value={suburb} maxLength={60} autoComplete="address-level2" onChange={(e) => setSuburb(e.target.value)} {...aria('suburb')} />
            {err('suburb')}
          </div>
          <div className="field">
            <label htmlFor={id('store')}>
              {independent ? 'Store name, e.g. Good Games Melbourne Central' : <>Store name <span className="muted">(optional)</span></>}
            </label>
            <input id={id('store')} className="input" value={store} maxLength={80} required={independent} onChange={(e) => setStore(e.target.value)} placeholder={independent ? undefined : 'e.g. Westfield Doncaster'} {...aria('store')} />
            {err('store')}
          </div>
        </div>
      ) : (
        <div className="field">
          <label htmlFor={id('url')}>Link to the product</label>
          <input id={id('url')} className="input" type="url" inputMode="url" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} placeholder={selected ? `${selected.baseUrl.replace(/\/+$/, '')}/…` : 'https://…'} {...aria('url', 'x')} />
          <p id={id('url-hint')} className="hint">Must be the product page on the retailer’s own website.</p>
          {err('url')}
        </div>
      )}

      <div className="form-row three">
        <div className="field">
          <label htmlFor={id('price')}>Price (A$) <span className="muted">(optional)</span></label>
          <input id={id('price')} className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 89.00" {...aria('price')} />
          {err('price')}
        </div>
        <div className="field">
          <label htmlFor={id('qty')}>How many? <span className="muted">(optional)</span></label>
          <select id={id('qty')} className="select" value={qty} onChange={(e) => setQty(e.target.value)}>
            <option value="">Not sure</option>
            {QUANTITIES.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id('limit')}>Purchase limit <span className="muted">(optional)</span></label>
          <input id={id('limit')} className="input" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 2" {...aria('limit')} />
          {err('limit')}
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor={id('seen')}>When did you see it?</label>
          <select id={id('seen')} className="select" value={seen} onChange={(e) => setSeen(e.target.value as SeenKey)}>
            {SEEN_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id('photo')}>Photo <span className="muted">(optional, speeds up confirmation)</span></label>
          <input id={id('photo')} className="input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} {...aria('photo')} />
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={preview} alt="Your photo" className="mt-2" style={{ maxHeight: 120, width: 'auto', border: '1px solid var(--line-strong)' }} />
          )}
          {err('photo')}
        </div>
      </div>

      <div className="field">
        <label htmlFor={id('note')}>Note <span className="muted">(optional)</span></label>
        <textarea id={id('note')} className="textarea" style={{ minHeight: 80 }} value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} placeholder="e.g. On the end cap near the registers, limit 2 per customer" {...aria('note', 'x')} />
        <p id={id('note-hint')} className="hint">{280 - note.length} characters left. No personal details, please.</p>
        {err('note')}
      </div>

      {result && !result.ok && !result.field && <p className="field-error" role="alert">{result.error}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Sending…' : 'Send report'}</button>
        <p className="muted text-xs">Confirmed reports count toward the scout leaderboard and free Premium. Fake reports get accounts suspended.</p>
      </div>
    </form>
  )
}
