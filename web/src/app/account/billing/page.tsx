import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice, TierLabel } from '@/components/account/bits'
import { fmtDate } from '@/components/Format'
import { getAccount } from '@/lib/account/data'
import { audFromCents } from '@/lib/account/format'
import { one, requireMember } from '@/lib/account/gate'
import { openBillingPortal, startCheckout } from '@/lib/actions/billing'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Billing' }

const STATUS_LABEL: Record<string, string> = {
  none: 'Free plan',
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment failed',
  unpaid: 'Unpaid',
  canceled: 'Cancelled',
  incomplete: 'Payment incomplete',
  incomplete_expired: 'Payment expired',
  paused: 'Paused',
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function Billing({ searchParams }: Props) {
  const sp = await searchParams
  const m = await requireMember('/account/billing/')
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect('/login/?next=/account/billing/')
  const { sub, tier, rules } = acct
  const price = audFromCents(rules.premiumMonthlyCents)
  const pastDue = sub.status === 'past_due'
  const inGrace = pastDue && sub.graceUntil && new Date(sub.graceUntil) > new Date()
  const paying = ['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)

  return (
    <div className="container-x pb-16" style={{ maxWidth: 880 }}>
      <AccountHead eyebrow="Billing" title="Membership & billing" />
      <div className="grid gap-4">
        {one(sp.welcome) === '1' && (
          <div className="notice notice-up" role="status" data-testid="welcome">
            <strong>Welcome to Premium ◆</strong> Thanks for supporting TCGTracker. Your badge, 30 listings a month and instant drop alerts are switching on now; it can take a minute for the payment to confirm.
          </div>
        )}
        {one(sp.error) === 'unavailable' && (
          <div className="notice notice-warn" role="alert">Online payments aren&apos;t available right now. Please try again later or contact support.</div>
        )}
        {pastDue && (
          <div className="notice notice-warn" role="alert">
            <strong>Your last payment didn&apos;t go through.</strong>{' '}
            {inGrace
              ? <>Premium stays on until {fmtDate(sub.graceUntil)} while Stripe retries. Update your card to avoid dropping to Free.</>
              : <>Your grace period has ended, so your account is on the Free plan. Update your card to restore Premium.</>}
          </div>
        )}

        <section className="panel" aria-labelledby="plan-h">
          <div className="panel-title">
            <h2 id="plan-h">Current plan</h2>
            <TierLabel tier={tier} />
          </div>
          <dl className="review-list">
            <dt>Plan</dt><dd>{tier === 'premium' ? `Premium · ${price}/month incl. GST` : 'Free'}</dd>
            <dt>Status</dt><dd>{STATUS_LABEL[sub.status] ?? sub.status}</dd>
            {sub.currentPeriodEnd && paying && (
              <>
                <dt>{sub.cancelAtPeriodEnd ? 'Premium ends' : 'Renews'}</dt>
                <dd>{fmtDate(sub.currentPeriodEnd)}{sub.cancelAtPeriodEnd ? ' (cancelled; you won’t be charged again)' : ''}</dd>
              </>
            )}
            <dt>Listings</dt><dd>{acct.quota.limit} per month ({acct.quota.used} used)</dd>
            <dt>Drop alerts</dt><dd>{tier === 'premium' ? 'Instant' : '5 minutes after each drop'}</dd>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            {tier === 'free' && !paying && (
              <form action={startCheckout}>
                <button type="submit" className="btn btn-holo">Upgrade to Premium · {price}/mo</button>
              </form>
            )}
            {sub.hasCustomer && (
              <form action={openBillingPortal}>
                <button type="submit" className={tier === 'premium' ? 'btn btn-primary' : 'btn btn-secondary'}>Manage billing</button>
              </form>
            )}
            <Link href="/premium/" className="btn btn-ghost self-center">What&apos;s in Premium</Link>
          </div>
          {sub.hasCustomer && <p className="muted mt-4 text-xs">Manage billing opens Stripe&apos;s secure portal: update your card, download tax invoices, or cancel in two clicks.</p>}
        </section>

        {tier === 'free' && (
          <section className="upgrade-card" aria-labelledby="why-h">
            <p className="eyebrow"><span className="holo-text">◆ Premium</span></p>
            <h2 id="why-h" className="mt-2 text-lg">{price} a month, GST included</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              <li>Up to {rules.premiumQuota} marketplace listings a month (Free: {rules.freeQuota})</li>
              <li>Instant retail drop alerts from JB Hi-Fi, BIG W, Kmart, Target, EB Games and Premium Bandai</li>
              <li>◆ Premium badge on your profile and listings</li>
              <li>Cancel any time; Premium stays on until the end of the month you&apos;ve paid for</li>
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
