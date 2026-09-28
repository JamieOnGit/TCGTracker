import Link from 'next/link'
import { PremiumBadge } from '@/components/Format'
import { listingStatusChip, quotaLine, quotaPercent, type ListingStatus } from '@/lib/account/format'

export function StatusChip({ status, rejectionReason, changeRequest, showNote = true }: { status: ListingStatus; rejectionReason?: string | null; changeRequest?: string | null; showNote?: boolean }) {
  const chip = listingStatusChip({ status, rejectionReason, changeRequest })
  return (
    <div>
      <span className="chip-status" data-tone={chip.tone} data-status={chip.key}>{chip.label}</span>
      {showNote && chip.note && (
        <p className="status-note">
          <span className="sr-only">{chip.key === 'rejected' ? 'Reason: ' : 'Moderator note: '}</span>
          {chip.note}
        </p>
      )}
    </div>
  )
}

export function QuotaMeter({ used, limit, resetsAt, timeZone }: { used: number; limit: number; resetsAt: Date | null; timeZone?: string }) {
  const pct = quotaPercent(used, limit)
  const line = quotaLine(used, limit, resetsAt, timeZone)
  return (
    <div>
      <div className="meter" data-full={used >= limit} role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)} aria-label="Listings used this month" aria-valuetext={line}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="quota-line" data-testid="quota-line">{line}</p>
    </div>
  )
}

export function TierLabel({ tier }: { tier: 'free' | 'premium' }) {
  return tier === 'premium' ? <PremiumBadge /> : <span className="badge badge-raw">Free</span>
}

export function UpgradePrompt({ freeQuota = 5, premiumQuota = 30, price = 'A$12.99', compact = false }: { freeQuota?: number; premiumQuota?: number; price?: string; compact?: boolean }) {
  return (
    <div className="upgrade-card" role="region" aria-label="Upgrade to Premium">
      <p className="eyebrow"><span className="holo-text">◆ Premium</span></p>
      <p className={compact ? 'mt-2 text-sm' : 'serif mt-2 text-lg'}>
        You&apos;ve used this month&apos;s {freeQuota} free listings.
      </p>
      <p className="muted mt-2 text-sm">
        Premium lets you list up to {premiumQuota} a month, adds instant retail drop alerts and a ◆ badge on your listings. {price}/month incl. GST, cancel any time.
        Free listings reset on the 1st of each month.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/account/billing/upgrade/" className="btn btn-holo">Upgrade to Premium</Link>
        {!compact && <Link href="/premium/" className="btn btn-secondary">Compare plans</Link>}
      </div>
    </div>
  )
}

export function LangLabel({ lang }: { lang: string }) {
  return (
    <span className="lang-full" data-lang={lang} title={lang === 'jp' ? 'Japanese printing' : 'English printing'}>
      {lang === 'jp' ? 'JP · Japanese' : 'EN · English'}
    </span>
  )
}

export function AccountHead({ eyebrow, title, lead, actions }: { eyebrow?: string; title: string; lead?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="acct-head">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {lead && <p className="lead mt-3">{lead}</p>}
      </div>
      {actions && <div className="acct-actions">{actions}</div>}
    </div>
  )
}

export function DemoNotice() {
  return (
    <div className="container-x py-12">
      <div className="notice notice-warn">
        <strong>Demo mode.</strong> Accounts, listings and messages need the Supabase connection (set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY).
      </div>
    </div>
  )
}

export function AntiScamBanner({ compact = false }: { compact?: boolean }) {
  return (
    <aside className="notice notice-warn" aria-label="Stay safe">
      <strong>Contact details are hidden — keep payment on-platform.</strong>{' '}
      {compact
        ? 'Keep the conversation here and pay with buyer protection (e.g. PayPal Goods & Services). Never use Friends & Family, bank transfer to strangers, gift cards or crypto.'
        : 'Emails and phone numbers are never shown. Keep the conversation on TCG Trade and pay with a method that has buyer protection (e.g. PayPal Goods & Services). Be wary of anyone asking to move off-site or to pay by PayPal Friends & Family, bank transfer to strangers, gift cards or crypto. Meet somewhere public for local pickup, and report anything suspicious.'}
    </aside>
  )
}
