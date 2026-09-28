import 'server-only'
import { requireUser } from '@/lib/accountGate'

/** Server-side gate: redirects to /login/?next=… when signed out; null in demo mode (no Supabase). */
export async function requireMember(nextPath: string): Promise<{ id: string; role: string } | null> {
  const r = await requireUser(nextPath)
  return r.demo ? null : r.user
}

/** Rebuild "/path/?a=1&b=2" for the login `next` parameter. */
export function withQuery(path: string, sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') q.set(k, v)
  }
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}
