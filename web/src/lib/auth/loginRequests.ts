import 'server-only'
import { cookies } from 'next/headers'
import { supabaseService } from '@/lib/supabase/server'

/**
 * Cross-device sign-in. Asking to sign in creates a login request; the asking
 * browser keeps its id and a secret in an httpOnly cookie. The email link
 * carries only the id. Whoever opens the link is signed in by it (often a
 * phone) and can then approve the request; the asking browser, polling with
 * its secret, is signed in once it's approved. See
 * supabase/migrations/20261002000200_login_requests.sql.
 */
export const LOGIN_REQUEST_COOKIE = 'tcg_login_req'
const TTL_SECONDS = 60 * 60

export type LoginRequestRow = {
  id: string
  secret_hash: string
  email: string
  next_path: string
  user_agent: string | null
  created_at: string
  expires_at: string
  approved_user_id: string | null
  approved_email: string | null
  approved_at: string | null
  consumed_at: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isRequestId(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Create a request and set this browser's cookie. Returns the id, or null if the service key isn't configured. */
export async function createLoginRequest(email: string, next: string, userAgent: string | null): Promise<string | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const secret = randomSecret()
  const db = supabaseService()
  // Housekeeping: old requests are useless after an hour.
  await db.from('login_requests').delete().lt('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
  const { data, error } = await db
    .from('login_requests')
    .insert({ secret_hash: await sha256Hex(secret), email: email.toLowerCase(), next_path: next, user_agent: userAgent?.slice(0, 400) ?? null })
    .select('id')
    .single()
  if (error || !data) return null
  const store = await cookies()
  store.set(LOGIN_REQUEST_COOKIE, `${data.id}.${secret}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_SECONDS,
  })
  return data.id as string
}

/** This browser's own request, if its cookie holds a valid secret for it. */
export async function ownLoginRequest(): Promise<LoginRequestRow | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const raw = (await cookies()).get(LOGIN_REQUEST_COOKIE)?.value
  const [id, secret] = raw?.split('.') ?? []
  if (!isRequestId(id) || !secret) return null
  const row = await loadLoginRequest(id)
  if (!row || row.secret_hash !== (await sha256Hex(secret))) return null
  return row
}

export async function loadLoginRequest(id: string): Promise<LoginRequestRow | null> {
  const { data } = await supabaseService().from('login_requests').select('*').eq('id', id).maybeSingle()
  return (data as LoginRequestRow | null) ?? null
}

export function isLive(row: LoginRequestRow, now = Date.now()): boolean {
  return !row.consumed_at && new Date(row.expires_at).getTime() > now
}

export async function clearLoginRequestCookie(): Promise<void> {
  ;(await cookies()).delete(LOGIN_REQUEST_COOKIE)
}
