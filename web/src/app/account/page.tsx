import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice, QuotaMeter, TierLabel, UpgradePrompt } from '@/components/account/bits'
import { fmtDate } from '@/components/Format'
import { getAccount, myListings, notifications, unreadMessageCount } from '@/lib/account/data'
import { audFromCents, relativeTime, summariseListings } from '@/lib/account/format'
import { requireMember } from '@/lib/account/gate'
import { signOut } from '@/lib/actions/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your account' }

export default async function AccountHome() {
  const m = await requireMember('/account/')
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect('/login/?next=/account/')
  const [listings, unread, recent] = await Promise.all([myListings(acct.userId), unreadMessageCount(), notifications(5)])
  const s = summariseListings(listings)
  const name = acct.displayName || acct.username
  const blocked = acct.quota.used >= acct.quota.limit

  return (
    <div className="container-x pb-16">
      <AccountHead
        eyebrow="Your account"
        title={`G'day, ${name}`}
        lead={
          <span className="inline-flex flex-wrap items-center gap-2">
            <TierLabel tier={acct.tier} />
            <span>@{acct.username} · member since {fmtDate(acct.memberSince)}</span>
          </span>
        }
        actions={
          <>
            <Link href="/account/listings/new/" className="btn btn-primary">Sell a card</Link>
            <form action={signOut}>
              <button type="submit" className="btn btn-secondary">Sign out</button>
            </form>
          </>
        }
      />

      <div className="acct-grid">
        <div>
          <section className="panel" aria-labelledby="quota-h">
            <div className="panel-title">
              <h2 id="quota-h">Listing quota</h2>
              <span className="text-sm muted">{acct.tier === 'premium' ? 'Premium' : 'Free'} plan</span>
            </div>
            <QuotaMeter used={acct.quota.used} limit={acct.quota.limit} resetsAt={acct.quota.resetsAt} timeZone={acct.timezone} />
            <p className="muted mt-3 text-xs">A listing counts when you submit it for review (rejected ones too). Unused listings don&apos;t roll over.</p>
            {blocked && acct.tier === 'free' && (
              <div className="mt-4">
                <UpgradePrompt compact freeQuota={acct.rules.freeQuota} premiumQuota={acct.rules.premiumQuota} price={audFromCents(acct.rules.premiumMonthlyCents)} />
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="listings-h">
            <div className="panel-title">
              <h2 id="listings-h">My listings</h2>
              <Link href="/account/listings/" className="prose-link">Manage</Link>
            </div>
            <div className="tiles">
              <Link href="/account/listings/?status=active"><span className="n">{s.active}</span><span className="l">Active</span></Link>
              <Link href="/account/listings/?status=pending_review"><span className="n">{s.pending_review}</span><span className="l">Pending review</span></Link>
              <Link href="/account/listings/?status=draft"><span className="n">{s.draft + s.changes_requested}</span><span className="l">Drafts{s.changes_requested ? ` · ${s.changes_requested} need changes` : ''}</span></Link>
              <Link href="/account/listings/?status=sold"><span className="n">{s.sold}</span><span className="l">Sold</span></Link>
            </div>
            {(s.expired > 0 || s.rejected > 0) && (
              <p className="muted mt-3 text-sm">
                {s.expired > 0 && <><Link className="prose-link" href="/account/listings/?status=expired">{s.expired} expired</Link> (renew in one click). </>}
                {s.rejected > 0 && <><Link className="prose-link" href="/account/listings/?status=rejected">{s.rejected} not approved</Link>.</>}
              </p>
            )}
          </section>

          <section className="panel" aria-labelledby="notif-h">
            <div className="panel-title">
              <h2 id="notif-h">Recent notifications</h2>
              <Link href="/account/notifications/" className="prose-link">See all</Link>
            </div>
            {recent.length === 0 ? (
              <p className="muted text-sm">Nothing yet. We&apos;ll let you know about messages, listing reviews and alerts here.</p>
            ) : (
              <ul className="rows">
                {recent.map((n) => (
                  <li key={n.id}>
                    <Link href={n.url ?? '/account/notifications/'} className="row-link">
                      {n.readAt ? <span className="read-dot" /> : <span className="unread-dot" aria-label="Unread" />}
                      <span className="row-main">
                        <span className="row-title block">{n.title}</span>
                        {n.body && <span className="row-sub block truncate-1">{n.body}</span>}
                      </span>
                      <span className="row-meta">{relativeTime(n.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div>
          <section className="panel" aria-labelledby="msg-h">
            <div className="panel-title">
              <h2 id="msg-h">Messages</h2>
            </div>
            <p className="text-sm">
              {unread > 0 ? <><strong data-testid="unread-count">{unread}</strong> unread {unread === 1 ? 'message' : 'messages'}</> : 'No unread messages.'}
            </p>
            <Link href="/messages/" className="btn btn-secondary mt-4 w-full">Open inbox</Link>
          </section>

          <section className="panel" aria-labelledby="links-h">
            <h2 id="links-h" className="text-lg">Shortcuts</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              <li><Link className="prose-link" href="/account/alerts/">Wishlist, saved searches &amp; drop alerts</Link></li>
              <li><Link className="prose-link" href="/account/settings/">Profile &amp; notification preferences</Link></li>
              <li><Link className="prose-link" href="/account/billing/">{acct.tier === 'premium' ? 'Manage billing' : 'Upgrade to Premium'}</Link></li>
              <li><Link className="prose-link" href={`/sellers/${acct.username}/`}>Your public seller page</Link></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
