'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { DROP_SELECT, toDrop } from '@/lib/data/drops'
import type { DropRow } from '@/lib/data/types'
import { accountDropAlertsPath, accountSightingsPath } from '@/lib/seo/urls'
import { loadSupabaseBrowser, supabaseAvailable } from '@/lib/supabase/browser-lazy'
import { DropFeed } from './DropFeed'

/**
 * The instant feed: retailer monitors and confirmed member sightings. RLS
 * returns events younger than the public delay only to Premium members, so
 * this panel is safe to render for everyone: Free members simply see the
 * upgrade prompt. Supabase is loaded on demand to keep it out of first load.
 */
export function LiveDrops() {
  const [state, setState] = useState<{ status: 'loading' | 'anon' | 'free' | 'premium'; rows: DropRow[] }>(() => ({ status: supabaseAvailable() ? 'loading' : 'anon', rows: [] }))
  useEffect(() => {
    if (!supabaseAvailable()) return
    let active = true
    let stop = () => {}
    ;(async () => {
      const sb = await loadSupabaseBrowser()
      if (!sb || !active) return
      // Only Premium members get a feed (and a Realtime connection): visitors
      // and Free members see the upgrade prompt and open nothing else.
      const { data: auth } = await sb.auth.getUser()
      if (!auth.user) return active && setState({ status: 'anon', rows: [] })
      const { data: isPremium } = await sb.rpc('is_premium', { p_user: auth.user.id })
      if (!isPremium) return active && setState({ status: 'free', rows: [] })
      const load = async (force = false) => {
        // Don't poll a background tab; the next visible tick catches up.
        if (!force && document.visibilityState === 'hidden') return
        const since = new Date(Date.now() - 86_400_000).toISOString()
        const { data } = await sb.from('drop_events').select(DROP_SELECT).gte('occurred_at', since).order('occurred_at', { ascending: false }).limit(50)
        if (active) setState({ status: 'premium', rows: (data ?? []).map(toDrop) })
      }
      await load(true)
      if (!active) return
      const t = setInterval(load, 30_000) // fallback; Realtime below is the instant path
      // Realtime checks RLS with the member's own token: fresh events reach Premium members only.
      const { data: session } = await sb.auth.getSession()
      if (session.session) sb.realtime.setAuth(session.session.access_token)
      const channel = sb
        .channel('live-drops')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'drop_events' }, () => load())
        .subscribe()
      stop = () => {
        clearInterval(t)
        sb.removeChannel(channel)
      }
      if (!active) stop()
    })()
    return () => {
      active = false
      stop()
    }
  }, [])

  return (
    <section aria-labelledby="live-h" className="notice" style={{ borderLeftColor: 'var(--accent)', background: 'var(--accent-soft)', padding: 24 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="live-h" className="text-xl">Live feed <span className="badge badge-premium ml-2">◆ Premium</span></h2>
        {state.status === 'premium' && <span className="muted text-xs">Live · last 24 hours</span>}
      </div>
      {state.status === 'loading' && <p className="muted mt-3 text-sm">Loading…</p>}
      {(state.status === 'anon' || state.status === 'free') && (
        <div className="mt-3 text-sm">
          <p>Premium members see restocks, pre-orders and member in-store sightings the moment they happen, by push, email, Discord and here. Everyone else gets them 5 minutes later.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/premium/" className="btn btn-holo btn-sm">Get instant alerts · A$12.99/mo</Link>
            {state.status === 'anon' && <Link href="/login/?next=/drops/" className="btn btn-secondary btn-sm">Sign in</Link>}
          </div>
        </div>
      )}
      {state.status === 'premium' && (
        <>
          <DropFeed rows={state.rows} compact empty="Nothing in the last 24 hours. Your alerts are on." />
          <p className="mt-4 flex flex-wrap gap-4 text-sm">
            <Link href={accountDropAlertsPath()} className="prose-link">Alert settings</Link>
            <Link href={accountSightingsPath()} className="prose-link">Sightings</Link>
          </p>
        </>
      )}
    </section>
  )
}
