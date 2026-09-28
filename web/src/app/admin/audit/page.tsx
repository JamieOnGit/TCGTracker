import { AdminHeader, Pager } from '@/components/admin/bits'
import { EmptyState } from '@/components/ui'
import { auditLog, staffMembers } from '@/lib/admin/data'
import { jsonDiff, pageParam, shortJson } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Audit log' }

const TARGETS = ['listings', 'listing_images', 'reports', 'profile_private', 'profiles', 'site_settings', 'retailers', 'rrp_reference', 'watchlist', 'drop_events', 'mapping_queue', 'card_external_ids', 'cards', 'sets', 'sealed_products', 'redirects', 'price_points', 'banned_words', 'articles', 'article_tags', 'api_keys', 'conversations', 'email_outbox']
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function AdminAudit({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sb } = await requireSection('audit')
  const sp = await searchParams
  const actorRaw = one(sp.actor)
  const actor = actorRaw && /^[0-9a-f-]{36}$/i.test(actorRaw) ? actorRaw : undefined
  const target = TARGETS.find((t) => t === one(sp.target))
  const page = pageParam(sp.page)
  const [{ rows, total, size }, staff] = await Promise.all([auditLog(sb, { actor, target, page }), staffMembers(sb)])
  const pages = Math.max(1, Math.ceil(total / size))
  const href = (p: number) => `/admin/audit/?${new URLSearchParams({ ...(actor ? { actor } : {}), ...(target ? { target } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`
  return (
    <>
      <AdminHeader title="Audit log" lead="Every staff write, and every read of a reported conversation: who, what and when. Append-only." />
      <form className="admin-inline" action="/admin/audit/">
        <div className="field">
          <label htmlFor="aa">Actor</label>
          <select id="aa" name="actor" className="select" defaultValue={actor ?? ''}>
            <option value="">Anyone</option>
            {staff.map((s) => <option key={s.id} value={s.id}>@{s.username} ({s.role})</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="at">Target type</label>
          <select id="at" name="target" className="select" defaultValue={target ?? ''}>
            <option value="">All</option>
            {TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button className="btn btn-secondary btn-sm" type="submit">Filter</button>
      </form>
      {rows.length === 0 ? <EmptyState title="Nothing logged for this filter." /> : (
        <>
          <div className="table-wrap mt-6">
            <table className="dt">
              <caption className="sr-only">Audit log entries, newest first</caption>
              <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Change</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const diff = jsonDiff(r.before, r.after, 12)
                  return (
                    <tr key={r.id} data-action={r.action}>
                      <td className="nowrap text-xs" title={r.created_at}>{new Date(r.created_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className="nowrap">{r.actor ? `@${r.actor.username}` : r.actor_role ? 'deleted account' : 'system'} <span className="muted text-xs">{r.actor_role}</span></td>
                      <td className="nowrap font-medium">{r.action}</td>
                      <td className="nowrap text-xs">{r.target_type} <span className="muted">{r.target_id && r.target_id.length > 14 ? `${r.target_id.slice(0, 8)}…` : r.target_id}</span></td>
                      <td className="wrap">
                        {r.action === 'thread.read' ? <span className="text-xs">Read a reported conversation</span> : diff.length === 0 ? <span className="muted text-xs">no field changes</span> : (
                          <dl className="diff">
                            {diff.map((d) => (
                              <div key={d.key} style={{ display: 'contents' }}>
                                <dt>{d.key}</dt>
                                <dd>
                                  {d.before !== undefined && <del>{shortJson(d.before)}</del>}
                                  {d.before !== undefined && d.after !== undefined && ' → '}
                                  {d.after !== undefined && <ins>{shortJson(d.after)}</ins>}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} total={total} href={href} />
        </>
      )}
    </>
  )
}
