'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSupabaseBrowser, supabaseAvailable } from '@/lib/supabase/browser-lazy'

type Session = { sb: SupabaseClient; userId: string; ids: Set<string> }

// One session + watch lookup per page, shared by every button on it (a feed
// can show dozens). product_watches is owner-RLS: the select returns only the
// member's own rows.
let session: Promise<Session | null> | null = null
function loadSession(): Promise<Session | null> {
  session ??= (async () => {
    const sb = await loadSupabaseBrowser()
    if (!sb) return null
    const { data: auth } = await sb.auth.getUser()
    if (!auth.user) return null
    const { data } = await sb.from('product_watches').select('sealed_product_id')
    return { sb, userId: auth.user.id, ids: new Set((data ?? []).map((r: { sealed_product_id: string }) => r.sealed_product_id)) }
  })()
  return session
}

type State = { status: 'loading' | 'anon' | 'off' | 'on' | 'saving'; error?: string }

/**
 * "Notify me" for one sealed product: alerts at any store, whatever the
 * member's other filters (tier timing still applies). Server-rendered as a
 * sign-in link (what signed-out visitors and crawlers see); with a session it
 * becomes a toggle over the member's own product_watches row.
 */
export function NotifyButton({ productId, productName, nextPath, watchers, size = 'sm' }: { productId: string; productName: string; nextPath: string; watchers?: number; size?: 'sm' | 'md' }) {
  const [state, setState] = useState<State>(() => ({ status: supabaseAvailable() ? 'loading' : 'anon' }))
  const [ctx, setCtx] = useState<Session | null>(null)
  const [count, setCount] = useState(watchers)

  useEffect(() => {
    if (!supabaseAvailable()) return
    let active = true
    loadSession().then((s) => {
      if (!active) return
      if (!s) return setState({ status: 'anon' })
      setCtx(s)
      setState({ status: s.ids.has(productId) ? 'on' : 'off' })
    })
    return () => {
      active = false
    }
  }, [productId])

  async function toggle() {
    if (!ctx) return
    const wasOn = state.status === 'on'
    setState({ status: 'saving' })
    const { error } = wasOn
      ? await ctx.sb.from('product_watches').delete().eq('sealed_product_id', productId).eq('user_id', ctx.userId)
      : await ctx.sb.from('product_watches').insert({ user_id: ctx.userId, sealed_product_id: productId })
    if (error) return setState({ status: wasOn ? 'on' : 'off', error: 'Could not save. Please try again.' })
    if (wasOn) ctx.ids.delete(productId)
    else ctx.ids.add(productId)
    setCount((c) => (c === undefined ? c : Math.max(0, c + (wasOn ? -1 : 1))))
    setState({ status: wasOn ? 'off' : 'on' })
  }

  const cls = `btn ${size === 'sm' ? 'btn-sm ' : ''}`
  const watching = count !== undefined && count > 0 ? <span className="muted text-xs" data-watchers={count}>{count} {count === 1 ? 'collector' : 'collectors'} watching</span> : null
  if (state.status === 'anon' || state.status === 'loading') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={`/login/?next=${encodeURIComponent(nextPath)}`} className={`${cls}btn-secondary`} rel="nofollow" aria-label={`Notify me about ${productName}`} aria-busy={state.status === 'loading' || undefined} data-notify="signin">
          Notify me
        </Link>
        {watching}
      </span>
    )
  }
  const on = state.status === 'on'
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" className={`${cls}${on ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={on} aria-label={`Notify me about ${productName}`} disabled={state.status === 'saving'} onClick={toggle} data-notify="toggle">
        {on ? 'Watching ✓' : state.status === 'saving' ? 'Saving…' : 'Notify me'}
      </button>
      {watching}
      {state.error && <span role="status" className="text-xs" style={{ color: 'var(--down)' }}>{state.error}</span>}
    </span>
  )
}
