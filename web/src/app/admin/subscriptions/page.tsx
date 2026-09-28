import Link from 'next/link'
import { AdminHeader, StatusBadge } from '@/components/admin/bits'
import { fmtAud2, fmtDate } from '@/components/Format'
import { EmptyState } from '@/components/ui'
import { settingValues, subscriptions } from '@/lib/admin/data'
import { subscriptionMetrics } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Subscriptions' }

export default async function AdminSubscriptions() {
  const { sb } = await requireSection('subscriptions')
  const [rows, s] = await Promise.all([subscriptions(sb), settingValues(sb, ['billing.premium_monthly_cents'])])
  const price = typeof s['billing.premium_monthly_cents'] === 'number' ? (s['billing.premium_monthly_cents'] as number) : 1299
  const m = subscriptionMetrics(rows, price)
  const tiles: [string, string, string?][] = [
    ['Active Premium', String(m.activePremium), m.pastDue ? `${m.pastDue} past due` : undefined],
    ['MRR (A$)', fmtAud2(m.mrrCents / 100), `${m.activePremium} × ${fmtAud2(price / 100)}`],
    ['Churn, 30 days', m.churnPct === null ? '—' : `${m.churnPct.toFixed(1)}%`, `${m.canceled30d} cancelled`],
    ['Cancelling', String(m.cancelingAtPeriodEnd), 'at period end'],
  ]
  return (
    <>
      <AdminHeader title="Subscriptions" lead="Read-only. Stripe webhooks are the source of truth; change a member’s access with a tier override on their user page." />
      <div className="admin-stats" style={{ ['--cols' as string]: 4 }}>
        {tiles.map(([label, v, sub]) => (
          <div key={label} className="admin-stat">
            <span className="eyebrow">{label}</span>
            <span className="v block">{v}</span>
            {sub && <span className="muted block text-xs">{sub}</span>}
          </div>
        ))}
      </div>
      <p className="provenance">MRR = active or trialing Premium × the current monthly price (GST inclusive). Churn = cancelled in the last 30 days ÷ (active + cancelled).</p>
      {rows.length === 0 ? <EmptyState title="No subscriptions yet." /> : (
        <div className="table-wrap mt-6">
          <table className="dt">
            <caption className="sr-only">Subscriptions, most recently updated first</caption>
            <thead><tr><th scope="col">Member</th><th scope="col">Tier</th><th scope="col">Status</th><th scope="col">Period end</th><th scope="col">Cancels</th><th scope="col">Grace until</th><th scope="col">Updated</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <th scope="row" className="nowrap"><Link className="prose-link" href={`/admin/users/${r.user_id}/`}>@{r.profile?.username ?? r.user_id.slice(0, 8)}</Link></th>
                  <td>{r.tier}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="nowrap">{fmtDate(r.current_period_end)}</td>
                  <td>{r.cancel_at_period_end ? 'at period end' : '—'}</td>
                  <td className="nowrap">{fmtDate(r.grace_until)}</td>
                  <td className="nowrap">{fmtDate(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
