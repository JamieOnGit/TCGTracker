import { PendingUi, privateMeta, requireUser } from '@/lib/accountGate'

export const metadata = privateMeta
export const dynamic = 'force-dynamic'

export default async function Admin({ params }: { params: Promise<{ slug?: string[] }> }) {
  const key = ((await params).slug ?? []).join('/')
  const gate = await requireUser(`/admin/${key ? `${key}/` : ''}`, ['moderator', 'editor'])
  return (
    <>
      {gate.demo && <p className="demo-banner">Demo mode: no database, so no sign-in. In production this route requires the admin, moderator or editor role, checked on the server.</p>}
      <PendingUi
        title="Admin console"
        items={['Listing approval queue (bulk approve/reject, reason templates, cert-mismatch flag)', 'Card-mapping queue (confidence, EN/JP labelled)', 'Users (suspend/ban, tier/quota override)', 'Reports & moderation', 'Catalogue', 'Market data pipeline status', 'Drops: adapter health, RRP table, watchlist, alert log', 'News CMS', 'Redirects & SEO overview', 'Subscriptions (read-only Stripe)', 'Site settings & feature flags', 'Audit log']}
      />
    </>
  )
}
