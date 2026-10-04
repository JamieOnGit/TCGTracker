'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { accountDropAlertsPath } from '@/lib/seo/urls'
import { loadSupabaseBrowser, supabaseAvailable } from '@/lib/supabase/browser-lazy'

/**
 * Premium members' drops pages are the live feed itself: the table below is
 * read with the member's session (instant events included) and this keeps it
 * live. A new drop re-renders the page in place (filters, sort and page kept);
 * a 30-second refresh covers a dropped Realtime connection.
 */
export function LiveRefresh() {
  const router = useRouter()
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!supabaseAvailable()) return
    let active = true
    let stop = () => {}
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current)
      // A burst of drops (a restock across many products) refreshes once.
      timer.current = setTimeout(() => {
        if (!active) return
        router.refresh()
        setLastUpdate(new Date())
      }, 800)
    }
    const poll = setInterval(() => document.visibilityState === 'visible' && refresh(), 30_000)
    ;(async () => {
      const sb = await loadSupabaseBrowser()
      if (!sb || !active) return
      const { data } = await sb.auth.getSession()
      if (!data.session || !active) return
      // Realtime applies RLS with the member's own token: fresh events reach Premium only.
      sb.realtime.setAuth(data.session.access_token)
      const channel = sb
        .channel('drops-live-table')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'drop_events' }, refresh)
        .subscribe()
      stop = () => sb.removeChannel(channel)
      if (!active) stop()
    })()
    return () => {
      active = false
      clearInterval(poll)
      if (timer.current) clearTimeout(timer.current)
      stop()
    }
  }, [router])

  return (
    <div className="notice mt-6 flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="drops-live" style={{ borderLeftColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
      <p className="flex items-center gap-2">
        <span className="badge badge-premium">◆ Premium</span>
        <span>
          <strong>Live.</strong> Every restock, pre-order and confirmed sighting appears here the moment we see it.
          {lastUpdate && <span className="muted"> Updated {lastUpdate.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}.</span>}
        </span>
      </p>
      <Link href={accountDropAlertsPath()} className="prose-link">Alert settings</Link>
    </div>
  )
}
