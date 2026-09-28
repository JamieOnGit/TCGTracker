import Link from 'next/link'
import { ActionButton } from '@/components/admin/ActionButton'
import { AdminHeader, Pager, StatusBadge } from '@/components/admin/bits'
import { EmptyState } from '@/components/ui'
import { retryEmail } from '@/lib/actions/admin'
import { outbox } from '@/lib/admin/data'
import { fmtAgo, maskEmail, pageParam } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Emails' }
const STATUSES = ['queued', 'sending', 'sent', 'failed', 'suppressed'] as const

export default async function AdminEmails({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sb } = await requireSection('emails')
  const sp = await searchParams
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status
  const status = STATUSES.find((s) => s === raw)
  const page = pageParam(sp.page)
  const { rows, total, size } = await outbox(sb, status, page)
  const pages = Math.max(1, Math.ceil(total / size))
  const href = (p: number) => `/admin/emails/?${new URLSearchParams({ ...(status ? { status } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`
  return (
    <>
      <AdminHeader title="Emails" lead="The email outbox: every alert the site sends. Failed emails can be queued again after the cause is fixed.">
        <nav className="seg" aria-label="Filter by status">
          <Link href="/admin/emails/" aria-current={!status ? 'page' : undefined}>All</Link>
          {STATUSES.map((s) => <Link key={s} href={`/admin/emails/?status=${s}`} aria-current={s === status ? 'page' : undefined}>{s}</Link>)}
        </nav>
      </AdminHeader>
      {rows.length === 0 ? <EmptyState title="No emails here." /> : (
        <>
          <div className="table-wrap">
            <table className="dt">
              <caption className="sr-only">Email outbox, newest first</caption>
              <thead><tr><th scope="col">Created</th><th scope="col">Template</th><th scope="col">To</th><th scope="col">Status</th><th scope="col" className="n">Attempts</th><th scope="col">Last error</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} data-email-id={e.id}>
                    <td className="nowrap" title={e.created_at}>{fmtAgo(e.created_at)}</td>
                    <td className="nowrap">{e.template.replace(/_/g, ' ')}</td>
                    <td className="nowrap">{maskEmail(e.to_email)}</td>
                    <td className="nowrap"><StatusBadge status={e.status} />{e.sent_at && <span className="muted ml-1 text-xs">{fmtAgo(e.sent_at)}</span>}</td>
                    <td className="n">{e.attempts}</td>
                    <td>{e.last_error ? <span className="err-text">{e.last_error.slice(0, 200)}</span> : <span className="muted">—</span>}</td>
                    <td>{e.status === 'failed' && <ActionButton action={retryEmail.bind(null, e.id)} label="Retry" ariaLabel={`Retry email ${e.id}`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} total={total} href={href} />
        </>
      )}
    </>
  )
}
