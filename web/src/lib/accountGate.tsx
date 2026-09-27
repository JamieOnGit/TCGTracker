import 'server-only'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentUserWithRole, supabaseConfigured, type AppRole } from '@/lib/supabase/server'

export const privateMeta: Metadata = { robots: { index: false, follow: false } }

/**
 * Server-side gate for account, messaging and admin routes (brief 15:
 * "admin routes checked on the server"). RLS still protects the data itself.
 */
export async function requireUser(nextPath: string, roles?: AppRole[]) {
  if (!supabaseConfigured()) return { demo: true as const, user: null }
  const user = await currentUserWithRole()
  if (!user) redirect(`/login/?next=${encodeURIComponent(nextPath)}`)
  if (roles && !(user.role === 'admin' || roles.includes(user.role))) redirect('/')
  return { demo: false as const, user }
}

export function PendingUi({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="demo-banner">
        Skeleton route. The UI for this screen is built after the wireframes are approved (brief 15). Planned contents:
      </p>
      <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </>
  )
}
