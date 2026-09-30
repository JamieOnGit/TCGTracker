'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { DealRow } from '@/lib/data/types'
import { DEAL_SELECT, isLive, toDeal } from '@/lib/domain/deals'
import { loadSupabaseBrowser, supabaseAvailable } from '@/lib/supabase/browser-lazy'
import { DealCard } from './DealCard'

/**
 * Deals the moment they're found. RLS returns deals younger than the public
 * delay only to Premium members and staff, so this is safe for everyone:
 * others see the upsell. Supabase loads on demand (not in first load).
 */
export function LiveDeals() {
  const [state, setState] = useState<{ status: 'loading' | 'anon' | 'free' | 'premium'; rows: DealRow[] }>(() => ({ status: supabaseAvailable() ? 'loading' : 'anon', rows: [] }))
  useEffect(() => {
    if (!supabaseAvailable()) return
    let active = true
    let premium = false
    const load = async () => {
      if (premium && document.visibilityState === 'hidden') return
      const sb = await loadSupabaseBrowser()
      if (!sb || !active) return
      if (!premium) {
        const { data: auth } = await sb.auth.getUser()
        if (!auth.user) return active && setState({ status: 'anon', rows: [] })
        const { data: isPremium } = await sb.rpc('is_premium', { p_user: auth.user.id })
        if (!isPremium) return active && setState({ status: 'free', rows: [] })
        premium = true
      }
      const { data } = await sb.from('ebay_deals').select(DEAL_SELECT).is('gone_at', null).order('found_at', { ascending: false }).limit(60)
      if (active) setState({ status: 'premium', rows: (data ?? []).map(toDeal).filter((d) => isLive(d)) })
    }
    load()
    const t = setInterval(load, 60_000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [])

  return (
    <section aria-labelledby="live-deals-h" className="notice" style={{ borderLeftColor: 'var(--accent)', background: 'var(--accent-soft)', padding: 24 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="live-deals-h" className="text-xl">Live deals <span className="badge badge-premium ml-2">◆ Premium</span></h2>
        {state.status === 'premium' && <span className="muted text-xs">Updates every minute</span>}
      </div>
      {state.status === 'loading' && <p className="muted mt-3 text-sm">Loading…</p>}
      {(state.status === 'anon' || state.status === 'free') && (
        <div className="mt-3 text-sm">
          <p>
            Premium members see deals the moment we find them — the best ones are usually gone within hours. Everyone else sees them here 24 hours later.
            Add cards to your wishlist and we&apos;ll alert you when one turns up under value.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/premium/" className="btn btn-holo btn-sm">See deals instantly · A$12.99/mo</Link>
            {state.status === 'anon' ? (
              <Link href="/login/?next=/deals/" className="btn btn-secondary btn-sm">Sign in</Link>
            ) : (
              <Link href="/account/alerts/" className="btn btn-secondary btn-sm">Your wishlist</Link>
            )}
          </div>
        </div>
      )}
      {state.status === 'premium' &&
        (state.rows.length === 0 ? (
          <p className="muted mt-3 text-sm">No live deals right now. We check eBay Australia through the day; your wishlist alerts are on.</p>
        ) : (
          <div className="mt-2">{state.rows.map((d) => <DealCard key={d.id} deal={d} live />)}</div>
        ))}
    </section>
  )
}
