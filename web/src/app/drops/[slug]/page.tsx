import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DropFeed } from '@/components/DropFeed'
import { CopyIntro, Faq } from '@/components/DropsCopy'
import { LiveDrops } from '@/components/LiveDrops'
import { PageIntro } from '@/components/ui'
import { RETAILER_COPY, STATE_COPY } from '@/content/drops-copy'
import { getRepo } from '@/lib/data'
import { AU_STATES, AU_STATE_NAMES, type AuState, type DropRow, type RetailerRow } from '@/lib/data/types'
import { hasRecentDrops, stateFromSlug } from '@/lib/domain/drops'
import { buildMetadata } from '@/lib/seo/metadata'
import { accountSightingsPath, dropsPath, dropsStatePath } from '@/lib/seo/urls'

export const revalidate = 300
type Props = { params: Promise<{ slug: string }> }

type Page =
  | { kind: 'retailer'; retailer: RetailerRow; retailers: RetailerRow[]; rows: DropRow[]; indexable: boolean }
  | { kind: 'state'; state: AuState; retailers: RetailerRow[]; rows: DropRow[]; indexable: boolean }

/**
 * /drops/<slug>/ is either a retailer (/drops/kmart/) or a state (/drops/vic/).
 * Thin-page guard: a page with no events in 90 days and no evergreen copy is
 * noindex,follow. Deduped per request.
 */
const load = cache(async (slug: string): Promise<Page | null> => {
  const repo = getRepo()
  const retailers = await repo.retailers()
  const state = stateFromSlug(slug)
  if (state) {
    const rows = await repo.drops({ state, limit: 100 })
    return { kind: 'state', state, retailers, rows, indexable: Boolean(STATE_COPY[state]) || hasRecentDrops(rows, new Date()) }
  }
  const retailer = retailers.find((r) => r.slug === slug)
  if (!retailer) return null
  const rows = await repo.drops({ retailerSlug: retailer.slug, limit: 100 })
  return { kind: 'retailer', retailer, retailers, rows, indexable: Boolean(RETAILER_COPY[retailer.slug]) || hasRecentDrops(rows, new Date()) }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).slug)
  if (!p) return {}
  if (p.kind === 'state') {
    const name = AU_STATE_NAMES[p.state]
    return buildMetadata({
      path: dropsStatePath(p.state),
      title: `Pokémon & One Piece Restocks in ${name} (${p.state})`,
      description: `Member-confirmed Pokémon and One Piece stock sightings at Kmart, BIG W, Target and more in ${name}, with store, quantity and limits.`,
      noindex: !p.indexable,
    })
  }
  const r = p.retailer
  return buildMetadata({
    path: dropsPath(r.slug),
    title: r.monitored ? `${r.name} Pokémon & One Piece Restocks & Pre-orders` : `${r.name} Pokémon & One Piece Restocks (Member Sightings)`,
    description: r.monitored
      ? `Pokémon TCG and One Piece Card Game restocks, pre-orders and member sightings at ${r.name} Australia, checked around the clock and tagged against RRP in AUD.`
      : `Pokémon TCG and One Piece Card Game stock at ${r.name} in Australia, reported and confirmed by members who saw it in store.`,
    noindex: !p.indexable,
  })
}

export default async function DropsSlug({ params }: Props) {
  const p = await load((await params).slug)
  if (!p) notFound()
  return p.kind === 'state' ? <StateDrops p={p} /> : <RetailerDrops p={p} />
}

function RetailerDrops({ p }: { p: Extract<Page, { kind: 'retailer' }> }) {
  const r = p.retailer
  const copy = RETAILER_COPY[r.slug]
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: '/drops/' }, { name: r.name, path: dropsPath(r.slug) }]} /></div>
      <PageIntro eyebrow="Retail drops · Australia" title={r.monitored ? `${r.name} restocks & pre-orders` : `${r.name} restocks`} lead={retailerLead(r)}>
        <CopyIntro copy={copy} />
        <StateNav label={`${r.name} by state`} />
        <ReportCta />
      </PageIntro>
      <LiveDrops />
      <section className="section" aria-labelledby="hist-h"><h2 id="hist-h">History</h2><div className="mt-6"><DropFeed rows={p.rows} empty={r.monitored ? undefined : `No confirmed sightings at ${r.name} yet. Seen stock in store? Report it and other members will confirm it.`} /></div></section>
      <Faq faqs={copy?.faqs} title={`${r.name} restock questions`} />
    </div>
  )
}

function StateDrops({ p }: { p: Extract<Page, { kind: 'state' }> }) {
  const name = AU_STATE_NAMES[p.state]
  const copy = STATE_COPY[p.state]
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'Drops', path: '/drops/' }, { name, path: dropsStatePath(p.state) }]} /></div>
      <PageIntro eyebrow={`Retail drops · ${p.state}`} title={`Restocks in ${name}`} lead={`Pokémon and One Piece stock that members have seen on the shelf in ${name}: store, suburb, how many and the purchase limit, confirmed by other members before anyone is alerted.`}>
        <CopyIntro copy={copy} />
        <nav aria-label="Retailers" className="mt-6 flex flex-wrap gap-2">
          {p.retailers.map((r) => <Link key={r.slug} href={dropsPath(r.slug)} className="chip-filter">{r.name}</Link>)}
        </nav>
        <StateNav label="Other states" current={p.state} />
        <ReportCta />
      </PageIntro>
      <LiveDrops />
      <section className="section" aria-labelledby="hist-h">
        <h2 id="hist-h">Sightings in {name}</h2>
        <div className="mt-6"><DropFeed rows={p.rows} empty={`No confirmed sightings in ${name} yet. Seen stock in store? Report it and other members will confirm it.`} /></div>
      </section>
      <Faq faqs={copy?.faqs} title={`Restock questions in ${name}`} />
    </div>
  )
}

function retailerLead(r: RetailerRow): string {
  if (!r.monitored) {
    return `We don't monitor ${r.name} online. Alerts here come from member sightings: stock members have seen in store, confirmed by other members before anyone is alerted.`
  }
  return `Pokémon and One Piece sealed product at ${r.name}, checked 24/7, plus in-store sightings from members.${r.enabled ? '' : ' Monitoring for this retailer is being set up.'}`
}

function StateNav({ label, current }: { label: string; current?: AuState }) {
  return (
    <nav aria-label={label} className="mt-3 flex flex-wrap gap-2">
      {AU_STATES.map((st) => (
        <Link key={st} href={dropsStatePath(st)} className="chip-filter" title={AU_STATE_NAMES[st]} aria-current={st === current ? 'page' : undefined}>{st}</Link>
      ))}
    </nav>
  )
}

function ReportCta() {
  return (
    <div className="mt-6">
      <Link href={accountSightingsPath()} className="btn btn-primary btn-sm" rel="nofollow">Seen stock in store? Report it</Link>
    </div>
  )
}
