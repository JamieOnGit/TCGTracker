'use client'
import { useState, useTransition } from 'react'
import { resolveMapping, type CardSearchHit } from '@/lib/actions/admin'
import type { ActionResult } from '@/lib/actions/result'
import { ResultNote } from './ActionButton'
import { CardPicker } from './CardPicker'

export function MappingActions({ id, game, lang, hasSuggestion }: { id: number; game: 'pokemon' | 'one-piece' | null; lang: 'en' | 'jp' | null; hasSuggestion: boolean }) {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActionResult | null>(null)
  const [picked, setPicked] = useState<CardSearchHit | null>(null)
  const run = (fn: () => Promise<ActionResult>) => start(async () => setRes(await fn()))
  return (
    <div className="mapping-actions">
      <div className="flex flex-wrap items-center gap-2">
        {hasSuggestion && (
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => resolveMapping(id, 'approve'))}>
            Approve suggestion
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-sm admin-danger" disabled={pending} onClick={() => run(() => resolveMapping(id, 'reject'))}>
          Reject
        </button>
        <ResultNote res={res} />
      </div>
      {game && lang ? (
        <details className="mt-2">
          <summary className="btn btn-ghost">Pick another card</summary>
          <div className="queue-panel">
            <CardPicker
              game={game}
              lang={lang}
              busy={pending}
              pickLabel="Map to this card"
              onPick={(c) => {
                setPicked(c)
                run(() => resolveMapping(id, 'pick', c.id))
              }}
            />
            {picked && <p className="muted mt-2 text-xs">Picked {picked.name} #{picked.number} ({picked.lang.toUpperCase()}).</p>}
          </div>
        </details>
      ) : (
        <p className="muted mt-2 text-xs">Game or language unknown, so a card can’t be picked safely. Reject it and fix the source record.</p>
      )}
    </div>
  )
}
