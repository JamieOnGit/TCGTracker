import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/account/LoginForm'
import { safeNext } from '@/lib/account/format'
import { privateMeta } from '@/lib/accountGate'
import { supabaseConfigured, supabaseForRequest } from '@/lib/supabase/server'
import { isLive, ownLoginRequest } from '@/lib/auth/loginRequests'
import '../account/account.css'

export const metadata = { ...privateMeta, title: 'Sign in' }
export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function Login({ searchParams }: Props) {
  const sp = await searchParams
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null)
  if (supabaseConfigured()) {
    const sb = await supabaseForRequest()
    const { data } = await sb.auth.getUser()
    if (data.user) redirect(next)
  }
  // Asked for a link earlier and came back (or refreshed): keep waiting for approval.
  const pending = supabaseConfigured() ? await ownLoginRequest() : null
  const waiting = Boolean(pending && isLive(pending))
  return (
    <div className="container-x">
      <div className="auth-card">
        <p className="eyebrow">TCGTracker account</p>
        <h1 className="mt-3">Sign in or join</h1>
        <p className="lead mt-3">No passwords to remember. Enter your email and we&apos;ll send you a secure one-time sign-in link.</p>
        <div className="mt-8">
          {supabaseConfigured() ? (
            <LoginForm next={next} linkError={sp.error === 'link'} waiting={waiting} />
          ) : (
            <div className="notice notice-warn">Sign-in needs the Supabase connection, which isn&apos;t configured in this environment.</div>
          )}
        </div>
        <ul className="muted mt-8 grid gap-2 text-sm">
          <li>Free members can list 5 cards a month and message any seller.</li>
          <li>Your email is never shown to other members.</li>
          <li>
            By continuing you agree to our <a className="prose-link" href="/terms/">terms</a> and <a className="prose-link" href="/privacy/">privacy policy</a>. We only send marketing emails if you opt in.
          </li>
        </ul>
      </div>
    </div>
  )
}
