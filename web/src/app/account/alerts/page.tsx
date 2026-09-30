import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { RemoveAlertButton } from '@/components/account/AlertForms'
import { fmtAud, fmtDate, gradeLabel, LangBadge } from '@/components/Format'
import { db, getAccount, retailers, savedSearches, wishlist } from '@/lib/account/data'
import { describeSearch } from '@/lib/account/format'
import { requireMember } from '@/lib/account/gate'
import { accountDropAlertsPath, accountSightingsPath } from '@/lib/seo/urls'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Alerts' }

export default async function Alerts() {
  const m = await requireMember('/account/alerts/')
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect('/login/?next=/account/alerts/')
  const [wish, searches, { data: f }, rets] = await Promise.all([
    wishlist(),
    savedSearches(),
    (await db()).from('drop_alert_filters').select('games,retailer_slugs,states,keywords,max_price_aud,only_at_or_below_rrp,onboarded_at').maybeSingle(),
    retailers(),
  ])
  const games = ((f?.games as string[] | null) ?? ['pokemon', 'one-piece']).map((g) => (g === 'one-piece' ? 'One Piece' : 'Pokémon'))
  const slugs = (f?.retailer_slugs as string[] | null) ?? null
  const states = (f?.states as string[] | null) ?? null
  const keywords = (f?.keywords as string[] | null) ?? []

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
            <Link href="/deals/" className="prose-link">eBay deals</Link>
          </div>
          <p className="muted mb-4 text-sm">We also tell you when a wishlisted card turns up on eBay Australia well under its market value.</p>
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
          {!f?.onboarded_at ? (
            <div className="notice notice-up" data-testid="drop-setup-cta">
              <strong>Finish setting up your drop alerts.</strong> Pick your games, stores, states and keywords, and turn on push — takes a minute.
              <div className="mt-3"><Link href={accountDropAlertsPath()} className="btn btn-primary btn-sm">Set up drop alerts</Link></div>
            </div>
          ) : (
            <>
              <dl className="review-list">
                <dt>Games</dt><dd>{games.join(', ')}</dd>
                <dt>Retailers</dt><dd>{slugs === null ? 'All retailers' : rets.filter((r) => slugs.includes(r.slug)).map((r) => r.name).join(', ') || '—'}</dd>
                <dt>In-store states</dt><dd>{states === null ? 'All of Australia' : states.join(', ')}</dd>
                <dt>Keywords</dt><dd>{keywords.length ? keywords.join(', ') : 'Everything'}</dd>
                <dt>Price</dt><dd>{f?.only_at_or_below_rrp ? 'RRP or below' : 'Any'}{f?.max_price_aud ? ` · up to ${fmtAud(Number(f.max_price_aud))}` : ''}</dd>
              </dl>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={accountDropAlertsPath()} className="btn btn-primary btn-sm">Edit drop alerts</Link>
                <Link href={accountSightingsPath()} className="btn btn-secondary btn-sm">Report a sighting</Link>
              </div>
            </>
          )}
          {acct.tier === 'free' && <p className="muted mt-3 text-xs">Free plan: drop alerts arrive 24 hours after Premium members get them.</p>}
        </section>
      </div>
    </div>
  )
}
