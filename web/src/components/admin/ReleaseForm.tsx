'use client'
import { startTransition, useActionState, useState } from 'react'
import { saveRelease } from '@/lib/actions/releases'
import type { ActionResult } from '@/lib/actions/result'
import { CONFIDENCES, DATE_PRECISIONS, RELEASE_KINDS } from '@/lib/admin/releases'
import { slugify } from '@/lib/seo/urls'
import { ResultNote } from './ActionButton'

export interface ReleaseFormValues {
  id: string | null
  game: string
  lang: string
  title: string
  slug: string
  kind: string
  releaseDate: string
  datePrecision: string
  confidence: string
  setId: string
  productLines: string
  retailerSlugs: string[]
  summary: string
  bodyMd: string
  sourceName: string
  sourceUrl: string
  published: boolean
}

/** Create / edit one release_events row. The slug follows the title until edited by hand. */
export function ReleaseForm({ initial, sets, retailers }: {
  initial: ReleaseFormValues
  sets: { id: string; label: string; game: string }[]
  retailers: { slug: string; name: string }[]
}) {
  const [state, run, pending] = useActionState(saveRelease, null as ActionResult | null)
  const [title, setTitle] = useState(initial.title)
  const [slug, setSlug] = useState(initial.slug)
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.id))
  const [game, setGame] = useState(initial.game)
  const f = (k: string) => `rel-${initial.id ?? 'new'}-${k}`
  const errFor = (k: string) => (state && !state.ok && state.field === k ? <p className="field-error">{state.error}</p> : null)

  return (
    <form
      className="admin-form"
      action={run}
      aria-label={initial.id ? `Edit ${initial.title}` : 'New release'}
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        startTransition(() => run(fd))
      }}
    >
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="admin-grid-3">
        <div className="field">
          <label htmlFor={f('title')}>Title</label>
          <input id={f('title')} name="title" className="input" required minLength={3} maxLength={120} value={title} onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)) }} />
          {errFor('title')}
        </div>
        <div className="field">
          <label htmlFor={f('slug')}>Slug</label>
          <input id={f('slug')} name="slug" className="input" required maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} />
          {errFor('slug')}
        </div>
        <div className="field">
          <label htmlFor={f('kind')}>Kind</label>
          <select id={f('kind')} name="kind" className="select" defaultValue={initial.kind}>
            {RELEASE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={f('game')}>Game</label>
          <select id={f('game')} name="game" className="select" value={game} onChange={(e) => setGame(e.target.value)}>
            <option value="pokemon">Pokémon</option>
            <option value="one-piece">One Piece</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={f('lang')}>Language</label>
          <select id={f('lang')} name="lang" className="select" defaultValue={initial.lang}>
            <option value="en">English (EN)</option>
            <option value="jp">Japanese (JP)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={f('set')}>Set <span className="muted">(optional)</span></label>
          <select id={f('set')} name="set_id" className="select" defaultValue={initial.setId}>
            <option value="">None</option>
            {sets.filter((s) => s.game === game || s.id === initial.setId).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={f('date')}>Release date</label>
          <input id={f('date')} name="release_date" type="date" className="input" defaultValue={initial.releaseDate} />
          {errFor('releaseDate')}
        </div>
        <div className="field">
          <label htmlFor={f('prec')}>Date precision</label>
          <select id={f('prec')} name="date_precision" className="select" defaultValue={initial.datePrecision}>
            {DATE_PRECISIONS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={f('conf')}>Confidence</label>
          <select id={f('conf')} name="confidence" className="select" defaultValue={initial.confidence}>
            {CONFIDENCES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={f('products')}>Products <span className="muted">(one per line: name | type | RRP)</span></label>
        <textarea id={f('products')} name="products" className="textarea" rows={5} defaultValue={initial.productLines} placeholder={'Prismatic Evolutions Elite Trainer Box | etb | 89.95\nPrismatic Evolutions Booster Bundle | booster-bundle | 54.95'} />
        {errFor('products')}
      </div>
      <fieldset className="fs">
        <legend>Retailers <span className="muted">(where it will be sold, optional)</span></legend>
        <div className="flex flex-wrap gap-4">
          {retailers.map((r) => (
            <label key={r.slug} className="check">
              <input type="checkbox" name="retailer" value={r.slug} defaultChecked={initial.retailerSlugs.includes(r.slug)} /> {r.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={f('summary')}>Summary <span className="muted">(≤300 characters, shown in lists)</span></label>
        <textarea id={f('summary')} name="summary" className="textarea" rows={2} maxLength={300} defaultValue={initial.summary} style={{ minHeight: 64 }} />
      </div>
      <div className="field">
        <label htmlFor={f('body')}>Body <span className="muted">(Markdown)</span></label>
        <textarea id={f('body')} name="body_md" className="textarea" rows={8} maxLength={20000} defaultValue={initial.bodyMd} />
      </div>
      <div className="admin-grid-3">
        <div className="field">
          <label htmlFor={f('srcn')}>Source name</label>
          <input id={f('srcn')} name="source_name" className="input" maxLength={120} defaultValue={initial.sourceName} placeholder="e.g. Pokémon TCG press release" />
        </div>
        <div className="field">
          <label htmlFor={f('srcu')}>Source link</label>
          <input id={f('srcu')} name="source_url" type="url" className="input" maxLength={500} defaultValue={initial.sourceUrl} placeholder="https://…" />
          {errFor('sourceUrl')}
        </div>
        <label className="check" style={{ alignSelf: 'end', minHeight: 40 }}>
          <input type="checkbox" name="published" defaultChecked={initial.published} /> Published
        </label>
      </div>
      <div className="admin-form-actions">
        <button type="submit" className="btn btn-sm btn-primary" disabled={pending}>{pending ? 'Saving…' : initial.id ? 'Save changes' : 'Create release'}</button>
        <ResultNote res={state} />
      </div>
    </form>
  )
}
