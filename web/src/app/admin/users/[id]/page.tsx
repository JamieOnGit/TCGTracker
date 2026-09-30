import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionButton } from '@/components/admin/ActionButton'
import { ActionForm } from '@/components/admin/ActionForm'
import { AdminHeader, StatusBadge } from '@/components/admin/bits'
import { fmtAud, fmtDate, gradeLabel } from '@/components/Format'
import { saveUserOverridesForm, setUserStatus, suspendUserForm } from '@/lib/actions/admin'
import { can } from '@/lib/admin/access'
import { userDetail } from '@/lib/admin/data'
import { requireSection } from '@/lib/admin/guard'
import { effectiveTier, type StripeStatus } from '@/lib/domain/tier'

export const metadata = { title: 'Member' }

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { me, sb } = await requireSection('users', `/admin/users/${id}/`)
  const isAdmin = me.role === 'admin'
  const u = await userDetail(sb, id, isAdmin)
  if (!u) notFound()
  const { profile, priv } = u
  // Same rules as public.effective_tier(); moderators can't read subscriptions, so they only see override / scout-reward Premium.
  const premiumUntil = priv?.premium_until ? new Date(priv.premium_until) : null
  const rewardActive = Boolean(premiumUntil && premiumUntil > new Date())
  const tier = isAdmin || priv?.tier_override || rewardActive
    ? effectiveTier({ status: (u.sub?.status ?? 'none') as StripeStatus, graceUntil: u.sub?.grace_until ? new Date(u.sub.grace_until) : null, tierOverride: priv?.tier_override ?? null, premiumUntil })
    : null
  const self = me.id === id

  return (
    <>
      <AdminHeader title={`@${profile.username}`} lead={<><Link className="prose-link" href="/admin/users/">All users</Link> · joined {fmtDate(profile.created_at)}</>}>
        <Link className="btn btn-secondary btn-sm" href={`/sellers/${profile.username}/`}>Public profile</Link>
      </AdminHeader>

      <div className="admin-grid-2">
        <section className="admin-panel" aria-labelledby="p-h">
          <h2 id="p-h" className="admin-h2">Profile</h2>
          <dl className="kv mt-3">
            <dt>Email</dt><dd>{u.email ?? '—'}</dd>
            <dt>Display name</dt><dd>{profile.display_name ?? '—'}</dd>
            <dt>State</dt><dd>{profile.location_state ?? '—'}</dd>
            <dt>Role</dt><dd>{priv?.role ?? 'user'}</dd>
            <dt>Status</dt><dd><StatusBadge status={priv?.status ?? 'active'} />{priv?.suspended_until && <span className="muted ml-2 text-xs">until {fmtDate(priv.suspended_until)}</span>}</dd>
            <dt>Tier</dt><dd>{tier ?? '—'}{priv?.tier_override && <span className="muted ml-1 text-xs">(override)</span>}{rewardActive && premiumUntil && <span className="muted ml-1 text-xs">(scout reward until {fmtDate(premiumUntil.toISOString())})</span>}</dd>
            {u.sub && <><dt>Subscription</dt><dd>{u.sub.status}{u.sub.current_period_end ? ` · renews ${fmtDate(u.sub.current_period_end)}` : ''}{u.sub.cancel_at_period_end ? ' · cancels at period end' : ''}</dd></>}
            <dt>Quota</dt><dd className="num">{u.quota.used ?? '—'} of {u.quota.limit ?? '—'} used this period{priv?.quota_override !== null && priv?.quota_override !== undefined ? ' (override)' : ''}</dd>
            <dt>Trusted seller</dt><dd>{priv?.trusted_seller ? 'yes' : 'no'}</dd>
          </dl>
        </section>

        <section className="admin-panel" aria-labelledby="m-h">
          <h2 id="m-h" className="admin-h2">Moderation</h2>
          {self ? (
            <p className="muted mt-3 text-sm">You can’t suspend or ban yourself.</p>
          ) : can.suspendOrBan(me.role) ? (
            <div className="mt-3 grid gap-4">
              <ActionForm action={suspendUserForm.bind(null, id)} submitLabel="Suspend" className="admin-inline">
                <div className="field" style={{ flex: '0 1 140px' }}>
                  <label htmlFor="sd">Suspend for (days)</label>
                  <input id="sd" name="days" type="number" min={1} max={365} defaultValue={7} className="input" required />
                </div>
              </ActionForm>
              <div className="flex flex-wrap gap-2">
                <ActionButton action={setUserStatus.bind(null, id, 'banned', undefined)} label="Ban" variant="danger" confirm={`Ban @${profile.username}? They will not be able to sign in to list or message.`} />
                {priv?.status !== 'active' && <ActionButton action={setUserStatus.bind(null, id, 'active', undefined)} label="Reactivate" />}
              </div>
            </div>
          ) : null}

          {isAdmin && (
            <>
              <h3 className="admin-h2 mt-8 text-base">Overrides</h3>
              <ActionForm action={saveUserOverridesForm.bind(null, id)} submitLabel="Save overrides">
                <div className="admin-grid-3">
                  <div className="field">
                    <label htmlFor="ot">Tier override</label>
                    <select id="ot" name="tier" className="select" defaultValue={priv?.tier_override ?? ''}>
                      <option value="">None (use subscription)</option>
                      <option value="free">Free</option>
                      <option value="premium">Premium</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="oq">Quota override</label>
                    <input id="oq" name="quota" className="input" inputMode="numeric" defaultValue={priv?.quota_override ?? ''} placeholder="Tier default" />
                  </div>
                  <div className="field">
                    <label htmlFor="or">Role</label>
                    <select id="or" name="role" className="select" defaultValue={priv?.role ?? 'user'} disabled={self}>
                      <option value="user">User</option>
                      <option value="editor">Editor</option>
                      <option value="moderator">Moderator</option>
                      <option value="admin">Admin</option>
                    </select>
                    {self && <span className="hint">You can’t change your own role.</span>}
                  </div>
                </div>
              </ActionForm>
            </>
          )}
        </section>
      </div>

      <section className="admin-section mt-12" aria-labelledby="l-h">
        <h2 id="l-h" className="admin-h2">Listings ({u.listings.length})</h2>
        {u.listings.length === 0 ? <p className="muted text-sm">No listings.</p> : (
          <div className="table-wrap mt-3">
            <table className="dt">
              <caption className="sr-only">Listings by this member</caption>
              <thead><tr><th scope="col">Listing</th><th scope="col">Status</th><th scope="col">Grade</th><th scope="col" className="n">Price</th><th scope="col">Submitted</th></tr></thead>
              <tbody>
                {u.listings.map((l) => (
                  <tr key={l.id}>
                    <td className="wrap">{l.title} <span className="muted text-xs">#{l.id} · {l.lang.toUpperCase()}</span>{l.rejection_reason && <p className="muted text-xs">Rejected: {l.rejection_reason}</p>}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td className="nowrap">{gradeLabel(l.grade_key)}</td>
                    <td className="n">{fmtAud(Number(l.price_aud))}</td>
                    <td className="nowrap">{fmtDate(l.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-section" aria-labelledby="r-h">
        <h2 id="r-h" className="admin-h2">Reports about this member ({u.reportsAgainst.length})</h2>
        {u.reportsAgainst.length === 0 ? <p className="muted text-sm">None.</p> : (
          <div className="table-wrap mt-3">
            <table className="dt">
              <caption className="sr-only">Reports about this member or their listings</caption>
              <thead><tr><th scope="col">Target</th><th scope="col">Reason</th><th scope="col">Details</th><th scope="col">Status</th><th scope="col">Date</th></tr></thead>
              <tbody>
                {u.reportsAgainst.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{r.target_type} {r.target_type === 'listing' ? `#${r.target_id}` : ''}</td>
                    <td>{r.reason.replace(/_/g, ' ')}</td>
                    <td className="wrap text-xs">{r.details ?? '—'}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="nowrap">{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted mt-4 text-sm">Reports filed by this member: {u.reportsFiled.length}.</p>
      </section>
    </>
  )
}
