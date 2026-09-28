import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { DropFiltersForm, RemoveAlertButton } from '@/components/account/AlertForms'
import { fmtAud, fmtDate, gradeLabel, LangBadge } from '@/components/Format'
import { dropFilters, getAccount, retailers, savedSearches, wishlist } from '@/lib/account/data'
import { describeSearch } from '@/lib/account/format'
import { requireMember } from '@/lib/account/gate'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Alerts' }

export default async function Alerts() {
  const m = await requireMember('/account/alerts/')
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect('/login/?next=/account/alerts/')
  const [wish, searches, filters, rets] = await Promise.all([wishlist(), savedSearches(), dropFilters(), retailers()])

  return (
    <div className="container-x pb-16">
      <AccountHead
        eyebrow="Alerts"
        title="Your alerts"
        lead="We email you (and show it under Notifications) when something you want is listed, or when a retailer restocks. Choose channels in Settings."
        actions={<Link href="/account/settings/#notifications" className="btn btn-secondary">Notification settings</Link>}
      />
      <div className="grid gap-4">
        <section className="panel" aria-labelledby="wish-h" data-testid="wishlist">
          <div className="panel-title">
            <h2 id="wish-h">Wishlist <span className="muted text-sm">· notify me when listed</span></h2>
          </div>
          {wish.length === 0 ? (
            <p className="muted text-sm">No card alerts yet. On any card page, use <strong>Alert me</strong> to hear when one is listed.</p>
          ) : (
            <ul className="rows">
              {wish.map((w) => (
                <li key={w.id} className="row-plain">
                  <div className="row-main">
                    <p className="row-title">{w.label} {w.lang && <LangBadge lang={w.lang} />}</p>
                    <p className="row-sub">
                      {w.setName ? `${w.setName} · ` : ''}{w.gradeKey ? gradeLabel(w.gradeKey) : 'Any grade'}
                      {w.maxPriceAud ? ` · up to ${fmtAud(w.maxPriceAud)}` : ''}
                      {w.lastNotifiedAt ? ` · last alert ${fmtDate(w.lastNotifiedAt)}` : ` · added ${fmtDate(w.createdAt)}`}
                    </p>
                  </div>
                  <RemoveAlertButton id={w.id} kind="wishlist" label={w.label} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="ss-h">
          <div className="panel-title">
            <h2 id="ss-h">Saved searches</h2>
            <Link href="/marketplace/" className="prose-link">Search the marketplace</Link>
          </div>
          {searches.length === 0 ? (
            <p className="muted text-sm">Save a marketplace search to get an email when a new listing matches it.</p>
          ) : (
            <ul className="rows">
              {searches.map((s) => (
                <li key={s.id} className="row-plain">
                  <div className="row-main">
                    <p className="row-title">{s.name}</p>
                    <p className="row-sub">{describeSearch(s.query)}{s.lastNotifiedAt ? ` · last match ${fmtDate(s.lastNotifiedAt)}` : ''}</p>
                  </div>
                  <RemoveAlertButton id={s.id} kind="search" label={s.name} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="drop-h" id="drops">
          <div className="panel-title">
            <h2 id="drop-h">Retail drop alerts</h2>
            <Link href="/drops/" className="prose-link">Drop history</Link>
          </div>
          <DropFiltersForm initial={filters} retailers={rets} tier={acct.tier} />
        </section>
      </div>
    </div>
  )
}
