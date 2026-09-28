import Link from 'next/link'
import { AdminHeader, HealthDot, StatusBadge } from '@/components/admin/bits'
import { sectionsFor } from '@/lib/admin/access'
import { latestPipelineRuns, overviewCounts, retailers, settingValues } from '@/lib/admin/data'
import { fmtAgo, fmtDuration, retailerHealth } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Overview' }

function Stat({ label, value, href, tone }: { label: string; value: number | null; href: string; tone?: 'warn' | 'down' }) {
  if (value === null) return null
  return (
    <Link href={href} className="admin-stat" data-tone={value > 0 ? tone : undefined}>
      <span className="eyebrow">{label}</span>
      <span className="v block">{value}</span>
    </Link>
  )
}

export default async function AdminOverview() {
  const { me, sb } = await requireSection('overview')
  const isAdmin = me.role === 'admin'
  const [counts, runs, rets, zero] = await Promise.all([
    overviewCounts(sb, me.role),
    isAdmin ? latestPipelineRuns(sb) : Promise.resolve([]),
    isAdmin ? retailers(sb) : Promise.resolve([]),
    isAdmin ? settingValues(sb, ['drops.zero_product_alert_cycles']) : Promise.resolve({} as Record<string, unknown>),
  ])
  const threshold = typeof zero['drops.zero_product_alert_cycles'] === 'number' ? (zero['drops.zero_product_alert_cycles'] as number) : 5
  const health = rets.map((r) => ({ r, h: retailerHealth(r, threshold) }))
  const unhealthy = health.filter((x) => x.h === 'warn' || x.h === 'down').length
  const failedRuns = runs.filter((r) => r.status === 'failed').length
  const tiles = [
    <Stat key="l" label="Pending listings" value={counts.pending} href="/admin/listings/" tone="warn" />,
    <Stat key="r" label="Open reports" value={counts.reports} href="/admin/reports/" tone="warn" />,
    <Stat key="m" label="Mapping queue" value={counts.mapping} href="/admin/mapping/" tone="warn" />,
    <Stat key="e" label="Failed emails" value={counts.failedEmails} href="/admin/emails/?status=failed" tone="down" />,
    isAdmin ? <Stat key="a" label="Adapters unhealthy" value={unhealthy} href="/admin/drops/" tone="down" /> : null,
    <Stat key="d" label="Drafts to review" value={counts.drafts} href="/admin/news/" />,
  ].filter(Boolean)

  return (
    <>
      <AdminHeader title="Overview" lead="What needs attention, and whether the pipelines are running." />
      <div className="admin-stats" style={{ ['--cols' as string]: Math.min(tiles.length, 6) }}>{tiles}</div>

      {isAdmin && (
        <section className="admin-section mt-12" aria-labelledby="pipe-h">
          <h2 id="pipe-h" className="admin-h2">Pipeline status</h2>
          <p className="muted text-sm">Last run of each job (pipeline_runs). {failedRuns ? <strong className="admin-warn-text">{failedRuns} job{failedRuns === 1 ? '' : 's'} failed on the last run.</strong> : 'No failures on the last run.'}</p>
          {runs.length === 0 ? (
            <p className="notice mt-4">No pipeline runs recorded yet. Workers write a row for every job run.</p>
          ) : (
            <div className="table-wrap mt-4">
              <table className="dt">
                <caption className="sr-only">Last run per pipeline job</caption>
                <thead>
                  <tr><th scope="col">Job</th><th scope="col">Status</th><th scope="col">Started</th><th scope="col" className="n">Duration</th><th scope="col">Error</th></tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <th scope="row" className="nowrap font-medium">{r.job}</th>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="nowrap" title={r.started_at}>{fmtAgo(r.started_at)}</td>
                      <td className="n">{r.status === 'running' ? 'running' : fmtDuration(r.started_at, r.finished_at)}</td>
                      <td>{r.error ? <span className="err-text">{r.error.slice(0, 200)}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="admin-section" aria-labelledby="ret-h">
          <h2 id="ret-h" className="admin-h2">Retailer adapters</h2>
          <p className="muted text-sm">Health from the drop monitors. <Link className="prose-link" href="/admin/drops/">Manage retailers</Link></p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {health.map(({ r, h }) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm">
                <span className="min-w-0 truncate">{r.name}</span>
                <span className="flex items-center gap-3">
                  <span className="muted text-xs">{r.enabled ? `ok ${fmtAgo(r.last_success_at)}` : ''}</span>
                  <HealthDot health={h} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="admin-section" aria-labelledby="ql-h">
        <h2 id="ql-h" className="admin-h2">Quick links</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {sectionsFor(me.role).filter((s) => s.key !== 'overview').map((s) => (
            <li key={s.key}><Link className="chip-filter" href={s.href}>{s.label}</Link></li>
          ))}
          {isAdmin && <li><Link className="chip-filter" href="/admin/settings/#ebay">eBay affiliate</Link></li>}
        </ul>
      </section>
    </>
  )
}
