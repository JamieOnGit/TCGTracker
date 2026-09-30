'use client'
import type { SupabaseClient } from '@supabase/supabase-js'

/** True when a browser client can exist. No Supabase code is loaded. */
export function supabaseAvailable(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

/**
 * Loads the Supabase client on demand, so the ~150KB library isn't in the
 * first load of public pages (header bell, live drops panel).
 */
export async function loadSupabaseBrowser(): Promise<SupabaseClient | null> {
  if (!supabaseAvailable()) return null
  const { supabaseBrowser } = await import('./browser')
  return supabaseBrowser()
}
