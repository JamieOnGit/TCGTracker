'use client'
import Link from 'next/link'
import { useId, useState, useTransition } from 'react'
import { approveListings, rejectListing, requestChanges } from '@/lib/actions/admin'
import type { ActionResult } from '@/lib/actions/result'
import { fmtAud, fmtDate, gradeLabel } from '@/components/Format'
import { fmtAgo, pctVsFloor, priceLooksOff } from '@/lib/admin/format'
import type { QueueListing } from '@/lib/admin/data'
import { ResultNote } from './ActionButton'
import { LangTag } from './bits'

export const REJECT_TEMPLATES = [
  'Photos unclear',
  'Front/back photos missing',
  'Suspected fake/proxy',
  'Wrong card selected',
  'Price looks like a typo',
]

export type QueueItem = QueueListing & { imageUrls: { url: string; kind: string }[] }

export function ListingQueue({ items }: { items: QueueItem[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActionResult | null>(null)
  const all = items.length > 0 && selected.size === items.length
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <div>
      <div className="bulk-bar" role="region" aria-label="Bulk actions">
        <label className="check">
          <input type="checkbox" checked={all} onChange={() => setSelected(all ? new Set() : new Set(items.map((i) => i.id)))} />
          Select all ({items.length})
        </label>
        <span className="muted text-sm" aria-live="polite">{selected.size} selected</span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!selected.size || pending}
          onClick={() =>
            start(async () => {
              const r = await approveListings([...selected])
              setRes(r)
              if (r.ok) setSelected(new Set())
            })
          }
        >
          {pending ? 'Approving…' : `Approve selected${selected.size ? ` (${selected.size})` : ''}`}
        </button>
        <ResultNote res={res} />
      </div>
      <ol className="queue">
        {items.map((l) => (
          <QueueCard key={l.id} l={l} checked={selected.has(l.id)} onToggle={() => toggle(l.id)} />
        ))}
      </ol>
    </div>
  )
}

function QueueCard({ l, checked, onToggle }: { l: QueueItem; checked: boolean; onToggle: () => void }) {
  const pct = pctVsFloor(l.price_aud, l.floor)
  const off = priceLooksOff(pct)
  const blockFlags = l.flags.filter((f) => f.severity === 'block')
  const warnFlags = l.flags.filter((f) => f.severity !== 'block')
  return (
    <li className="queue-item" data-listing-id={l.id} aria-labelledby={`q-${l.id}`}>
      <div className="queue-head">
        <label className="check">
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select listing ${l.id}`} />
        </label>
        <div className="min-w-0 flex-1">
          <h3 id={`q-${l.id}`} className="queue-title">{l.title}</h3>
          <p className="muted text-xs">#{l.id} · submitted {fmtAgo(l.submitted_at ?? l.created_at)} · {l.location_state}</p>
        </div>
        <div className="queue-price">
          <span className="num text-base">{fmtAud(l.price_aud)}</span>
          <span className={`text-xs ${off ? 'admin-warn-text' : 'muted'}`}>
            {pct === null ? 'no floor yet' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}% vs floor ${fmtAud(l.floor)}`}
            {off && ' · check'}
          </span>
        </div>
      </div>

      <div className="queue-body">
        <div className="photo-strip" aria-label="Photos">
          {l.imageUrls.length === 0 && <p className="muted text-sm">No photos.</p>}
          {l.imageUrls.map((img, i) => (
            <a key={img.url} href={img.url} target="_blank" rel="noopener noreferrer" className="photo">
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase storage URLs, sizes unknown */}
              <img src={img.url} alt={`Photo ${i + 1}: ${img.kind}`} loading="lazy" />
              <span className="photo-kind">{img.kind}</span>
            </a>
          ))}
        </div>

        <dl className="facts">
          <div>
            <dt>Card</dt>
            <dd>
              {l.card ? (
                <>
                  {l.card.name} <span className="muted">#{l.card.number}{l.card.variant !== 'standard' ? ` · ${l.card.variant}` : ''} · {l.card.set?.name}</span>
                </>
              ) : (
                l.sealed ? `${l.sealed.name} (sealed)` : '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd><LangTag lang={l.lang} /></dd>
          </div>
          <div>
            <dt>Grade</dt>
            <dd>{l.listing_type === 'graded_single' ? <span className="badge badge-grade">{gradeLabel(l.grade_key)}</span> : l.listing_type === 'raw_single' ? `Raw · ${l.condition ?? ''}` : 'Sealed'}</dd>
          </div>
          {l.listing_type === 'graded_single' && (
            <div>
              <dt>Cert</dt>
              <dd>
                <span className="num">{l.cert_number ?? 'none'}</span>{' '}
                {l.cert_mismatch ? <span className="badge badge-warn">Cert mismatch</span> : l.cert_verified ? <span className="badge badge-live">Verified</span> : <span className="badge badge-lang">Unverified</span>}
              </dd>
            </div>
          )}
          <div>
            <dt>Seller</dt>
            <dd>
              <Link className="prose-link" href={`/admin/users/${l.seller_id}/`}>@{l.seller.username}</Link>{' '}
              <span className="muted text-xs">
                joined {fmtDate(l.seller.created_at)} · {l.seller.listings} listing{l.seller.listings === 1 ? '' : 's'} · {l.seller.rejected} rejected ·{' '}
                <span className={l.seller.reports ? 'admin-warn-text' : undefined}>{l.seller.reports} report{l.seller.reports === 1 ? '' : 's'}</span>
              </span>
            </dd>
          </div>
          {(blockFlags.length > 0 || warnFlags.length > 0) && (
            <div>
              <dt>Flags</dt>
              <dd className="flex flex-wrap gap-1">
                {[...blockFlags, ...warnFlags].map((f) => (
                  <span key={f.word} className="badge badge-warn" title={f.severity === 'block' ? 'Blocked word' : 'Flagged word'}>“{f.word}”</span>
                ))}
              </dd>
            </div>
          )}
        </dl>
        {l.description && (
          <details className="queue-desc">
            <summary>Description</summary>
            <p>{l.description}</p>
          </details>
        )}
      </div>

      <QueueActions id={l.id} />
    </li>
  )
}

function QueueActions({ id }: { id: number }) {
  const uid = useId()
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActionResult | null>(null)
  const [template, setTemplate] = useState(REJECT_TEMPLATES[0] ?? '')
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState('')
  const run = (fn: () => Promise<ActionResult>) => start(async () => setRes(await fn()))
  return (
    <div className="queue-actions">
      <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => approveListings([id]))}>
        Approve
      </button>
      <details>
        <summary className="btn btn-secondary btn-sm">Reject…</summary>
        <div className="queue-panel">
          <div className="field">
            <label htmlFor={`${uid}-t`}>Reason</label>
            <select id={`${uid}-t`} className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {REJECT_TEMPLATES.map((t) => <option key={t}>{t}</option>)}
              <option value="">Custom reason only</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-c`}>Extra detail for the seller (optional)</label>
            <textarea id={`${uid}-c`} className="textarea" rows={2} value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={400} />
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm admin-danger"
            disabled={pending}
            onClick={() => run(() => rejectListing(id, [template, custom.trim()].filter(Boolean).join('. ')))}
          >
            Reject listing
          </button>
        </div>
      </details>
      <details>
        <summary className="btn btn-secondary btn-sm">Request changes…</summary>
        <div className="queue-panel">
          <div className="field">
            <label htmlFor={`${uid}-n`}>What should the seller change?</label>
            <textarea id={`${uid}-n`} className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => run(() => requestChanges(id, note))}>
            Send back to seller
          </button>
        </div>
      </details>
      <ResultNote res={res} />
    </div>
  )
}
