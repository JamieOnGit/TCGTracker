import Link from 'next/link'
import { ActionButton } from '@/components/admin/ActionButton'
import { ActionForm } from '@/components/admin/ActionForm'
import { AdminHeader, LangTag } from '@/components/admin/bits'
import { ListingQueue } from '@/components/admin/ListingQueue'
import { ReassignCard } from '@/components/admin/ReassignCard'
import { fmtAud, fmtDate, gradeLabel } from '@/components/Format'
import { EmptyState } from '@/components/ui'
import { expireListing, extendListing, featureListing, removeListingForm } from '@/lib/actions/admin'
import { listingImageUrl, liveListings, pendingQueue } from '@/lib/admin/data'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Listings' }

type SP = Promise<Record<string, string | string[] | undefined>>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const LIVE_STATUSES = ['active', 'expired', 'sold', 'removed', 'rejected'] as const

export default async function AdminListings({ searchParams }: { searchParams: SP }) {
  const { sb } = await requireSection('listings')
  const sp = await searchParams
  const tab = one(sp.tab) === 'live' ? 'live' : 'queue'
  const q = one(sp.q)?.slice(0, 80)
  const status = LIVE_STATUSES.find((s) => s === one(sp.status)) ?? 'active'

  return (
    <>
      <AdminHeader title="Listings" lead="Approve new listings, oldest first. Every decision is audit-logged and emails the seller.">
        <nav className="seg" aria-label="Listing views">
          <Link href="/admin/listings/" aria-current={tab === 'queue' ? 'page' : undefined}>Approval queue</Link>
          <Link href="/admin/listings/?tab=live" aria-current={tab === 'live' ? 'page' : undefined}>Live listings</Link>
        </nav>
      </AdminHeader>
      {tab === 'queue' ? <Queue sb={sb} /> : <Live sb={sb} q={q} status={status} />}
    </>
  )
}

async function Queue({ sb }: { sb: Awaited<ReturnType<typeof requireSection>>['sb'] }) {
  const items = await pendingQueue(sb)
  if (!items.length) return <EmptyState title="The queue is clear." body="New listings appear here as soon as a seller submits them." />
  return <ListingQueue items={items.map((l) => ({ ...l, imageUrls: l.images.map((i) => ({ url: listingImageUrl(i.storage_path), kind: i.kind })) }))} />
}

async function Live({ sb, q, status }: { sb: Awaited<ReturnType<typeof requireSection>>['sb']; q?: string; status: string }) {
  const rows = await liveListings(sb, q, status)
  return (
    <>
      <form className="admin-inline" role="search" action="/admin/listings/">
        <input type="hidden" name="tab" value="live" />
        <div className="field">
          <label htmlFor="lq">Search title or listing #</label>
          <input id="lq" name="q" className="input" defaultValue={q} type="search" />
        </div>
        <div className="field" style={{ flex: '0 1 160px' }}>
          <label htmlFor="ls">Status</label>
          <select id="ls" name="status" className="select" defaultValue={status}>
            {LIVE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn btn-secondary btn-sm" type="submit">Search</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No listings match." />
      ) : (
        <div className="table-wrap mt-6">
          <table className="dt">
            <caption className="sr-only">Listings with status {status}</caption>
            <thead>
              <tr>
                <th scope="col">Listing</th><th scope="col">Card</th><th scope="col">Grade</th><th scope="col" className="n">Price</th>
                <th scope="col">Expires</th><th scope="col">Featured</th><th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const featured = l.featured
                return (
                  <tr key={l.id} data-listing-id={l.id}>
                    <td className="wrap">
                      <Link className="prose-link font-medium" href={`/marketplace/listing/${l.id}/`}>{l.title}</Link>
                      <p className="muted text-xs">#{l.id} · @{l.seller?.username ?? '?'}</p>
                    </td>
                    <td className="wrap">
                      {l.card ? <>{l.card.name} <span className="muted text-xs">#{l.card.number} · {l.card.set?.code}</span></> : <span className="muted">sealed</span>}
                      <div className="mt-1"><LangTag lang={l.lang} /></div>
                    </td>
                    <td className="nowrap">{gradeLabel(l.grade_key)}</td>
                    <td className="n">{fmtAud(l.price_aud)}</td>
                    <td className="nowrap">{fmtDate(l.expires_at)}</td>
                    <td className="nowrap">{featured ? <span className="badge badge-premium">Until {fmtDate(l.featured_until)}</span> : <span className="muted">—</span>}</td>
                    <td>
                      {l.status === 'active' ? (
                        <div className="cell-actions">
                          {featured ? (
                            <ActionButton action={featureListing.bind(null, l.id, 0)} label="Unfeature" />
                          ) : (
                            <ActionButton action={featureListing.bind(null, l.id, 7)} label="Feature 7d" />
                          )}
                          <ActionButton action={extendListing.bind(null, l.id, 30)} label="Extend 30d" />
                          <ActionButton action={expireListing.bind(null, l.id)} label="Expire" confirm={`Expire listing #${l.id} now?`} />
                          <details>
                            <summary className="btn btn-ghost">Remove…</summary>
                            <ActionForm action={removeListingForm.bind(null, l.id)} submitLabel="Remove listing" submitVariant="danger" className="queue-panel">
                              <div className="field">
                                <label htmlFor={`rm-${l.id}`}>Reason (sent to the seller)</label>
                                <input id={`rm-${l.id}`} name="reason" className="input" required maxLength={500} />
                              </div>
                            </ActionForm>
                          </details>
                          {l.card && <ReassignCard id={l.id} game={l.card.game} lang={l.lang} />}
                        </div>
                      ) : (
                        <span className="muted text-xs">No actions for {l.status}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
