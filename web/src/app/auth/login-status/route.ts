import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { clearLoginRequestCookie, isLive, ownLoginRequest } from '@/lib/auth/loginRequests'
import { supabaseForRequest, supabaseService } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Status = { state: 'none' | 'waiting' | 'expired' | 'error' } | { state: 'signed-in'; next: string }

function reply(body: Status): NextResponse {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Polled by the sign-in page while it waits. Once the request this browser
 * made has been approved from the device that opened the email, sign this
 * browser in as that account (a one-off server-side magic link, verified
 * here so the session cookies land on this browser) and say where to go.
 */
export async function GET(): Promise<NextResponse> {
  const row = await ownLoginRequest()
  if (!row) return reply({ state: 'none' })
  if (!isLive(row)) return reply({ state: 'expired' })
  if (!row.approved_at || !row.approved_email) return reply({ state: 'waiting' })

  const db = supabaseService()
  // Claim it exactly once, even if two polls race.
  const { data: claimed } = await db
    .from('login_requests')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
  if (!claimed?.length) return reply({ state: 'expired' })

  const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: row.approved_email })
  const tokenHash = link?.properties?.hashed_token
  if (error || !tokenHash) return reply({ state: 'error' })
  const sb = await supabaseForRequest()
  const type = (link.properties.verification_type || 'magiclink') as EmailOtpType
  const verified = await sb.auth.verifyOtp({ token_hash: tokenHash, type })
  if (verified.error) return reply({ state: 'error' })
  await clearLoginRequestCookie()
  return reply({ state: 'signed-in', next: row.next_path })
}
