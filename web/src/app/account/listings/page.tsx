import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice, QuotaMeter, StatusChip, UpgradePrompt } from '@/components/account/bits'
import { ListingActions } from '@/components/account/ListingActions'
import { Pagination } from '@/components/Pagination'
import { EmptyState } from '@/components/ui'
import { pageCount, slicePage, TABLE_PAGE_SIZE } from '@/lib/paging'
import { pageNumber } from '@/lib/seo/metadata'
import { fmtAud2, fmtDate, LangBadge } from '@/components/Format'
import { getAccount, myListings } from '@/lib/account/data'
import { audFromCents, gradeText, LISTING_TYPE_LABEL, listingActions, listingStatusChip } from '@/lib/account/format'
import { one, requireMember } from '@/lib/account/gate'
import { listingPath } from '@/lib/seo/urls'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My listings' }

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'pending_review', label: 'Pending' },
  { key: 'active', label: 'Active' },
  { key: 'sold', label: 'Sold' },
  { key: 'expired', label: 'Expired' },
  { key: 'rejected', label: 'Rejected' },
] as const

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function MyListings({ searchParams }: Props) {
  const sp = await searchParams
  const status = one(sp.status) ?? 'all'
  const m = await requireMember(`/account/listings/${status !== 'all' ? `?status=${status}` : ''}`)
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect('/login/?next=/account/listings/')
  const all = await myListings(acct.userId)
  const matching = all.filter((l) => (status === 'all' ? l.status !== 'removed' : l.status === status))
  const page = Math.min(pageNumber(sp), pageCount(matching.length, TABLE_PAGE_SIZE))
  const rows = slicePage(matching, page, TABLE_PAGE_SIZE)
  const blocked = acct.quota.used >= acct.quota.limit

  return (
    <div className="container-x pb-16">
      <AccountHead
        eyebrow="Marketplace"
        title="My listings"
        actions={<Link href="/account/listings/new/" className="btn btn-primary">Create listing</Link>}
      />
      <div className="panel mb-6">
        <QuotaMeter used={acct.quota.used} limit={acct.quota.limit} resetsAt={acct.quota.resetsAt} timeZone={acct.timezone} />
        {blocked && acct.tier === 'free' && (
          <div className="mt-4"><UpgradePrompt compact freeQuota={acct.rules.freeQuota} premiumQuota={acct.rules.premiumQuota} price={audFromCents(acct.rules.premiumMonthlyCents)} /></div>
        )}
      </div>

      <div className="seg-wrap mb-4">
        <nav className="seg" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Link key={f.key} href={f.key === 'all' ? '/account/listings/' : `/account/listings/?status=${f.key}`} aria-current={status === f.key ? 'page' : undefined}>
              {f.label}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={status === 'all' ? 'No listings yet' : 'Nothing here'}
          body={status === 'all' ? 'List a graded card, raw card or sealed product. Every listing is checked by a moderator before it goes live.' : 'No listings with this status.'}
          action={<Link href="/account/listings/new/" className="btn btn-primary">Create your first listing</Link>}
        />
      ) : (
        <table className="dt dt-stack" data-testid="my-listings">
          <caption className="sr-only">Your listings</caption>
          <thead>
            <tr>
              <th scope="col">Listing</th>
              <th scope="col" className="n">Price</th>
              <th scope="col">Status</th>
              <th scope="col" className="c-date">Updated</th>
              <th scope="col" className="n"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const chip = listingStatusChip(l)
              return (
                <tr key={l.id} data-listing-id={l.id} data-status={chip.key}>
                  <td className="c-item">
                    <div className="flex items-center gap-3">
                      <span className="thumb-box">
                        {/* eslint-disable-next-line @next/next/no-img-element -- member's own upload */}
                        {l.thumbUrl ? <img src={l.thumbUrl} alt="" loading="lazy" /> : null}
                      </span>
                      <div className="min-w-0">
                        <p className="row-title">{l.title}</p>
                        <p className="card-meta">
                          <LangBadge lang={l.lang} />
                          <span>{LISTING_TYPE_LABEL[l.listingType]}</span>
                          {l.listingType === 'graded_single' && <span>· {gradeText(l.grader, l.grade)}</span>}
                          {l.listingType === 'raw_single' && l.condition && <span>· {l.condition}</span>}
                          {l.status === 'draft' && l.photoCount < acct.rules.minPhotos && <span>· {l.photoCount}/{acct.rules.minPhotos} photos</span>}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="n">{fmtAud2(l.priceAud)}{l.qty > 1 && <span className="muted text-xs"> × {l.qty}</span>}</td>
                  <td>
                    <StatusChip status={l.status} rejectionReason={l.rejectionReason} changeRequest={l.changeRequest} />
                    {l.status === 'active' && l.expiresAt && <p className="status-note">Expires {fmtDate(l.expiresAt)}</p>}
                  </td>
                  <td className="c-date muted text-xs">{fmtDate(l.updatedAt)}</td>
                  <td className="c-actions n">
                    <ListingActions id={l.id} title={l.title} actions={listingActions(l)} viewHref={listingPath(l.id, l.title)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <Pagination basePath="/account/listings/" page={page} total={matching.length} pageSize={TABLE_PAGE_SIZE} params={{ status: status !== 'all' ? status : undefined }} noun="listings" />
    </div>
  )
}
