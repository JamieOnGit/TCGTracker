'use client'
import { useEffect } from 'react'
import { safeNext } from '@/lib/account/format'
import { supabaseBrowser } from '@/lib/supabase/browser'

const FAILED = '/login/?error=link'
// Runs once per page load, even if React mounts the effect twice (dev StrictMode).
let started = false

export function ConfirmSignIn() {
  useEffect(() => {
    if (started) return
    started = true
    const url = new URL(window.location.href)
    const next = safeNext(url.searchParams.get('next'))
    // A sign-in asked for on another device: offer to sign that one in too.
    const r = url.searchParams.get('r')
    const after = r ? `/auth/approve/?r=${encodeURIComponent(r)}&next=${encodeURIComponent(next)}` : next
    // A PKCE link (?code=) still goes to the server exchange.
    const code = url.searchParams.get('code')
    if (code) {
      window.location.replace(`/auth/callback/?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`)
      return
    }
    const hash = new URLSearchParams(url.hash.slice(1))
    const accessToken = hash.get('access_token')
    const refreshToken = hash.get('refresh_token')
    // Keep the tokens out of history and any copied URL.
    window.history.replaceState(null, '', url.pathname + url.search)
    const sb = supabaseBrowser()
    if (!sb || !accessToken || !refreshToken) {
      window.location.replace(FAILED)
      return
    }
    sb.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => window.location.replace(error ? FAILED : after))
      .catch(() => window.location.replace(FAILED))
  }, [])

  return (
    <p className="lead mt-3" role="status">
      One moment while we sign you in.
    </p>
  )
}
