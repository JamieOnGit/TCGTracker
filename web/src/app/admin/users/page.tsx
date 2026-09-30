import Link from 'next/link'
import { AdminHeader, StatusBadge } from '@/components/admin/bits'
import { fmtDate } from '@/components/Format'
import { EmptyState } from '@/components/ui'
import { searchUsers } from '@/lib/admin/data'
import { maskEmail } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Users' }

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sb } = await requireSection('users')
  const raw = (await searchParams).q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 80)
  const rows = await searchUsers(sb, q)
  return (
    <>
      <AdminHeader title="Users" lead="Search by username or email. Emails are looked up server-side and shown masked in lists." />
      <form className="admin-inline" role="search" action="/admin/users/">
        <div className="field">
          <label htmlFor="uq">Username or email</label>
          <input id="uq" name="q" className="input" type="search" defaultValue={q} autoComplete="off" />
        </div>
        <button type="submit" className="btn btn-secondary btn-sm">Search</button>
      </form>
      {!q && <p className="muted mt-4 text-sm">Showing the 25 newest members.</p>}
      {rows.length === 0 ? (
        <EmptyState title="No members match." body="Try part of the username, or the full email address." />
      ) : (
        <div className="table-wrap mt-6">
          <table className="dt">
            <caption className="sr-only">Members</caption>
            <thead>
              <tr><th scope="col">Member</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Overrides</th><th scope="col">Joined</th></tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <th scope="row" className="nowrap"><Link className="prose-link font-medium" href={`/admin/users/${u.id}/`}>@{u.username}</Link></th>
                  <td className="nowrap">{maskEmail(u.email)}</td>
                  <td>{u.priv?.role ?? '—'}</td>
                  <td>
                    <StatusBadge status={u.priv?.status ?? 'unknown'} />
                    {u.priv?.status === 'suspended' && u.priv.suspended_until && <span className="muted ml-1 text-xs">until {fmtDate(u.priv.suspended_until)}</span>}
                  </td>
                  <td className="nowrap text-xs">
                    {u.priv?.tier_override ? `tier ${u.priv.tier_override}` : ''}
                    {u.priv?.quota_override !== null && u.priv?.quota_override !== undefined ? ` quota ${u.priv.quota_override}` : ''}
                    {!u.priv?.tier_override && (u.priv?.quota_override ?? null) === null && <span className="muted">—</span>}
                  </td>
                  <td className="nowrap">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
