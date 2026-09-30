'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSupabaseBrowser, supabaseAvailable } from '@/lib/supabase/browser-lazy'

type State = { status: 'loading' | 'anon' | 'off' | 'on' | 'saving'; error?: string }

/**
 * "Remind me" for one release. Server-rendered as a sign-in link (what signed-out
 * visitors and crawlers see); once the lazy Supabase client finds a session it
 * becomes a toggle over the member's own release_reminders row (owner RLS).
 */
export function RemindButton({ releaseId, nextPath }: { releaseId: string; nextPath: string }) {
  const [state, setState] = useState<State>(() => ({ status: supabaseAvailable() ? 'loading' : 'anon' }))
  const [ctx, setCtx] = useState<{ sb: SupabaseClient; userId: string } | null>(null)

  useEffect(() => {
    if (!supabaseAvailable()) return
    let active = true
    ;(async () => {
      const sb = await loadSupabaseBrowser()
      if (!sb || !active) return
      const { data: auth } = await sb.auth.getUser()
      if (!auth.user) return active && setState({ status: 'anon' })
      const { data } = await sb.from('release_reminders').select('release_event_id').eq('release_event_id', releaseId).maybeSingle()
      if (!active) return
      setCtx({ sb, userId: auth.user.id })
      setState({ status: data ? 'on' : 'off' })
    })()
    return () => {
      active = false
    }
  }, [releaseId])

  async function toggle() {
    if (!ctx) return
    const wasOn = state.status === 'on'
    setState({ status: 'saving' })
    const { error } = wasOn
      ? await ctx.sb.from('release_reminders').delete().eq('release_event_id', releaseId).eq('user_id', ctx.userId)
      : await ctx.sb.from('release_reminders').insert({ user_id: ctx.userId, release_event_id: releaseId })
    if (error) setState({ status: wasOn ? 'on' : 'off', error: 'Could not save your reminder. Please try again.' })
    else setState({ status: wasOn ? 'off' : 'on' })
  }

  if (state.status === 'anon' || state.status === 'loading') {
    return (
      <Link href={`/login/?next=${encodeURIComponent(nextPath)}`} className="btn btn-secondary" rel="nofollow" aria-busy={state.status === 'loading' || undefined}>
        Remind me the day before
      </Link>
    )
  }
  return (
    <span className="inline-flex flex-col gap-2">
      <button type="button" className={state.status === 'on' ? 'btn btn-primary' : 'btn btn-secondary'} aria-pressed={state.status === 'on'} disabled={state.status === 'saving'} onClick={toggle}>
        {state.status === 'on' ? 'Reminder set · tap to cancel' : state.status === 'saving' ? 'Saving…' : 'Remind me the day before'}
      </button>
      <span role="status" className="muted text-xs">{state.error ?? (state.status === 'on' ? 'We’ll notify you the day before (once the exact date is confirmed).' : '')}</span>
    </span>
  )
}
