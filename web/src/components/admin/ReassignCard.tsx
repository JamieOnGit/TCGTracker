'use client'
import { useState, useTransition } from 'react'
import { reassignListingCard } from '@/lib/actions/admin'
import type { ActionResult } from '@/lib/actions/result'
import { ResultNote } from './ActionButton'
import { CardPicker } from './CardPicker'

export function ReassignCard({ id, game, lang }: { id: number; game: 'pokemon' | 'one-piece'; lang: 'en' | 'jp' }) {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActionResult | null>(null)
  return (
    <details className="reassign">
      <summary className="btn btn-ghost">Reassign card</summary>
      <div className="queue-panel">
        <CardPicker game={game} lang={lang} busy={pending} pickLabel="Move listing here" onPick={(c) => start(async () => setRes(await reassignListingCard(id, c.id)))} />
        <ResultNote res={res} />
      </div>
    </details>
  )
}
