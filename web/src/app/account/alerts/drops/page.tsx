import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { DropSetupWizard, type DropSetupInitial } from '@/components/account/DropSetupWizard'
import { db, getAccount } from '@/lib/account/data'
import { requireMember } from '@/lib/account/gate'
import { DROP_CHANNELS } from '@/lib/account/sightings'
import { getRepo } from '@/lib/data'
import { AU_STATES } from '@/lib/data/types'
import { accountDropAlertsPath, accountSightingsPath } from '@/lib/seo/urls'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Set up drop alerts' }

/** Up to `max` set names to offer as "follow" chips: upcoming releases first, then the newest sets of both games. */
async function setSuggestions(max = 16): Promise<string[]> {
  const repo = getRepo()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })
  const [releases, sets] = await Promise.all([repo.releases({ from: today }).catch(() => []), repo.listSets().catch(() => [])])
  const recent = [...sets].filter((s) => s.releaseDate).sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
  const out: string[] = []
  for (const name of [...releases.map((r) => r.set?.name ?? r.title), ...recent.map((s) => s.name)]) {
    const n = name.trim()
    if (n && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n)
    if (out.length >= max) break
  }
  return out
}

export default async function DropAlertSetup() {
  const m = await requireMember(accountDropAlertsPath())
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect(`/login/?next=${encodeURIComponent(accountDropAlertsPath())}`)
  const sb = await db()
  const [filters, prefs, retailers, sets] = await Promise.all([
    sb.from('drop_alert_filters').select('games,retailer_slugs,states,keywords,max_price_aud,only_at_or_below_rrp,include_sightings,onboarded_at').maybeSingle(),
    sb.from('notification_preferences').select('channel,enabled').eq('alert_type', 'drop'),
    getRepo().retailers(),
    setSuggestions(),
  ])
  const f = filters.data
  const onboarded = Boolean(f?.onboarded_at)
  const pref = new Map(((prefs.data ?? []) as { channel: string; enabled: boolean }[]).map((p) => [p.channel, p.enabled]))
  // Default states: the member's own state until they've been through setup, else what they saved (null = all).
  const home = acct.locationState && (AU_STATES as readonly string[]).includes(acct.locationState) ? [acct.locationState] : null
  const initial: DropSetupInitial = {
    games: (f?.games as string[] | null) ?? ['pokemon', 'one-piece'],
    retailerSlugs: (f?.retailer_slugs as string[] | null) ?? null,
    states: (f?.states as string[] | null) ?? (onboarded ? null : home),
    keywords: (f?.keywords as string[] | null) ?? [],
    maxPriceAud: f?.max_price_aud === null || f?.max_price_aud === undefined ? null : Number(f.max_price_aud),
    onlyAtOrBelowRrp: Boolean(f?.only_at_or_below_rrp),
    includeSightings: f?.include_sightings ?? true,
    // Missing row = public.notification_default(): everything on except Discord.
    channels: Object.fromEntries(DROP_CHANNELS.map((c) => [c, pref.get(c) ?? c !== 'discord'])) as DropSetupInitial['channels'],
    onboarded,
  }

  return (
    <div className="container-x pb-16">
      <AccountHead
        eyebrow="Alerts · retail drops"
        title={onboarded ? 'Your drop alerts' : 'Set up drop alerts'}
        lead="Tell us what you collect and where you shop. We’ll alert you when retailers restock or members spot it on the shelf — and nothing else."
        actions={
          <>
            <Link href="/account/alerts/" className="btn btn-ghost">All alerts</Link>
            <Link href={accountSightingsPath()} className="btn btn-secondary">Report a sighting</Link>
          </>
        }
      />
      <section className="panel" aria-label="Drop alert setup">
        <DropSetupWizard
          initial={initial}
          retailers={retailers.map((r) => ({ slug: r.slug, name: r.name, monitored: r.monitored }))}
          sets={sets}
          tier={acct.tier}
          vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null}
        />
      </section>
    </div>
  )
}
