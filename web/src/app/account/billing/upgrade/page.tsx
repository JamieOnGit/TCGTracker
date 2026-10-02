import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { getAccount } from '@/lib/account/data'
import { audFromCents } from '@/lib/account/format'
import { requireMember } from '@/lib/account/gate'
import { startCheckout } from '@/lib/actions/billing'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Upgrade to Premium' }

/** Target of every "Upgrade" link (/premium/, quota prompts). Checkout starts from a button, never on GET. */
export default async function Upgrade() {
  const m = await requireMember('/account/billing/upgrade/')
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect('/login/?next=/account/billing/upgrade/')
  if (acct.tier === 'premium' && ['active', 'trialing'].includes(acct.sub.status)) redirect('/account/billing/')
  const price = audFromCents(acct.rules.premiumMonthlyCents)
  return (
    <div className="container-x pb-16" style={{ maxWidth: 720 }}>
      <AccountHead eyebrow="◆ Premium" title="Upgrade to Premium" lead={`${price} per month in Australian dollars, GST included. Cancel any time.`} />
      <section className="upgrade-card">
        <ul className="grid gap-2 text-sm">
          <li>Up to {acct.rules.premiumQuota} listings a month instead of {acct.rules.freeQuota}</li>
          <li>Instant retail drop alerts (Free members get them 5 minutes later)</li>
          <li>◆ Premium badge on your profile and listings</li>
        </ul>
        <form action={startCheckout} className="mt-6">
          <button type="submit" className="btn btn-holo w-full sm:w-auto">Continue to secure checkout</button>
        </form>
        <p className="muted mt-4 text-xs">
          Payments are handled by Stripe; we never see your card. You&apos;ll get a tax invoice by email. Premium stays on until the end of the period you&apos;ve paid for if you cancel.
        </p>
      </section>
      <p className="mt-6"><Link href="/account/billing/" className="prose-link">Back to billing</Link></p>
    </div>
  )
}
