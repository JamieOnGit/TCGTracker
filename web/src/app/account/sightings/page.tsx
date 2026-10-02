import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { SightingForm } from '@/components/account/SightingForm'
import { SightingVotes } from '@/components/account/SightingVotes'
import { fmtAud2 } from '@/components/Format'
import { getAccount, db } from '@/lib/account/data'
import { relativeTime } from '@/lib/account/format'
import { one, requireMember } from '@/lib/account/gate'
import { QUANTITIES, SIGHTING_STATUS, rewardProgress, type Vote } from '@/lib/account/sightings'
import { getRepo } from '@/lib/data'
import { sightingPhotoUrl } from '@/lib/data/drops'
import { AU_STATES, AU_STATE_NAMES, type AuState } from '@/lib/data/types'
import { accountDropAlertsPath, accountSightingsPath, scoutsPath } from '@/lib/seo/urls'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Report a sighting' }

const COLS =
  'id,user_id,channel,state,suburb,store_name,game,product,price_aud,quantity,purchase_limit,url,photo_path,note,status,' +
  'confirm_count,gone_count,flag_count,gone_at,seen_at,created_at,confirmed_at,reject_reason,retailers(slug,name)'

/** ISO timestamp `h` hours ago (outside render so React's purity rule is happy; these pages are dynamic). */
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST rows */
interface Sighting {
  id: number
  mine: boolean
  channel: 'in_store' | 'online'
  where: string
  retailer: string
  game: string
  product: string
  priceAud: number | null
  quantity: string | null
  purchaseLimit: number | null
  url: string | null
  photoUrl: string | null
  note: string | null
  status: string
  confirmCount: number
  goneCount: number
  goneAt: string | null
  seenAt: string
  createdAt: string
  rejectReason: string | null
}

function toSighting(r: any, me: string): Sighting {
  const place = r.channel === 'online' ? 'Online' : [r.store_name, r.suburb, r.state].filter(Boolean).join(', ')
  return {
    id: r.id,
    mine: r.user_id === me,
    channel: r.channel,
    where: place,
    retailer: r.retailers?.name ?? '',
    game: r.game === 'one-piece' ? 'One Piece' : 'Pokémon',
    product: r.product,
    priceAud: r.price_aud === null ? null : Number(r.price_aud),
    quantity: r.quantity,
    purchaseLimit: r.purchase_limit,
    url: r.url,
    photoUrl: sightingPhotoUrl(r.photo_path),
    note: r.note,
    status: r.status,
    confirmCount: r.confirm_count ?? 0,
    goneCount: r.gone_count ?? 0,
    goneAt: r.gone_at,
    seenAt: r.seen_at,
    createdAt: r.created_at,
    rejectReason: r.reject_reason,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export default async function Sightings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const m = await requireMember(accountSightingsPath())
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect(`/login/?next=${encodeURIComponent(accountSightingsPath())}`)
  const sp = await searchParams
  const stateParam = one(sp.state)?.toUpperCase()
  const stateFilter = (AU_STATES as readonly string[]).includes(stateParam ?? '') ? (stateParam as AuState) : null
  const staff = ['admin', 'moderator'].includes(acct.role)
  const canConfirm = acct.tier === 'premium' || staff

  const sb = await db()
  const since = hoursAgo(12)
  let pendingQ = sb.from('sightings').select(COLS).eq('status', 'pending').neq('user_id', acct.userId).order('created_at', { ascending: false }).limit(40)
  if (stateFilter) pendingQ = pendingQ.eq('state', stateFilter)
  const [retailers, mine, stats, settings, pending, live] = await Promise.all([
    getRepo().retailers(),
    sb.from('sightings').select(COLS).eq('user_id', acct.userId).order('created_at', { ascending: false }).limit(30),
    sb.rpc('scout_stats', { p_user: acct.userId }),
    sb.from('site_settings').select('key,value').in('key', ['scouts.reward_every', 'scouts.reward_days']),
    canConfirm ? pendingQ : Promise.resolve({ data: [] }),
    sb.from('sightings').select(COLS).eq('status', 'confirmed').is('gone_at', null).neq('user_id', acct.userId).gte('confirmed_at', since).order('confirmed_at', { ascending: false }).limit(30),
  ])
  const my = (mine.data ?? []).map((r) => toSighting(r, acct.userId))
  const pend = (pending.data ?? []).map((r) => toSighting(r, acct.userId))
  const conf = (live.data ?? []).map((r) => toSighting(r, acct.userId))
  const others = [...pend, ...conf].map((s) => s.id)
  const { data: votes } = others.length
    ? await sb.from('sighting_votes').select('sighting_id,vote').eq('user_id', acct.userId).in('sighting_id', others)
    : { data: [] as { sighting_id: number; vote: Vote }[] }
  const votedOn = (id: number) => ((votes ?? []) as { sighting_id: number; vote: Vote }[]).filter((v) => v.sighting_id === id).map((v) => v.vote)
  const setting = (k: string, d: number) => Number((settings.data ?? []).find((r: { key: string }) => r.key === k)?.value ?? d) || d
  const st = ((stats.data ?? [])[0] ?? { confirmed: 0, rejected: 0, trusted: false }) as { confirmed: number; rejected: number; trusted: boolean }
  const reward = rewardProgress(st.confirmed, setting('scouts.reward_every', 10), setting('scouts.reward_days', 30))

  return (
    <div className="container-x pb-16">
      <AccountHead
        eyebrow="Drop alerts · member sightings"
        title="Report a sighting"
        lead="Seen Pokémon or One Piece stock on the shelf, or live online? Tell the community. Once another member confirms it, everyone following that store gets an alert."
        actions={
          <>
            <Link href={accountDropAlertsPath()} className="btn btn-secondary">My drop alerts</Link>
            <Link href={scoutsPath()} className="btn btn-ghost">Scout leaderboard</Link>
          </>
        }
      />

      <div className="acct-grid">
        <div>
          <section className="panel" aria-labelledby="report-h">
            <div className="panel-title"><h2 id="report-h">What did you see?</h2></div>
            {retailers.length === 0 ? (
              <p className="muted text-sm">Retailers haven&apos;t been set up yet.</p>
            ) : (
              <SightingForm retailers={retailers.map((r) => ({ slug: r.slug, name: r.name, baseUrl: r.baseUrl, monitored: r.monitored }))} userId={acct.userId} defaultState={acct.locationState} />
            )}
          </section>
        </div>
        <div>
          <section className="panel" aria-labelledby="reward-h">
            <h2 id="reward-h" className="text-lg">Scout rewards</h2>
            <div className="meter mt-4" role="meter" aria-valuemin={0} aria-valuemax={reward.every} aria-valuenow={reward.done} aria-label="Confirmed sightings toward your next reward" aria-valuetext={reward.text}>
              <span style={{ width: `${(reward.done / reward.every) * 100}%` }} />
            </div>
            <p className="quota-line" data-testid="reward-progress">{reward.text}.</p>
            <p className="muted mt-3 text-xs">
              {st.confirmed} confirmed · {st.rejected} not approved{reward.earned > 0 ? ` · ${reward.earned} free ${reward.earned === 1 ? 'month' : 'months'} earned` : ''}.
              {st.trusted ? ' You’re a trusted scout: your reports alert straight away.' : ' After 5 confirmed reports (and few rejections) yours alert without waiting for a confirmation.'}
            </p>
          </section>
          <section className="panel" aria-labelledby="rules-h">
            <h2 id="rules-h" className="text-lg">How it works</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              <li>A report alerts once another member confirms it — or straight away with a photo and one confirmation, from a trusted scout, or after a moderator checks it.</li>
              <li>A second report of the same store within 3 hours counts as a confirmation.</li>
              <li>Unconfirmed reports expire after 6 hours. Two &ldquo;Sold out&rdquo; votes mark stock as gone.</li>
              <li>Up to 10 reports a day. We never ask for retailer logins, and we don&apos;t use bots on retailer sites.</li>
            </ul>
          </section>
        </div>
      </div>

      <section className="panel mt-4" aria-labelledby="mine-h" data-testid="my-sightings">
        <div className="panel-title"><h2 id="mine-h">Your reports</h2></div>
        {my.length === 0 ? (
          <p className="muted text-sm">No reports yet. Your first confirmed sighting starts you on the leaderboard.</p>
        ) : (
          <ul className="rows">
            {my.map((s) => {
              const chip = SIGHTING_STATUS[s.status] ?? { label: s.status, tone: 'neutral' as const }
              return (
                <li key={s.id} className="row-plain" data-sighting={s.id}>
                  <div className="row-main">
                    <p className="row-title">{s.product} <span className="muted">· {s.retailer}</span></p>
                    <p className="row-sub">
                      {s.where} · reported {relativeTime(s.createdAt)} · {s.confirmCount} {s.confirmCount === 1 ? 'confirmation' : 'confirmations'}
                      {s.goneAt ? ' · sold out' : s.goneCount > 0 ? ` · ${s.goneCount} sold-out ${s.goneCount === 1 ? 'vote' : 'votes'}` : ''}
                    </p>
                    {s.status === 'rejected' && s.rejectReason && <p className="status-note">Reason: {s.rejectReason}</p>}
                  </div>
                  <span className="chip-status" data-tone={chip.tone} data-status={s.status}>{chip.label}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="panel mt-4" aria-labelledby="confirm-h" data-testid="needs-confirming">
        <div className="panel-title">
          <h2 id="confirm-h">Needs confirming near you</h2>
          {canConfirm && <span className="muted text-sm">Newest first</span>}
        </div>
        {!canConfirm ? (
          <div className="upgrade-card">
            <p className="eyebrow"><span className="holo-text">◆ Premium</span></p>
            <p className="serif mt-2 text-lg">Premium members confirm reports — and get their alerts instantly.</p>
            <p className="muted mt-2 text-sm">
              New reports are shown to Premium members first, so they can check the shelf and confirm. Their alerts arrive the moment a report is confirmed; Free members get the same alert 5 minutes later. Earn Premium free: every {reward.every} confirmed sightings you report.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/account/billing/upgrade/" className="btn btn-holo">Upgrade to Premium</Link>
              <Link href="/premium/" className="btn btn-secondary">Compare plans</Link>
            </div>
          </div>
        ) : (
          <>
            <nav aria-label="Filter by state" className="mb-4 flex flex-wrap gap-2">
              <Link href={accountSightingsPath()} className="chip-filter" aria-current={!stateFilter ? 'page' : undefined}>All states</Link>
              {AU_STATES.map((s) => (
                <Link key={s} href={`${accountSightingsPath()}?state=${s.toLowerCase()}`} className="chip-filter" title={AU_STATE_NAMES[s]} aria-current={stateFilter === s ? 'page' : undefined}>{s}</Link>
              ))}
            </nav>
            {pend.length === 0 ? (
              <p className="muted text-sm">Nothing waiting{stateFilter ? ` in ${AU_STATE_NAMES[stateFilter]}` : ''} right now.</p>
            ) : (
              <SightingList rows={pend} votes={['confirm', 'gone', 'fake']} votedOn={votedOn} />
            )}
          </>
        )}
      </section>

      {conf.length > 0 && (
        <section className="panel mt-4" aria-labelledby="live-h">
          <div className="panel-title">
            <h2 id="live-h">Still there?</h2>
            <span className="muted text-sm">Confirmed in the last 12 hours</span>
          </div>
          <p className="muted mb-4 text-sm">If you went and it&apos;s gone, tell everyone — two &ldquo;Sold out&rdquo; votes close it.</p>
          <SightingList rows={conf} votes={['gone', 'fake']} votedOn={votedOn} />
        </section>
      )}
    </div>
  )
}

function SightingList({ rows, votes, votedOn }: { rows: Sighting[]; votes: Vote[]; votedOn: (id: number) => Vote[] }) {
  return (
    <ul className="rows">
      {rows.map((s) => (
        <li key={s.id} className="row-plain" data-sighting={s.id}>
          {s.photoUrl && (
            <a href={s.photoUrl} target="_blank" rel="noopener" className="inbox-thumb" style={{ width: 56, aspectRatio: '1 / 1' }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- member photo from Storage (already resized) */}
              <img src={s.photoUrl} alt={`Photo of ${s.product}`} loading="lazy" />
            </a>
          )}
          <div className="row-main">
            <p className="row-title">
              {s.product} <span className="muted">· {s.game}</span>
            </p>
            <p className="row-sub">
              {s.retailer} · {s.channel === 'online' && s.url ? <a className="prose-link" href={s.url} target="_blank" rel="nofollow noopener">Online</a> : s.where}
              {' · '}seen {relativeTime(s.seenAt)}
              {s.priceAud !== null ? ` · ${fmtAud2(s.priceAud)}` : ''}
              {s.quantity ? ` · ${QUANTITIES.find((q) => q.key === s.quantity)?.label.toLowerCase() ?? s.quantity}` : ''}
              {s.purchaseLimit ? ` · limit ${s.purchaseLimit}` : ''}
              {` · ${s.confirmCount} ${s.confirmCount === 1 ? 'confirmation' : 'confirmations'}`}
            </p>
            {s.note && <p className="row-sub">&ldquo;{s.note}&rdquo;</p>}
          </div>
          <SightingVotes sightingId={s.id} product={s.product} votes={votes} voted={votedOn(s.id)} />
        </li>
      ))}
    </ul>
  )
}
