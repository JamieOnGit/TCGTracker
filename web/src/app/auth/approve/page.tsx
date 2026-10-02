import { redirect } from 'next/navigation'
import { CheckCircle2, Monitor } from 'lucide-react'
import { safeNext } from '@/lib/account/format'
import { privateMeta } from '@/lib/accountGate'
import { approveLoginRequest } from '@/lib/actions/auth'
import { describeDevice, minutesAgo } from '@/lib/auth/device'
import { isLive, isRequestId, loadLoginRequest, ownLoginRequest } from '@/lib/auth/loginRequests'
import { supabaseForRequest } from '@/lib/supabase/server'
import '../../account/account.css'

export const metadata = { ...privateMeta, title: 'Sign in your other device' }
export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * Reached from the email link, on the device that opened it (now signed in).
 * If the sign-in was asked for on a different device, offer to sign that one
 * in too. The asking device shows "Check your email" and polls
 * /auth/login-status/ until this is approved.
 */
export default async function ApprovePage({ searchParams }: Props) {
  const sp = await searchParams
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null)
  const id = sp.r
  if (!isRequestId(id)) redirect(next)

  const sb = await supabaseForRequest()
  const { data } = await sb.auth.getUser()
  const user = data.user
  if (!user?.email) redirect(`/login/?next=${encodeURIComponent(next)}`)

  const row = await loadLoginRequest(id)
  // Unknown, someone else's, or already used by the other device: just carry on.
  if (!row || row.email !== user.email.toLowerCase() || row.consumed_at) redirect(next)
  // Opened on the same browser that asked: nothing else to sign in.
  if ((await ownLoginRequest())?.id === row.id) redirect(next)

  const approvedHere = row.approved_at && row.approved_user_id === user.id
  if (!approvedHere && (!isLive(row) || row.approved_at)) redirect(next)
  const device = describeDevice(row.user_agent)

  return (
    <div className="container-x">
      <div className="auth-card">
        <p className="eyebrow">TCGTracker account</p>
        {approvedHere ? (
          <div className="panel mt-6" role="status" data-testid="approve-done">
            <span className="success-mark" aria-hidden="true"><CheckCircle2 size={22} strokeWidth={1.5} /></span>
            <h1 className="mt-4">Done</h1>
            <p className="mt-2">
              Your other device ({device}) is signing in now. It takes a few seconds. You&apos;re signed in here too.
            </p>
            <a className="btn btn-secondary mt-5" href={next}>Continue here</a>
          </div>
        ) : (
          <>
            <h1 className="mt-3">Sign in your other device too?</h1>
            <div className="panel mt-6">
              <span className="success-mark" aria-hidden="true"><Monitor size={22} strokeWidth={1.5} /></span>
              <p className="mt-4">
                You&apos;re signed in on this device. The sign-in was asked for on <strong>{device}</strong>, {minutesAgo(row.created_at)}.
              </p>
              <p className="muted mt-2 text-sm">Only say yes if that was you, just now.</p>
              <form action={approveLoginRequest} className="mt-5 flex flex-wrap gap-3">
                <input type="hidden" name="r" value={row.id} />
                <input type="hidden" name="next" value={next} />
                <button type="submit" className="btn btn-primary">Yes, sign in {device}</button>
                <a className="btn btn-secondary" href={next}>No, just this device</a>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
