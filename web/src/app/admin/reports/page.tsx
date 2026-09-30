import Link from 'next/link'
import { ActionForm } from '@/components/admin/ActionForm'
import { AdminHeader, StatusBadge } from '@/components/admin/bits'
import { ThreadViewer } from '@/components/admin/ThreadViewer'
import { fmtDate } from '@/components/Format'
import { EmptyState } from '@/components/ui'
import { resolveReportForm } from '@/lib/actions/admin'
import { reportsList } from '@/lib/admin/data'
import { fmtAgo } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Reports' }
const STATUSES = ['open', 'actioned', 'dismissed'] as const

export default async function AdminReports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sb } = await requireSection('reports')
  const raw = (await searchParams).status
  const status = STATUSES.find((s) => s === (Array.isArray(raw) ? raw[0] : raw)) ?? 'open'
  const rows = await reportsList(sb, status)
  return (
    <>
      <AdminHeader title="Reports" lead="Reported listings, members and conversations. Resolve each with a note for the record.">
        <nav className="seg" aria-label="Report status">
          {STATUSES.map((s) => (
            <Link key={s} href={s === 'open' ? '/admin/reports/' : `/admin/reports/?status=${s}`} aria-current={s === status ? 'page' : undefined}>{s[0]!.toUpperCase() + s.slice(1)}</Link>
          ))}
        </nav>
      </AdminHeader>
      {rows.length === 0 ? (
        <EmptyState title={status === 'open' ? 'No open reports.' : `No ${status} reports.`} />
      ) : (
        <ol className="report-list">
          {rows.map((r) => (
            <li key={r.id} className="report-item" data-report-id={r.id}>
              <div className="min-w-0">
                <p className="eyebrow">{r.target_type} · {r.reason.replace(/_/g, ' ')}</p>
                <p className="mt-1 font-medium">
                  {r.preview.href ? <Link className="prose-link" href={r.preview.href}>{r.preview.title}</Link> : r.preview.title}
                </p>
                {r.preview.meta && <p className="muted text-xs">{r.preview.meta}</p>}
                {r.details && <p className="mt-3 text-sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>“{r.details}”</p>}
                <p className="muted mt-2 text-xs">Reported by @{r.reporter?.username ?? '?'} · {fmtAgo(r.created_at)}</p>
                {r.preview.conversationId && (
                  <div className="mt-3"><ThreadViewer conversationId={r.preview.conversationId} /></div>
                )}
              </div>
              <div>
                {r.status === 'open' ? (
                  <ActionForm action={resolveReportForm.bind(null, r.id)} submitLabel="Resolve" ariaLabel={`Resolve report ${r.id}`}>
                    <fieldset className="grid gap-2">
                      <legend className="label">Outcome</legend>
                      <label className="check"><input type="radio" name="status" value="actioned" defaultChecked /> Actioned</label>
                      <label className="check"><input type="radio" name="status" value="dismissed" /> Dismissed</label>
                    </fieldset>
                    <div className="field">
                      <label htmlFor={`note-${r.id}`}>Note</label>
                      <textarea id={`note-${r.id}`} name="note" className="textarea" rows={3} maxLength={1000} required placeholder="What you did and why" />
                    </div>
                  </ActionForm>
                ) : (
                  <div className="text-sm">
                    <StatusBadge status={r.status} /> <span className="muted text-xs">{fmtDate(r.resolved_at)}</span>
                    {r.resolution_note && <p className="mt-2">{r.resolution_note}</p>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
