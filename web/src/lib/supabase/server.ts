import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

/** Per-request client acting as the signed-in user (or anon). RLS applies. */
export async function supabaseForRequest(): Promise<SupabaseClient> {
  const store = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options)
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  })
}

/** Anonymous client for cacheable public reads (no cookies, so pages can be ISR'd). */
export function supabasePublic(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  })
}

/** Service role: bypasses RLS. Server-only (webhooks, admin mutations after a role check). */
export function supabaseService(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } })
}

export type AppRole = 'user' | 'editor' | 'moderator' | 'admin'

/** Server-side role check for /admin (brief 15: admin routes checked on the server). */
export async function currentUserWithRole(): Promise<{ id: string; role: AppRole } | null> {
  if (!supabaseConfigured()) return null
  const sb = await supabaseForRequest()
  const { data } = await sb.auth.getUser()
  if (!data.user) return null
  const { data: priv } = await sb.from('profile_private').select('role,status').eq('user_id', data.user.id).single()
  if (!priv || priv.status !== 'active') return null
  return { id: data.user.id, role: priv.role as AppRole }
}
