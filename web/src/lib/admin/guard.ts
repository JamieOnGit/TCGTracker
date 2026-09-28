import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUserWithRole, supabaseConfigured, supabaseForRequest } from '@/lib/supabase/server'
import { canAccess, isStaff, type SectionKey, type StaffRole } from './access'

/** One role lookup per request, shared by the layout and the page. */
export const staffUser = cache(async () => {
  const me = await currentUserWithRole()
  return me && isStaff(me.role) ? { id: me.id, role: me.role as StaffRole } : null
})

export interface StaffContext {
  me: { id: string; role: StaffRole }
  sb: SupabaseClient
}

/**
 * Server-side gate for every admin page (layouts are not re-run on client
 * navigation, so each page checks too). Signed-out → login; signed-in without
 * the section's role → home (non-staff) or the overview (other staff).
 */
export async function requireSection(section: SectionKey, path = `/admin/${section === 'overview' ? '' : `${section}/`}`): Promise<StaffContext> {
  if (!supabaseConfigured()) redirect('/')
  const me = await staffUser()
  if (!me) {
    const anyUser = await currentUserWithRole()
    redirect(anyUser ? '/' : `/login/?next=${encodeURIComponent(path)}`)
  }
  if (!canAccess(me.role, section)) redirect('/admin/')
  return { me, sb: await supabaseForRequest() }
}
