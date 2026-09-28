'use client'
import { useEffect, useId, useState, useTransition } from 'react'
import { searchCards, type CardSearchHit } from '@/lib/actions/admin'

const GAME_LABEL: Record<string, string> = { pokemon: 'Pokémon', 'one-piece': 'One Piece' }
export const LANG_LABEL: Record<string, string> = { en: 'English (EN)', jp: 'Japanese (JP)' }

/**
 * Catalogue search locked to ONE game and language, so a JP record can never
 * be pointed at an EN card (the database refuses it too).
 */
export function CardPicker({
  game,
  lang,
  onPick,
  pickLabel = 'Use this card',
  busy = false,
}: {
  game: 'pokemon' | 'one-piece'
  lang: 'en' | 'jp'
  onPick: (card: CardSearchHit) => void
  pickLabel?: string
  busy?: boolean
}) {
  const id = useId()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<CardSearchHit[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return
    const t = setTimeout(() => {
      start(async () => {
        const r = await searchCards({ q: term, game, lang })
        if (r.ok) {
          setHits(r.data ?? [])
          setErr(null)
        } else setErr(r.error)
      })
    }, 250)
    return () => clearTimeout(t)
  }, [q, game, lang])

  return (
    <div className="card-picker">
      <div className="field">
        <label htmlFor={id}>
          Search {GAME_LABEL[game]} cards · <strong className={`lang-flag lang-${lang}`}>{LANG_LABEL[lang]} only</strong>
        </label>
        <input id={id} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or number, e.g. Charizard or 199" autoComplete="off" />
      </div>
      {err && <p className="field-error" role="alert">{err}</p>}
      <p className="sr-only" role="status">{pending ? 'Searching' : q.trim().length >= 2 ? `${hits.length} cards found` : ''}</p>
      {q.trim().length >= 2 && (
        <ul className="picker-list" aria-label="Matching cards">
          {hits.length === 0 && !pending && <li className="muted text-sm">No {LANG_LABEL[lang]} cards match.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <span className="min-w-0">
                <span className="font-medium">{h.name}</span>{' '}
                <span className="muted text-xs">#{h.number}{h.variant !== 'standard' ? ` · ${h.variant}` : ''} · {h.setName} ({h.setCode})</span>{' '}
                <span className={`badge badge-lang lang-${h.lang}`}>{h.lang.toUpperCase()}</span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onPick(h)}>
                {pickLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
