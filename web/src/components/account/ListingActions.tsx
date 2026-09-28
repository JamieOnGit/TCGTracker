'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { renewListing, setListingStatus, submitListing } from '@/lib/actions/listings'
import type { ListingAction } from '@/lib/account/format'

const CONFIRM: Partial<Record<ListingAction, string>> = {
  withdraw: 'Withdraw this listing? It comes down straight away. If it was already submitted, it still counts towards this month’s quota.',
  mark_sold: 'Mark this listing as sold? It stays visible as a sold price for 90 days.',
}

export function ListingActions({ id, actions, viewHref, title }: { id: number; actions: ListingAction[]; viewHref: string; title: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string; quota?: boolean } | null>(null)

  const run = (a: ListingAction) => {
    const confirmText = CONFIRM[a]
    if (confirmText && !window.confirm(confirmText)) return
    start(async () => {
      const res =
        a === 'submit' ? await submitListing(id)
        : a === 'mark_sold' ? await setListingStatus(id, 'sold')
        : a === 'withdraw' ? await setListingStatus(id, 'removed')
        : a === 'renew' ? await renewListing(id)
        : null
      if (!res) return
      setMsg(res.ok ? { ok: true, text: res.message ?? 'Done.' } : { ok: false, text: res.error, quota: res.field === 'quota' })
      router.refresh()
    })
  }

  return (
    <div>
      <div className="row-actions" aria-label={`Actions for ${title}`} role="group">
        {actions.includes('edit') && <Link href={`/account/listings/${id}/edit/`} className="btn btn-secondary btn-sm">Edit</Link>}
        {actions.includes('submit') && <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run('submit')}>Submit</button>}
        {actions.includes('view') && <Link href={viewHref} className="btn btn-secondary btn-sm">View</Link>}
        {actions.includes('mark_sold') && <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => run('mark_sold')}>Mark sold</button>}
        {actions.includes('renew') && <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => run('renew')}>Renew</button>}
        {actions.includes('withdraw') && <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => run('withdraw')}>Withdraw</button>}
      </div>
      {msg && (
        <p className="form-status mt-2 text-xs" data-ok={msg.ok} role="status">
          {msg.text} {msg.quota && <Link className="prose-link" href="/account/billing/upgrade/">Upgrade to Premium</Link>}
        </p>
      )}
    </div>
  )
}
