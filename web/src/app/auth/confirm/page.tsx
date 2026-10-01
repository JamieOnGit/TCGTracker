import { privateMeta } from '@/lib/accountGate'
import { ConfirmSignIn } from './ConfirmSignIn'

export const metadata = { ...privateMeta, title: 'Signing you in' }

/**
 * Magic-link landing. Supabase puts the session in the URL fragment, which
 * never reaches the server, so the browser finishes the sign-in. Unlike the
 * PKCE link (/auth/callback/), this works in whatever browser opens the email:
 * Gmail's in-app browser, another app, or another device.
 */
export default function ConfirmPage() {
  return (
    <div className="container-x">
      <div className="auth-card">
        <p className="eyebrow">TCGTracker account</p>
        <h1 className="mt-3">Signing you in…</h1>
        <ConfirmSignIn />
      </div>
    </div>
  )
}
