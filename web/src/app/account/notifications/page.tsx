import Link from 'next/link'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { EmptyState } from '@/components/ui'
import { notifications } from '@/lib/account/data'
import { relativeTime } from '@/lib/account/format'
import { requireMember } from '@/lib/account/gate'
import { markNotificationsRead } from '@/lib/actions/alerts'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Notifications' }

const TYPE_LABEL: Record<string, string> = {
  message: 'Message',
  listing_status: 'Listing',
  listing_expiring: 'Listing',
  wishlist: 'Wishlist',
  saved_search: 'Saved search',
  drop: 'Retail drop',
  billing: 'Billing',
  system: 'TCGTracker',
}

export default async function Notifications() {
  const m = await requireMember('/account/notifications/')
  if (!m) return <DemoNotice />
  const list = await notifications(100)
  const unread = list.filter((n) => !n.readAt).length
  // Viewing the list marks everything read (the bell clears on the next page load).
  if (unread > 0) await markNotificationsRead()

  return (
    <div className="container-x pb-16" style={{ maxWidth: 880 }}>
      <AccountHead
        eyebrow="Notifications"
        title="Notifications"
        lead={unread > 0 ? `${unread} new since your last visit.` : 'You’re all caught up.'}
        actions={<Link href="/account/settings/#notifications" className="btn btn-secondary">Preferences</Link>}
      />
      {list.length === 0 ? (
        <EmptyState title="No notifications yet" body="Messages, listing reviews, wishlist matches and drop alerts appear here, and by email if you want them." />
      ) : (
        <ul className="rows" data-testid="notifications">
          {list.map((n) => (
            <li key={n.id}>
              <Link href={n.url ?? '/account/'} className="row-link">
                {n.readAt ? <span className="read-dot" /> : <span className="unread-dot" aria-label="New" />}
                <span className="row-main">
                  <span className="tag-quiet block">{TYPE_LABEL[n.type] ?? n.type}</span>
                  <span className="row-title mt-1 block">{n.title}</span>
                  {n.body && <span className="row-sub block">{n.body}</span>}
                </span>
                <span className="row-meta">{relativeTime(n.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
