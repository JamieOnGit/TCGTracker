'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { voteSighting } from '@/lib/actions/sightings'
import type { ActionResult } from '@/lib/actions/result'
import { VOTE_LABEL, type Vote } from '@/lib/account/sightings'

/** Confirm / Sold out / Looks fake buttons on one sighting. */
export function SightingVotes({ sightingId, product, votes, voted }: { sightingId: number; product: string; votes: Vote[]; voted: Vote[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActionResult | null>(null)
  const [done, setDone] = useState<Vote[]>(voted)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {votes.map((v) => {
        const already = done.includes(v)
        return (
          <button
            key={v}
            type="button"
            className={`btn btn-sm ${v === 'confirm' ? 'btn-primary' : 'btn-secondary'}`}
            disabled={pending || already}
            aria-label={`${VOTE_LABEL[v]}: ${product}`}
            aria-pressed={already}
            onClick={() => {
              if (v === 'fake' && !window.confirm('Flag this report as fake or wrong? A moderator will check it.')) return
              start(async () => {
                const r = await voteSighting(sightingId, v)
                setRes(r)
                if (r.ok) {
                  setDone((d) => [...d, v])
                  router.refresh()
                }
              })
            }}
          >
            {already ? `${VOTE_LABEL[v]} ✓` : VOTE_LABEL[v]}
          </button>
        )
      })}
      {res && (
        <span role={res.ok ? 'status' : 'alert'} className={res.ok ? 'text-xs muted' : 'field-error'}>
          {res.ok ? res.message : res.error}
        </span>
      )}
    </div>
  )
}
