'use client'
import Link from 'next/link'
import { useId, useRef, useState, useTransition } from 'react'
import { Check, ImagePlus, Search, X } from 'lucide-react'
import { addListingImage, removeListingImage, saveDraft, searchCatalogue, submitListing } from '@/lib/actions/listings'
import type { CardOption, EditableListing, SealedOption } from '@/lib/account/data'
import {
  AU_STATES, bannedWordHints, checkImageFile, CONDITIONS, extFor, GRADE_VALUES, GRADERS, gradeText, isPostcode, LISTING_IMAGE_MAX_BYTES,
  LISTING_TYPE_LABEL, looksLikeContactDetails, parseAud, photoSlots, quotaLine, quotaPercent, suggestTitle, type ListingType,
} from '@/lib/account/format'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { prepareImage, uuid } from './imageTools'

export interface EditorProps {
  userId: string
  initial: EditableListing | null
  prefill: { card: CardOption | null; grader: string | null; grade: number | null; raw: boolean }
  quota: { used: number; limit: number; resetsAt: string | null; tier: 'free' | 'premium'; timeZone: string }
  defaults: { locationState: string | null; postcode: string | null }
  rules: { minPhotos: number; freeQuota: number; premiumQuota: number; premiumPrice: string }
}

type Img = { id: number; kind: string; url: string; path: string }
type Ship = { name: string; price: string }
const STEPS = ['Item', 'Grade & condition', 'Price & delivery', 'Photos', 'Review & submit'] as const

function FieldError({ id, msg }: { id: string; msg?: string }) {
  return msg ? <p id={id} className="field-error" role="alert">{msg}</p> : null
}

export function ListingEditor({ userId, initial, prefill, quota: q0, defaults, rules }: EditorProps) {
  const [step, setStep] = useState(0)
  const [listingId, setListingId] = useState<number | null>(initial?.id ?? null)
  const [type, setType] = useState<ListingType>(initial?.listingType ?? (prefill.raw ? 'raw_single' : 'graded_single'))
  const [card, setCard] = useState<CardOption | null>(initial?.card ?? prefill.card)
  const [sealed, setSealed] = useState<SealedOption | null>(initial?.sealed ?? null)
  const [grader, setGrader] = useState<string>(initial?.grader ?? prefill.grader ?? 'PSA')
  const [grade, setGrade] = useState<string>(initial?.grade != null ? String(initial.grade) : prefill.grade != null ? String(prefill.grade) : '10')
  const [cert, setCert] = useState(initial?.certNumber ?? '')
  const [condition, setCondition] = useState<string>(initial?.condition ?? 'NM')
  const [price, setPrice] = useState(initial ? String(initial.priceAud) : '')
  const [qty, setQty] = useState(initial ? String(initial.qty) : '1')
  const [locState, setLocState] = useState<string>(initial?.locationState ?? defaults.locationState ?? '')
  const [postcode, setPostcode] = useState(initial?.postcode ?? defaults.postcode ?? '')
  const [pickup, setPickup] = useState(initial?.pickup ?? true)
  const [ship, setShip] = useState<Ship[]>(
    initial?.shippingOptions.length ? initial.shippingOptions.map((s) => ({ name: s.name, price: String(s.priceAud) })) : [{ name: 'Tracked post (Australia Post)', price: '12' }],
  )
  const [title, setTitle] = useState(initial?.title ?? '')
  const [titleTouched, setTitleTouched] = useState(Boolean(initial))
  const [description, setDescription] = useState(initial?.description ?? '')
  const [images, setImages] = useState<Img[]>(initial?.images ?? [])
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null)
  const [quotaHit, setQuotaHit] = useState(q0.used >= q0.limit)
  const [done, setDone] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // The server re-renders this page after submit (revalidatePath), so props may already include the new listing.
  const [usedAtStart] = useState(q0.used)
  const usedNow = Math.max(q0.used, usedAtStart + (done ? 1 : 0))

  // Search
  const [query, setQuery] = useState('')
  const [langFilter, setLangFilter] = useState<'all' | 'en' | 'jp'>('all')
  const [results, setResults] = useState<{ cards: CardOption[]; sealed: SealedOption[] } | null>(null)
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  const runSearch = (q: string, lang: 'all' | 'en' | 'jp', kind: ListingType) => {
    if (timer.current) clearTimeout(timer.current)
    if (q.trim().length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    timer.current = setTimeout(async () => {
      const mine = ++seq.current
      const res = await searchCatalogue(q, kind === 'sealed' ? 'sealed' : 'card', lang === 'all' ? undefined : lang)
      if (mine === seq.current) {
        setResults(res)
        setSearching(false)
      }
    }, 250)
  }

  const lang = (type === 'sealed' ? sealed?.lang : card?.lang) ?? 'en'
  const suggested = suggestTitle({
    listingType: type,
    name: type === 'sealed' ? sealed?.name : card?.name,
    number: card?.number,
    setName: card?.setName,
    lang,
    grader,
    grade: Number(grade),
    condition,
  })
  const effectiveTitle = titleTouched ? title : suggested
  const slots = photoSlots(type)
  const photoCount = images.filter((i) => i.kind !== 'other').length
  const hints = bannedWordHints(`${effectiveTitle} ${description}`)
  const contactHint = looksLikeContactDetails(description)
  const priceNum = parseAud(price)

  const itemReady = type === 'sealed' ? Boolean(sealed) : Boolean(card)
  const maxReachable = !itemReady ? 0 : listingId ? 4 : 2

  // ----------------------------------------------------------- validation
  function validateStep(i: number): Record<string, string> {
    const e: Record<string, string> = {}
    if (i === 0 && !itemReady) e.item = type === 'sealed' ? 'Choose the sealed product.' : 'Search for the card and choose the exact printing.'
    if (i === 1) {
      if (type === 'graded_single') {
        if (!GRADERS.includes(grader as (typeof GRADERS)[number])) e.grader = 'Choose the grading company.'
        if (!GRADE_VALUES.includes(Number(grade))) e.grade = 'Choose the grade.'
        if (cert && !/^\d{6,12}$/.test(cert)) e.cert = 'Cert numbers are 6–12 digits, no spaces.'
      }
      if (type === 'raw_single' && !condition) e.condition = 'Choose a condition.'
    }
    if (i === 2) {
      if (priceNum === null) e.price = 'Enter the price in Australian dollars, e.g. 450 or 1299.50.'
      const n = Number(qty)
      if (!Number.isInteger(n) || n < 1 || n > 999) e.qty = 'Quantity is a whole number from 1 to 999.'
      if (!locState) e.locState = 'Choose your state.'
      if (postcode && !isPostcode(postcode)) e.postcode = 'Postcodes are 4 digits.'
      if (effectiveTitle.trim().length < 3) e.title = 'Give your listing a title (at least 3 characters).'
      if (effectiveTitle.length > 120) e.title = 'Keep the title to 120 characters.'
      if (!pickup && ship.every((s) => !s.name.trim())) e.ship = 'Offer local pickup, a shipping option, or both.'
      ship.forEach((s, idx) => {
        if (s.name.trim() && parseAud(s.price) === null && !/^0(\.0{1,2})?$/.test(s.price.trim())) e[`ship${idx}`] = 'Enter a shipping price (0 for free).'
      })
      if (hints.blocked.length) e.description = `Listings for ${hints.blocked.join(', ')}s are not allowed.`
      if (description.length > 4000) e.description = 'Keep the description under 4,000 characters.'
    }
    return e
  }

  function payload() {
    return {
      listingType: type,
      cardId: type === 'sealed' ? undefined : card?.id,
      sealedProductId: type === 'sealed' ? sealed?.id : undefined,
      lang,
      grader: type === 'graded_single' ? grader : undefined,
      grade: type === 'graded_single' ? Number(grade) : undefined,
      certNumber: type === 'graded_single' && cert ? cert : undefined,
      condition: type === 'raw_single' ? condition : undefined,
      title: effectiveTitle.trim(),
      description: description.trim(),
      priceAud: priceNum ?? 0,
      qty: Number(qty),
      locationState: locState,
      postcode: postcode || undefined,
      pickup,
      shippingOptions: ship
        .filter((s) => s.name.trim())
        .map((s) => ({ name: s.name.trim().slice(0, 60), priceAud: Number(s.price.replace(/[^\d.]/g, '')) || 0 })),
    }
  }

  const goTo = (i: number) => {
    setBanner(null)
    setStep(i)
    requestAnimationFrame(() => document.getElementById('editor-top')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  const next = () => {
    const e = validateStep(step)
    setErrors(e)
    if (Object.keys(e).length) {
      setBanner({ ok: false, text: 'Check the highlighted fields.' })
      return
    }
    if (step === 2) {
      start(async () => {
        const res = await saveDraft(payload(), listingId ?? undefined)
        if (!res.ok) {
          setBanner({ ok: false, text: res.error })
          return
        }
        setListingId(res.data!.id)
        if (!titleTouched) {
          setTitle(effectiveTitle)
          setTitleTouched(true)
        }
        goTo(3)
      })
      return
    }
    goTo(step + 1)
  }

  // ---------------------------------------------------------------- photos
  async function upload(kind: string, file: File) {
    if (!listingId) return
    const bad = checkImageFile(file, 40 * 1024 * 1024)
    if (bad) return setErrors((e) => ({ ...e, [`photo-${kind}`]: bad }))
    setErrors((e) => ({ ...e, [`photo-${kind}`]: '' }))
    setUploading((u) => ({ ...u, [kind]: true }))
    try {
      const sb = supabaseBrowser()
      if (!sb) throw new Error('Uploads need the Supabase connection.')
      const img = await prepareImage(file)
      if (img.bytes > LISTING_IMAGE_MAX_BYTES) throw new Error('That photo is over 10 MB even after resizing. Try a smaller one.')
      const path = `${userId}/${listingId}/${uuid()}.${extFor(img.mime)}`
      const up = await sb.storage.from('listing-images').upload(path, img.blob, { contentType: img.mime, upsert: false, cacheControl: '31536000' })
      if (up.error) throw new Error('Upload failed. Check your connection and try again.')
      const res = await addListingImage(listingId, { path, kind, mime: img.mime, bytes: img.bytes, width: img.width, height: img.height })
      if (!res.ok) {
        await sb.storage.from('listing-images').remove([path])
        throw new Error(res.error)
      }
      const url = sb.storage.from('listing-images').getPublicUrl(path).data.publicUrl
      setImages((list) => [...list, { id: res.data!.id, kind, url, path }])
    } catch (err) {
      setErrors((e) => ({ ...e, [`photo-${kind}`]: err instanceof Error ? err.message : 'Upload failed.' }))
    } finally {
      setUploading((u) => ({ ...u, [kind]: false }))
    }
  }

  function remove(img: Img) {
    start(async () => {
      const res = await removeListingImage(img.id)
      if (!res.ok) return setBanner({ ok: false, text: res.error })
      setImages((list) => list.filter((i) => i.id !== img.id))
    })
  }

  function submit() {
    setBanner(null)
    for (const i of [0, 1, 2]) {
      const e = validateStep(i)
      if (Object.keys(e).length) {
        setErrors(e)
        goTo(i)
        setBanner({ ok: false, text: 'Check the highlighted fields.' })
        return
      }
    }
    if (photoCount < rules.minPhotos) {
      goTo(3)
      setBanner({ ok: false, text: `Add at least ${rules.minPhotos} photos: the front and the back${type === 'graded_single' ? ' of the slab' : ''}.` })
      return
    }
    start(async () => {
      const saved = await saveDraft(payload(), listingId ?? undefined)
      if (!saved.ok) return setBanner({ ok: false, text: saved.error })
      const res = await submitListing(saved.data!.id)
      if (!res.ok) {
        if (res.field === 'quota') setQuotaHit(true)
        setBanner({ ok: false, text: res.error })
        return
      }
      setDone(res.message ?? 'Submitted for review.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  const quotaText = quotaLine(usedNow, q0.limit, q0.resetsAt ? new Date(q0.resetsAt) : null, q0.timeZone)
  const aside = (
    <aside className="editor-aside" aria-label="Your listing quota">
      <div className="panel">
        <p className="eyebrow">{q0.tier === 'premium' ? '◆ Premium' : 'Free plan'}</p>
        <div className="meter mt-3" data-full={usedNow >= q0.limit} role="meter" aria-valuemin={0} aria-valuemax={q0.limit} aria-valuenow={Math.min(usedNow, q0.limit)} aria-label="Listings used this month" aria-valuetext={quotaText}>
          <span style={{ width: `${quotaPercent(usedNow, q0.limit)}%` }} />
        </div>
        <p className="quota-line" data-testid="quota-line">{quotaText}</p>
        <p className="muted mt-2 text-xs">Drafts are free. A listing counts when you submit it for review.</p>
      </div>
      {quotaHit && q0.tier === 'free' && (
        <div className="mt-4" data-testid="upgrade-prompt">
          <UpgradeInline rules={rules} />
        </div>
      )}
    </aside>
  )

  if (done) {
    return (
      <div className="editor">
        <div className="panel" role="status" aria-live="polite" data-testid="submit-success">
          <span className="success-mark" aria-hidden="true"><Check size={24} /></span>
          <h2 className="mt-4">Submitted for review</h2>
          <p className="mt-2">{done}</p>
          <p className="muted mt-2 text-sm">You can follow its status in My listings. If a moderator asks for changes, you&apos;ll get an email and it won&apos;t count against your quota again.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/account/listings/" className="btn btn-primary">Go to my listings</Link>
            <a href="/account/listings/new/" className="btn btn-secondary">List another card</a>
          </div>
        </div>
        {aside}
      </div>
    )
  }

  const err = (k: string) => errors[k] || undefined
  const inv = (k: string) => (errors[k] ? true : undefined)
  const desc = (k: string, hint?: string) => [hint, errors[k] ? `${k}-err` : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="editor" id="editor-top" style={{ scrollMarginTop: 'calc(var(--header-h) + 16px)' }}>
      <div>
        <ol className="stepper" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" onClick={() => goTo(i)} disabled={i > maxReachable || pending} aria-current={step === i ? 'step' : undefined} className={i < step ? 'done' : undefined}>
                <span className="num">{i < step ? <Check size={12} aria-hidden="true" /> : i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>

        {initial?.changeRequest && (
          <div className="notice notice-warn mb-6" role="note">
            <strong>Changes requested by a moderator:</strong> {initial.changeRequest}
          </div>
        )}
        {banner && (
          <div className={`notice ${banner.ok ? 'notice-up' : 'notice-warn'} mb-6`} role="alert" data-testid="editor-banner">
            {banner.text}{' '}
            {quotaHit && !banner.ok && <Link className="prose-link" href="/account/billing/upgrade/">Upgrade to Premium</Link>}
          </div>
        )}

        {/* ---------------- Step 1: item ---------------- */}
        {step === 0 && (
          <section aria-labelledby="s1" className="form-grid">
            <h2 id="s1">What are you selling?</h2>
            <fieldset className="fs">
              <legend>Listing type</legend>
              <div className="seg-wrap">
                <div className="seg seg-lg" role="radiogroup" aria-label="Listing type">
                  {(['graded_single', 'raw_single', 'sealed'] as ListingType[]).map((t) => (
                    <label key={t}>
                      <input type="radio" name="ltype" value={t} checked={type === t} onChange={() => { setType(t); setResults(null); if (query) runSearch(query, langFilter, t) }} />
                      <span>{LISTING_TYPE_LABEL[t]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>

            {(type === 'sealed' ? sealed : card) && (
              <div className="selected-card" data-testid="selected-item">
                <div className="min-w-0 flex-1">
                  <p className="eyebrow">Selected</p>
                  {type === 'sealed' && sealed ? (
                    <p className="mt-1 font-medium">{sealed.name} <LangChip lang={sealed.lang} /></p>
                  ) : card ? (
                    <>
                      <p className="mt-1 font-medium">{card.name} <span className="muted">#{card.number}</span> <LangChip lang={card.lang} /></p>
                      <p className="muted text-xs">{card.setName} · {card.variant} · {card.game === 'one-piece' ? 'One Piece' : 'Pokémon'}</p>
                    </>
                  ) : null}
                </div>
                <button type="button" className="icon-btn" aria-label="Clear selection" onClick={() => (type === 'sealed' ? setSealed(null) : setCard(null))}>
                  <X size={18} />
                </button>
              </div>
            )}

            <div className="field">
              <label htmlFor="q">{type === 'sealed' ? 'Search sealed products' : 'Search the card catalogue'}</label>
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-muted)' }} aria-hidden="true" />
                <input
                  id="q"
                  className="input"
                  style={{ paddingLeft: 36 }}
                  type="search"
                  autoComplete="off"
                  placeholder={type === 'sealed' ? 'e.g. 151 booster bundle' : 'e.g. Charizard 151, Luffy OP05, Umbreon Evolving Skies'}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); runSearch(e.target.value, langFilter, type) }}
                  aria-invalid={inv('item')}
                  aria-describedby={desc('item', 'q-hint')}
                  aria-controls="q-results"
                />
              </div>
              <p id="q-hint" className="hint">English and Japanese printings are different cards with different prices. Pick the one in your hand.</p>
              <FieldError id="item-err" msg={err('item')} />
            </div>
            <div className="seg" role="radiogroup" aria-label="Language">
              {(['all', 'en', 'jp'] as const).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={langFilter === l} onClick={() => { setLangFilter(l); runSearch(query, l, type) }}>
                  {l === 'all' ? 'All' : l === 'en' ? 'English (EN)' : 'Japanese (JP)'}
                </button>
              ))}
            </div>
            <div id="q-results" aria-live="polite">
              {searching && <p className="muted text-sm">Searching…</p>}
              {!searching && results && (type === 'sealed' ? results.sealed.length : results.cards.length) === 0 && (
                <p className="muted text-sm">
                  No matches. Try fewer words or the card number.{' '}
                  {type === 'sealed' && 'Sealed products are being added; '}
                  Can&apos;t find it? <Link className="prose-link" href="/contact/">Tell us</Link> and we&apos;ll add it.
                </p>
              )}
              {!searching && results && type !== 'sealed' && results.cards.length > 0 && (
                <ul className="results" aria-label="Matching cards">
                  {results.cards.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="result-btn" aria-pressed={card?.id === c.id} onClick={() => { setCard(c); setErrors({}) }} data-card-id={c.id}>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{c.name} <span className="muted">#{c.number}</span></span>
                          <span className="block text-xs muted">{c.setName} · {c.variant} · {c.game === 'one-piece' ? 'One Piece' : 'Pokémon'}</span>
                        </span>
                        <LangChip lang={c.lang} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!searching && results && type === 'sealed' && results.sealed.length > 0 && (
                <ul className="results" aria-label="Matching sealed products">
                  {results.sealed.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="result-btn" aria-pressed={sealed?.id === s.id} onClick={() => { setSealed(s); setErrors({}) }}>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{s.name}</span>
                          <span className="block text-xs muted">{s.type}{s.rrpAud ? ` · RRP A$${s.rrpAud.toFixed(2)}` : ''}</span>
                        </span>
                        <LangChip lang={s.lang} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* ---------------- Step 2: grade ---------------- */}
        {step === 1 && (
          <section aria-labelledby="s2" className="form-grid">
            <h2 id="s2">{type === 'graded_single' ? 'Grading details' : type === 'raw_single' ? 'Condition' : 'Sealed product'}</h2>
            {type === 'graded_single' && (
              <>
                <div className="form-row">
                  <div className="field">
                    <label htmlFor="grader">Grading company</label>
                    <select id="grader" className="select" value={grader} onChange={(e) => setGrader(e.target.value)} aria-invalid={inv('grader')} aria-describedby={desc('grader')}>
                      {GRADERS.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <FieldError id="grader-err" msg={err('grader')} />
                  </div>
                  <div className="field">
                    <label htmlFor="grade">Grade</label>
                    <select id="grade" className="select" value={grade} onChange={(e) => setGrade(e.target.value)} aria-invalid={inv('grade')} aria-describedby={desc('grade')}>
                      {GRADE_VALUES.map((g) => <option key={g} value={String(g)}>{g}</option>)}
                    </select>
                    <FieldError id="grade-err" msg={err('grade')} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="cert">Cert number <span className="muted">(recommended)</span></label>
                  <input id="cert" className="input" inputMode="numeric" autoComplete="off" value={cert} onChange={(e) => setCert(e.target.value.replace(/\s/g, ''))} aria-invalid={inv('cert')} aria-describedby={desc('cert', 'cert-hint')} maxLength={12} />
                  <p id="cert-hint" className="hint">
                    {grader === 'PSA' ? "We'll verify it against PSA's cert database and flag any mismatch for review." : 'Printed on the slab label. Buyers use it to check the grade.'}
                  </p>
                  <FieldError id="cert-err" msg={err('cert')} />
                </div>
              </>
            )}
            {type === 'raw_single' && (
              <div className="field">
                <label htmlFor="condition">Condition</label>
                <select id="condition" className="select" value={condition} onChange={(e) => setCondition(e.target.value)} aria-invalid={inv('condition')} aria-describedby={desc('condition', 'cond-hint')}>
                  {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <p id="cond-hint" className="hint">Be conservative: buyers can report listings that are misrepresented.</p>
                <FieldError id="condition-err" msg={err('condition')} />
              </div>
            )}
            {type === 'sealed' && <p className="muted">Nothing to add here. Only list factory-sealed product; resealed or weighed packs are banned.</p>}
          </section>
        )}

        {/* ---------------- Step 3: price & delivery ---------------- */}
        {step === 2 && (
          <section aria-labelledby="s3" className="form-grid">
            <h2 id="s3">Price &amp; delivery</h2>
            <div className="form-row">
              <div className="field">
                <label htmlFor="price">Price (A$)</label>
                <input id="price" className="input" inputMode="decimal" autoComplete="off" placeholder="e.g. 450" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={inv('price')} aria-describedby={desc('price', 'price-hint')} />
                <p id="price-hint" className="hint">Australian dollars, per item.</p>
                <FieldError id="price-err" msg={err('price')} />
              </div>
              <div className="field">
                <label htmlFor="qty">Quantity</label>
                <input id="qty" className="input" type="number" min={1} max={999} value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={inv('qty')} aria-describedby={desc('qty')} />
                <FieldError id="qty-err" msg={err('qty')} />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="state">State</label>
                <select id="state" className="select" value={locState} onChange={(e) => setLocState(e.target.value)} aria-invalid={inv('locState')} aria-describedby={desc('locState')}>
                  <option value="">Choose…</option>
                  {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <FieldError id="locState-err" msg={err('locState')} />
              </div>
              <div className="field">
                <label htmlFor="postcode">Postcode <span className="muted">(optional)</span></label>
                <input id="postcode" className="input" inputMode="numeric" maxLength={4} autoComplete="postal-code" value={postcode} onChange={(e) => setPostcode(e.target.value.replace(/\D/g, ''))} aria-invalid={inv('postcode')} aria-describedby={desc('postcode', 'pc-hint')} />
                <p id="pc-hint" className="hint">Helps local buyers find you. Only the suburb area is used, never your address.</p>
                <FieldError id="postcode-err" msg={err('postcode')} />
              </div>
            </div>
            <fieldset className="fs">
              <legend>Delivery</legend>
              <label className="check"><input type="checkbox" checked={pickup} onChange={(e) => setPickup(e.target.checked)} /> Local pickup available</label>
              <div className="mt-3 grid gap-3">
                {ship.map((s, idx) => (
                  <div key={idx} className="flex flex-wrap items-end gap-2">
                    <div className="field min-w-0 flex-1" style={{ minWidth: 180 }}>
                      <label htmlFor={`ship-name-${idx}`}>Shipping option {idx + 1}</label>
                      <input id={`ship-name-${idx}`} className="input" maxLength={60} value={s.name} onChange={(e) => setShip((l) => l.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))} />
                    </div>
                    <div className="field" style={{ width: 110 }}>
                      <label htmlFor={`ship-price-${idx}`}>Cost (A$)</label>
                      <input id={`ship-price-${idx}`} className="input" inputMode="decimal" value={s.price} onChange={(e) => setShip((l) => l.map((x, j) => (j === idx ? { ...x, price: e.target.value } : x)))} aria-invalid={inv(`ship${idx}`)} aria-describedby={desc(`ship${idx}`)} />
                    </div>
                    <button type="button" className="icon-btn" aria-label={`Remove shipping option ${idx + 1}`} onClick={() => setShip((l) => l.filter((_, j) => j !== idx))}><X size={16} /></button>
                    <FieldError id={`ship${idx}-err`} msg={err(`ship${idx}`)} />
                  </div>
                ))}
                {ship.length < 5 && (
                  <button type="button" className="link-btn justify-self-start" onClick={() => setShip((l) => [...l, { name: '', price: '' }])}>+ Add a shipping option</button>
                )}
                <FieldError id="ship-err" msg={err('ship')} />
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="title">Title</label>
              <input id="title" className="input" maxLength={120} value={effectiveTitle} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }} aria-invalid={inv('title')} aria-describedby={desc('title', 'title-hint')} />
              <p id="title-hint" className="hint">
                Suggested from the card and grade. {titleTouched && suggested && effectiveTitle !== suggested && (
                  <button type="button" className="link-btn text-xs" onClick={() => { setTitle(suggested); setTitleTouched(false) }}>Use the suggestion</button>
                )}
              </p>
              <FieldError id="title-err" msg={err('title')} />
            </div>
            <div className="field">
              <label htmlFor="description">Description</label>
              <textarea id="description" className="textarea" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={inv('description')} aria-describedby={desc('description', 'desc-hint')} placeholder="Centring, surface, any marks on the slab, how you'll pack it…" />
              <p id="desc-hint" className="hint">
                Don&apos;t include your phone number or email: buyers message you on TCGTracker. Listings for proxies, replicas or fakes are removed.
              </p>
              {hints.blocked.length > 0 && <p className="field-error">Contains a banned word ({hints.blocked.join(', ')}). Fakes and proxies can&apos;t be listed.</p>}
              {hints.flagged.length > 0 && <p className="hint" style={{ color: 'var(--warn)' }}>Mentions {hints.flagged.join(', ')}: these payment methods have no buyer protection, so moderators take a closer look.</p>}
              {contactHint && <p className="hint" style={{ color: 'var(--warn)' }}>Looks like contact details. For your safety, keep contact on-site.</p>}
              <FieldError id="description-err" msg={err('description')} />
            </div>
          </section>
        )}

        {/* ---------------- Step 4: photos ---------------- */}
        {step === 3 && (
          <section aria-labelledby="s4" className="form-grid">
            <div>
              <h2 id="s4">Photos</h2>
              <p className="muted mt-2 text-sm">
                At least {rules.minPhotos} real photos: the front and the back{type === 'graded_single' ? ' of the slab, with the label readable' : ''}. No stock images.
                JPEG, PNG or WebP; we resize them to 1600px.
              </p>
            </div>
            <div className="photo-grid" data-testid="photo-grid">
              {slots.map((slot) => {
                const img = images.find((i) => i.kind === slot.kind)
                return <PhotoSlot key={slot.kind} kind={slot.kind} label={slot.label} img={img} busy={uploading[slot.kind]} error={errors[`photo-${slot.kind}`]} onFile={(f) => upload(slot.kind, f)} onRemove={remove} required />
              })}
              {images
                .filter((i) => !slots.some((s) => s.kind === i.kind) || images.filter((x) => x.kind === i.kind)[0]?.id !== i.id)
                .map((img) => <PhotoSlot key={img.id} kind={img.kind} label={img.kind === 'other' ? 'Extra photo' : img.kind.replace('-', ' ')} img={img} onRemove={remove} />)}
              {images.length < 8 && (
                <PhotoSlot kind="other" label="Add another (optional)" busy={uploading.other} error={errors['photo-other']} onFile={(f) => upload('other', f)} onRemove={remove} />
              )}
            </div>
            <p className="text-sm" aria-live="polite">
              {photoCount >= rules.minPhotos ? <span style={{ color: 'var(--up)' }}>✓ Photos ready</span> : <span className="muted">{photoCount} of {rules.minPhotos} required photos added</span>}
            </p>
          </section>
        )}

        {/* ---------------- Step 5: review ---------------- */}
        {step === 4 && (
          <section aria-labelledby="s5" className="form-grid">
            <h2 id="s5">Review &amp; submit</h2>
            {images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {images.map((i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- member's own upload
                  <img key={i.id} src={i.url} alt={i.kind} className="thumb" style={{ width: 72 }} />
                ))}
              </div>
            )}
            <dl className="review-list">
              <dt>Title</dt><dd>{effectiveTitle}</dd>
              <dt>Item</dt>
              <dd>
                {type === 'sealed' ? sealed?.name : `${card?.name} #${card?.number} · ${card?.setName}`} <LangChip lang={lang} />
              </dd>
              <dt>Type</dt><dd>{LISTING_TYPE_LABEL[type]}{type === 'graded_single' ? ` · ${gradeText(grader, Number(grade))}` : type === 'raw_single' ? ` · ${condition}` : ''}</dd>
              {type === 'graded_single' && <><dt>Cert</dt><dd>{cert || 'Not provided'}</dd></>}
              <dt>Price</dt><dd>A${(priceNum ?? 0).toFixed(2)}{Number(qty) > 1 ? ` each · ${qty} available` : ''}</dd>
              <dt>Location</dt><dd>{locState}{postcode ? ` ${postcode}` : ''}</dd>
              <dt>Delivery</dt>
              <dd>
                {[pickup ? 'Local pickup' : null, ...ship.filter((s) => s.name.trim()).map((s) => `${s.name} (A$${(Number(s.price) || 0).toFixed(2)})`)].filter(Boolean).join(' · ') || '—'}
              </dd>
              <dt>Photos</dt><dd>{images.length}</dd>
            </dl>
            <div className="notice">
              <strong>What happens next:</strong> a moderator checks every listing, usually within a few hours. Submitting uses 1 of your {q0.limit} listings this month.
              Buyers contact you through TCGTracker messages; your email and phone stay hidden.
            </div>
          </section>
        )}

        <div className="step-footer">
          {step > 0 ? <button type="button" className="btn btn-secondary" onClick={() => goTo(step - 1)} disabled={pending}>Back</button> : <Link href="/account/listings/" className="btn btn-ghost">Cancel</Link>}
          {step < 3 && (
            <button type="button" className="btn btn-primary" onClick={next} disabled={pending}>
              {pending ? 'Saving…' : step === 2 ? 'Save draft & add photos' : 'Continue'}
            </button>
          )}
          {step === 3 && (
            <button type="button" className="btn btn-primary" onClick={() => goTo(4)} disabled={photoCount < rules.minPhotos || Object.values(uploading).some(Boolean)}>
              Review listing
            </button>
          )}
          {step === 4 && (
            <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>
              {pending ? 'Submitting…' : 'Submit for review'}
            </button>
          )}
        </div>
        {listingId && step < 4 && <p className="muted mt-3 text-xs">Draft saved. You can finish it later from My listings.</p>}
      </div>
      {aside}
    </div>
  )
}

function LangChip({ lang }: { lang: string }) {
  return (
    <span className="lang-full" data-lang={lang} title={lang === 'jp' ? 'Japanese printing' : 'English printing'}>
      {lang === 'jp' ? 'JP · Japanese' : 'EN · English'}
    </span>
  )
}

function UpgradeInline({ rules }: { rules: EditorProps['rules'] }) {
  return (
    <div className="upgrade-card" role="region" aria-label="Upgrade to Premium">
      <p className="eyebrow"><span className="holo-text">◆ Premium</span></p>
      <p className="mt-2 text-sm">You&apos;ve used this month&apos;s {rules.freeQuota} free listings.</p>
      <p className="muted mt-2 text-xs">
        Premium: up to {rules.premiumQuota} listings a month plus instant drop alerts, {rules.premiumPrice}/month incl. GST. Free listings reset on the 1st.
        You can keep saving drafts in the meantime.
      </p>
      <Link href="/account/billing/upgrade/" className="btn btn-holo btn-sm mt-3">Upgrade to Premium</Link>
    </div>
  )
}

function PhotoSlot({ kind, label, img, busy, error, onFile, onRemove, required }: {
  kind: string; label: string; img?: Img; busy?: boolean; error?: string; onFile?: (f: File) => void; onRemove: (i: Img) => void; required?: boolean
}) {
  const id = `photo-${kind}-${useId().replace(/:/g, '')}`
  if (img) {
    return (
      <div className="photo-slot" data-filled="true" data-kind={kind}>
        {/* eslint-disable-next-line @next/next/no-img-element -- member's own upload */}
        <img src={img.url} alt={`${label} photo`} />
        <div className="cap">
          <span>{label}</span>
          <button type="button" className="link-btn text-xs" onClick={() => onRemove(img)} aria-label={`Remove ${label} photo`}>Remove</button>
        </div>
      </div>
    )
  }
  return (
    <div className="photo-slot" data-kind={kind}>
      <ImagePlus size={22} strokeWidth={1.25} aria-hidden="true" />
      <label htmlFor={id} className="pick">{busy ? 'Uploading…' : label}</label>
      {required && <span className="text-2xs">Required</span>}
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        data-testid={`upload-${kind}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f && onFile) onFile(f)
        }}
      />
      {error && <p id={`${id}-err`} className="field-error" role="alert">{error}</p>}
    </div>
  )
}
