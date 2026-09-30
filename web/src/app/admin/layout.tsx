import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AdminNav } from '@/components/admin/AdminNav'
import { sectionsFor } from '@/lib/admin/access'
import { overviewCounts } from '@/lib/admin/data'
import { staffUser } from '@/lib/admin/guard'
import { currentUserWithRole, supabaseConfigured, supabaseForRequest } from '@/lib/supabase/server'
import './admin.css'

export const metadata: Metadata = {
  title: { default: 'Admin console · TCG Trade', template: '%s · Admin · TCG Trade' },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}
export const dynamic = 'force-dynamic'

const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderator', editor: 'Editor' } as const

/**
 * Role check on the server for the whole console (brief 10, 15). Each page
 * re-checks its own section with requireSection(), because layouts are not
 * re-rendered on client-side navigation.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) {
    return (
      <div className="container-x section-tight">
        <h1>Admin console</h1>
        <p className="notice mt-6">The admin console needs a Supabase project (NEXT_PUBLIC_SUPABASE_URL and keys). It is not available on demo data.</p>
      </div>
    )
  }
  const me = await staffUser()
  if (!me) redirect((await currentUserWithRole()) ? '/' : '/login/?next=%2Fadmin%2F')
  const counts = await overviewCounts(await supabaseForRequest(), me.role)
  const badge: Record<string, number | null> = { listings: counts.pending, reports: counts.reports, mapping: counts.mapping, emails: counts.failedEmails, sightings: counts.sightings }
  const items = sectionsFor(me.role).map((s) => ({ href: s.href, label: s.label, badge: badge[s.key] ?? null }))
  return (
    <div className="container-x admin-shell">
      <aside className="admin-side">
        <div>
          <p className="eyebrow">Admin console</p>
          <p className="admin-who">Signed in as {ROLE_LABEL[me.role]}</p>
        </div>
        <AdminNav items={items} />
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  )
}
