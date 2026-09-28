import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { safeNext } from '@/lib/account/format'
import { supabaseForRequest } from '@/lib/supabase/server'

/**
 * Cross-device magic links. The default link (PKCE, via /auth/callback/) only
 * works in the browser that asked for it. With the Supabase email template set
 * to `{{ .SiteURL }}/login/confirm/?token_hash={{ .TokenHash }}&type=email&next=…`,
 * the link works on any device.
 */
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get('token_hash')
  const type = (req.nextUrl.searchParams.get('type') ?? 'email') as EmailOtpType
  const next = safeNext(req.nextUrl.searchParams.get('next'))
  if (tokenHash && ['email', 'magiclink', 'signup'].includes(type)) {
    const sb = await supabaseForRequest()
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return NextResponse.redirect(new URL(next, req.url))
  }
  return NextResponse.redirect(new URL('/login/?error=link', req.url))
}
