import Link from 'next/link'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { EmptyState } from '@/components/ui'
import { fmtAud } from '@/components/Format'
import { inbox } from '@/lib/account/data'
import { relativeTime } from '@/lib/account/format'
import { requireMember } from '@/lib/account/gate'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Messages' }

export default async function Inbox() {
  const m = await requireMember('/messages/')
  if (!m) return <DemoNotice />
  const rows = await inbox(m.id)
  const unread = rows.reduce((n, r) => n + r.unread, 0)
  return (
    <div className="container-x pb-16" style={{ maxWidth: 960 }}>
      <AccountHead eyebrow="Messages" title="Inbox" lead={unread > 0 ? `${unread} unread ${unread === 1 ? 'message' : 'messages'}.` : 'Conversations with buyers and sellers, one per listing.'} />
      {rows.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          body="When you message a seller, or a buyer messages you about a listing, the conversation shows up here."
          action={<Link href="/marketplace/" className="btn btn-primary">Browse the marketplace</Link>}
        />
      ) : (
        <ul className="rows" data-testid="inbox">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/messages/${r.id}/`} className="row-link" data-conversation-id={r.id} aria-label={`${r.listingTitle ?? 'Listing'} with @${r.otherUsername}${r.unread ? `, ${r.unread} unread` : ''}`}>
                {r.unread > 0 ? <span className="unread-dot" aria-hidden="true" /> : <span className="read-dot" />}
                <span className="row-main">
                  <span className="row-title block truncate-1">{r.listingTitle ?? 'Listing no longer available'}</span>
                  <span className="row-sub block">
                    @{r.otherUsername} · {r.role === 'seller' ? 'buyer' : 'seller'}
                    {r.listingPriceAud !== null && <> · {fmtAud(r.listingPriceAud)}</>}
                    {r.listingStatus && r.listingStatus !== 'active' && <> · {r.listingStatus === 'sold' ? 'sold' : 'closed'}</>}
                  </span>
                  {r.preview && <span className="row-sub block truncate-1" style={{ color: r.unread ? 'var(--ink)' : undefined }}>{r.preview}</span>}
                </span>
                <span className="row-meta">
                  <span>{relativeTime(r.lastMessageAt)}</span>
                  {r.unread > 0 && <span className="count-pill" data-testid="unread-badge">{r.unread}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
