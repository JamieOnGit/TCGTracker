import Link from 'next/link'
import { ActionButton } from '@/components/admin/ActionButton'
import { ActionForm } from '@/components/admin/ActionForm'
import { AdminHeader, StatusBadge } from '@/components/admin/bits'
import { fmtAud2 } from '@/components/Format'
import { rejectSightingForm, reviewSighting } from '@/lib/actions/sightings'
import { fmtAgo } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'
import { sightingPhotoUrl } from '@/lib/data/drops'

export const metadata = { title: 'Sightings' }

const COLS =
  'id,user_id,channel,state,suburb,store_name,game,product,price_aud,quantity,purchase_limit,url,photo_path,note,status,' +
  'confirm_count,gone_count,flag_count,gone_at,created_at,confirmed_at,reject_reason,retailers(name),reporter:profiles!sightings_user_id_fkey(username)'

/** ISO timestamp `h` hours ago (outside render so React's purity rule is happy; these pages are dynamic). */
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST rows */
type Row = any

export default async function AdminSightings() {
  const { sb } = await requireSection('sightings')
  const since = hoursAgo(48)
  const [pending, flagged, recent] = await Promise.all([
    sb.from('sightings').select(COLS).eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
    sb.from('sightings').select(COLS).gt('flag_count', 0).in('status', ['pending', 'confirmed']).order('flag_count', { ascending: false }).limit(50),
    sb.from('sightings').select(COLS).eq('status', 'confirmed').gte('confirmed_at', since).order('confirmed_at', { ascending: false }).limit(50),
  ])
  const flaggedRows = (flagged.data ?? []) as Row[]
  const flaggedIds = new Set(flaggedRows.map((r) => r.id))
  const pendingRows = ((pending.data ?? []) as Row[]).filter((r) => !flaggedIds.has(r.id))
  const recentRows = ((recent.data ?? []) as Row[]).filter((r) => !flaggedIds.has(r.id))
  // Scout record per reporter (scout_stats is security definer and callable by staff).
  const reporters = [...new Set([...flaggedRows, ...pendingRows, ...recentRows].map((r) => r.user_id as string))]
  const stats = new Map<string, { confirmed: number; rejected: number; trusted: boolean }>()
  await Promise.all(
    reporters.map(async (id) => {
      const { data } = await sb.rpc('scout_stats', { p_user: id })
      const s = (data ?? [])[0]
      if (s) stats.set(id, s)
    }),
  )

  return (
    <>
      <AdminHeader
        title="Sightings"
        lead="Member reports of stock in store or online. Confirming sends the alert (Premium now, Free after their delay); rejecting withdraws any alert already queued. Pending reports expire after 6 hours."
      >
        <Link className="btn btn-secondary btn-sm" href="/drops/?source=member">Public feed</Link>
      </AdminHeader>
      <Queue title="Flagged as fake" id="flag" rows={flaggedRows} stats={stats} empty="Nothing flagged." />
      <Queue title="Waiting for confirmation" id="pend" rows={pendingRows} stats={stats} empty="No pending reports." />
      <Queue title="Confirmed in the last 48 hours" id="conf" rows={recentRows} stats={stats} empty="No confirmed sightings in the last 48 hours." />
    </>
  )
}

function Queue({ title, id, rows, stats, empty }: { title: string; id: string; rows: Row[]; stats: Map<string, { confirmed: number; rejected: number; trusted: boolean }>; empty: string }) {
  return (
    <section className="admin-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="admin-h2">{title} <span className="muted text-sm">({rows.length})</span></h2>
      {rows.length === 0 ? <p className="muted mt-2 text-sm">{empty}</p> : (
        <div className="table-wrap mt-3">
          <table className="dt">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Photo</th><th scope="col">Report</th><th scope="col">Reporter</th><th scope="col">Votes</th>
                <th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const photo = sightingPhotoUrl(r.photo_path)
                const st = stats.get(r.user_id)
                const place = r.channel === 'online' ? 'Online' : [r.store_name, r.suburb, r.state].filter(Boolean).join(', ')
                return (
                  <tr key={r.id} data-sighting={r.id}>
                    <td>
                      {photo ? (
                        <a href={photo} target="_blank" rel="noopener">
                          {/* eslint-disable-next-line @next/next/no-img-element -- member upload from Storage */}
                          <img src={photo} alt={`Photo for report ${r.id}`} width={64} height={64} style={{ objectFit: 'cover', border: '1px solid var(--line-strong)' }} loading="lazy" />
                        </a>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="wrap">
                      <span className="font-medium">{r.product}</span> <span className="muted text-xs">{r.game === 'one-piece' ? 'One Piece' : 'Pokémon'}</span>
                      <p className="muted text-xs">
                        {r.retailers?.name} · {r.channel === 'online' && r.url ? <a className="prose-link" href={r.url} target="_blank" rel="nofollow noopener">{r.url.slice(0, 60)}</a> : place}
                        {r.price_aud !== null ? ` · ${fmtAud2(Number(r.price_aud))}` : ''}{r.quantity ? ` · ${r.quantity}` : ''}{r.purchase_limit ? ` · limit ${r.purchase_limit}` : ''}
                      </p>
                      {r.note && <p className="text-xs">&ldquo;{r.note}&rdquo;</p>}
                      <p className="muted text-xs">Reported {fmtAgo(r.created_at)}</p>
                    </td>
                    <td className="nowrap">
                      {r.reporter?.username ? <Link className="prose-link" href={`/admin/users/${r.user_id}/`}>@{r.reporter.username}</Link> : '—'}
                      {st && <p className="muted text-xs">{st.confirmed} confirmed · {st.rejected} rejected{st.trusted ? ' · trusted' : ''}</p>}
                    </td>
                    <td className="nowrap text-xs">
                      {r.confirm_count} confirm · {r.gone_count} sold out
                      {r.flag_count > 0 && <p className="admin-warn-text">{r.flag_count} flagged fake</p>}
                    </td>
                    <td className="nowrap">
                      <StatusBadge status={r.status} />
                      {r.gone_at && <p className="muted text-xs">sold out {fmtAgo(r.gone_at)}</p>}
                    </td>
                    <td>
                      <div className="grid gap-2">
                        {r.status === 'pending' && <ActionButton action={reviewSighting.bind(null, r.id, 'confirm', null)} label="Confirm" variant="primary" confirm="Confirm this sighting and send the alert?" ariaLabel={`Confirm report ${r.id}`} />}
                        {r.status === 'confirmed' && !r.gone_at && <ActionButton action={reviewSighting.bind(null, r.id, 'gone', null)} label="Mark sold out" ariaLabel={`Mark report ${r.id} sold out`} />}
                        <ActionForm action={rejectSightingForm.bind(null, r.id)} submitLabel="Reject" submitVariant="danger" className="admin-inline" ariaLabel={`Reject report ${r.id}`}>
                          <label className="sr-only" htmlFor={`rr-${r.id}`}>Reason</label>
                          <input id={`rr-${r.id}`} name="reason" className="input input-sm" required maxLength={200} placeholder="Reason" />
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
