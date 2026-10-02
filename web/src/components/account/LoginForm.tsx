'use client'
import { useActionState, useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { sendMagicLink, verifyEmailCode } from '@/lib/actions/auth'
import type { ActionResult } from '@/lib/actions/result'

const POLL_MS = 3000
const POLL_FOR_MS = 65 * 60_000

/**
 * While this page waits, ask the server whether the sign-in was approved from
 * the device that opened the email; if so the server has signed this browser
 * in, so go on. See app/auth/login-status/route.ts.
 */
function useSignInWhenApproved(active: boolean) {
  useEffect(() => {
    if (!active) return
    const until = Date.now() + POLL_FOR_MS
    let stopped = false
    const tick = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible') {
        try {
          const res = await fetch('/auth/login-status/', { cache: 'no-store' })
          const body = (await res.json()) as { state: string; next?: string }
          if (body.state === 'signed-in' && body.next) {
            stopped = true
            window.location.assign(body.next)
            return
          }
          if (body.state === 'expired' || body.state === 'none') stopped = true
        } catch {
          // offline for a moment: try again next tick
        }
      }
      if (!stopped && Date.now() < until) timer = setTimeout(tick, POLL_MS)
    }
    let timer = setTimeout(tick, POLL_MS)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [active])
}

export function LoginForm({ next, linkError, waiting = false }: { next: string; linkError: boolean; waiting?: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(sendMagicLink, null)
  const [email, setEmail] = useState('')
  const [dismissed, setDismissed] = useState<ActionResult | null>(null)
  const sent = state?.ok === true && state !== dismissed
  const err = state && !state.ok ? state.error : null
  useSignInWhenApproved(sent || (waiting && !state))

  if (sent) {
    return (
      <div className="panel" role="status" aria-live="polite" data-testid="login-sent">
        <span className="success-mark" aria-hidden="true"><Mail size={22} strokeWidth={1.5} /></span>
        <h2 className="mt-4">Check your email</h2>
        <p className="mt-2">
          We&apos;ve sent a sign-in link to <strong>{email}</strong>. Open it on any device, this one or your phone. If you open it on another device, tap <strong>Yes</strong> when it asks, and this page signs in by itself. The link expires in an hour.
        </p>
        <p className="muted mt-3 text-sm" data-testid="login-waiting">Keep this page open. Waiting for you to open the link…</p>
        <details className="mt-4">
          <summary className="text-sm">Got a code in the email instead?</summary>
          <CodeForm email={email} next={next} />
        </details>
        <p className="muted mt-4 text-sm">Nothing after a couple of minutes? Check your spam or promotions folder, or send it again.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="btn btn-secondary" onClick={() => setDismissed(state)}>Use a different email</button>
        </div>
      </div>
    )
  }

  return (
    <form action={action} className="form-grid" noValidate>
      {linkError && !state && (
        <div className="notice notice-warn" role="alert">
          <strong>That sign-in link didn&apos;t work.</strong> Links can only be used once and expire after an hour. Enter your email for a new one.
        </div>
      )}
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? 'email-error email-hint' : 'email-hint'}
        />
        <p id="email-hint" className="hint">We&apos;ll email you a one-time sign-in link. New here? The same link creates your account.</p>
        {err && <p id="email-error" className="field-error" role="alert">{err}</p>}
      </div>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  )
}

/** The email's one-time code signs in this browser, wherever the email was opened. */
function CodeForm({ email, next }: { email: string; next: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(verifyEmailCode, null)
  const err = state && !state.ok ? state.error : null
  return (
    <form action={action} className="form-grid mt-5" noValidate>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="token">Sign-in code</label>
        <input
          id="token"
          name="token"
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={12}
          required
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? 'token-error' : undefined}
        />
        {err && <p id="token-error" className="field-error" role="alert">{err}</p>}
      </div>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in with code'}
      </button>
    </form>
  )
}
