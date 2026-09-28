import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { PreferencesForm, ProfileForm } from '@/components/account/SettingsForms'
import { getAccount, preferenceRows } from '@/lib/account/data'
import { preferenceMatrix } from '@/lib/account/format'
import { requireMember } from '@/lib/account/gate'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings' }

export default async function Settings() {
  const m = await requireMember('/account/settings/')
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect('/login/?next=/account/settings/')
  const matrix = preferenceMatrix(await preferenceRows())
  // The marketing email tick mirrors profile_private.marketing_opt_in (consent record).
  matrix['marketing:email'] = matrix['marketing:email'] || acct.marketingOptIn

  return (
    <div className="container-x pb-16">
      <AccountHead eyebrow="Settings" title="Profile & notifications" />
      <div className="grid gap-4">
        <section className="panel" aria-labelledby="profile-h">
          <div className="panel-title"><h2 id="profile-h">Profile</h2></div>
          <p className="muted mb-4 text-sm">Signed in as {acct.email}. Your email is never shown to other members.</p>
          <ProfileForm initial={{ username: acct.username, displayName: acct.displayName ?? '', locationState: acct.locationState ?? '', postcode: acct.postcode ?? '' }} />
        </section>
        <section className="panel" aria-labelledby="notifications" id="notifications-section">
          <div className="panel-title"><h2 id="notifications">Notification preferences</h2></div>
          <p className="muted mb-4 text-sm">Choose how we tell you about each kind of alert.</p>
          <PreferencesForm matrix={matrix} isPremium={acct.tier === 'premium'} />
        </section>
      </div>
    </div>
  )
}
