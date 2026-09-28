'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'

type Row = { id: number; event_type: string; price_aud: number | null; rrp_tag: string; rrp_delta_pct: number | null; occurred_at: string; retail_products: { title: string; url: string; retailers: { name: string } } }

const LABEL: Record<string, string> = { NEW_LISTING: 'New listing', PREORDER_OPEN: 'Pre-order open', IN_STOCK: 'In stock', PRICE_CHANGE: 'Price change', QUEUE_LIVE: 'Queue live' }
const time = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })

/**
 * The instant feed. RLS returns events younger than the public delay only to
 * Premium members, so this panel is safe to render for everyone: Free members
 * simply see the upgrade prompt.
 */
export function LiveDrops() {
  const [state, setState] = useState<{ status: 'loading' | 'anon' | 'free' | 'premium'; rows: Row[] }>({ status: 'loading', rows: [] })
  useEffect(() => {
    const sb = supabaseBrowser()
    if (!sb) return setState({ status: 'anon', rows: [] })
    let active = true
    const load = async () => {
      const { data: auth } = await sb.auth.getUser()
      if (!auth.user) return active && setState({ status: 'anon', rows: [] })
      const { data: premium } = await sb.rpc('is_premium', { p_user: auth.user.id })
      if (!premium) return active && setState({ status: 'free', rows: [] })
      const since = new Date(Date.now() - 86_400_000).toISOString()
      const { data } = await sb
        .from('drop_events')
        .select('id,event_type,price_aud,rrp_tag,rrp_delta_pct,occurred_at,retail_products!inner(title,url,retailers!inner(name))')
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(50)
      if (active) setState({ status: 'premium', rows: (data as unknown as Row[]) ?? [] })
    }
    load()
    const t = setInterval(load, 30_000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [])

  return (
    <section aria-labelledby="live-h" className="notice" style={{ borderLeftColor: 'var(--accent)', background: 'var(--accent-soft)', padding: 24 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="live-h" className="text-xl">Live feed <span className="badge badge-premium ml-2">◆ Premium</span></h2>
        {state.status === 'premium' && <span className="muted text-xs">Updates every 30 seconds · last 24 hours</span>}
      </div>
      {state.status === 'loading' && <p className="muted mt-3 text-sm">Loading…</p>}
      {(state.status === 'anon' || state.status === 'free') && (
        <div className="mt-3 text-sm">
          <p>Premium members see restocks and pre-orders the moment they happen, by email and here. Everyone else gets them 24 hours later.</p>
          <div className="mt-4 flex gap-3">
            <Link href="/premium/" className="btn btn-holo btn-sm">Get instant alerts · A$12.99/mo</Link>
            {state.status === 'anon' && <Link href="/login/?next=/drops/" className="btn btn-secondary btn-sm">Sign in</Link>}
          </div>
        </div>
      )}
      {state.status === 'premium' && (
        state.rows.length === 0 ? <p className="muted mt-3 text-sm">Nothing in the last 24 hours. Your alerts are on.</p> : (
          <ul className="mt-3">
            {state.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2 text-sm" style={{ borderColor: 'var(--line)' }}>
                <span><span className="num muted mr-3">{time.format(new Date(r.occurred_at))}</span><a href={r.retail_products.url} target="_blank" rel="nofollow noopener" className="prose-link">{r.retail_products.title}</a> · {r.retail_products.retailers.name}</span>
                <span className="badge badge-live">{LABEL[r.event_type] ?? r.event_type}{r.price_aud ? ` · A$${Number(r.price_aud).toFixed(2)}` : ''}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  )
}
