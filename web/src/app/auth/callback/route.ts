import { NextResponse, type NextRequest } from 'next/server'
import { supabaseForRequest } from '@/lib/supabase/server'

/** Magic-link landing: exchanges the one-time code for a session cookie. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const next = req.nextUrl.searchParams.get('next') ?? '/account/'
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account/'
  if (code) {
    const sb = await supabaseForRequest()
    const { error } = await sb.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(safeNext, req.url))
  }
  return NextResponse.redirect(new URL('/login/?error=link', req.url))
}
