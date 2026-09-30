import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountHead, AntiScamBanner, DemoNotice } from '@/components/account/bits'
import { ComposeFirst } from '@/components/account/ComposeFirst'
import { fmtAud2, LangBadge } from '@/components/Format'
import { db, publicImageUrl } from '@/lib/account/data'
import { gradeText } from '@/lib/account/format'
import { one, requireMember, withQuery } from '@/lib/account/gate'
import { listingPath } from '@/lib/seo/urls'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Message the seller' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function NewMessage({ searchParams }: Props) {
  const sp = await searchParams
  const id = one(sp.listing) ?? ''
  const m = await requireMember(withQuery('/messages/new/', { listing: id }))
  if (!m) return <DemoNotice />
  const sb = await db()
  const listing = /^\d{1,12}$/.test(id)
    ? (await sb.from('listings').select('id,title,price_aud,status,lang,grader,grade,seller_id,listing_images(storage_path,position)').eq('id', Number(id)).maybeSingle()).data
    : null

  if (listing) {
    const { data: existing } = await sb.from('conversations').select('id').eq('listing_id', listing.id).eq('buyer_id', m.id).maybeSingle()
    if (existing) redirect(`/messages/${existing.id}/`)
  }
  const seller = listing ? (await sb.from('profiles').select('username').eq('id', listing.seller_id).maybeSingle()).data : null
  const own = listing?.seller_id === m.id
  const available = listing?.status === 'active'
  const imgs = ((listing?.listing_images ?? []) as { storage_path: string; position: number }[]).sort((a, b) => a.position - b.position)

  return (
    <div className="container-x pb-16" style={{ maxWidth: 760 }}>
      <AccountHead eyebrow="Messages" title="Message the seller" />
      {!listing ? (
        <div className="notice notice-warn" role="alert">We couldn&apos;t find that listing. <Link className="prose-link" href="/marketplace/">Back to the marketplace</Link></div>
      ) : (
        <div className="grid gap-4">
          <div className="listing-head">
            <span className="inbox-thumb" style={{ width: 44 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- listing photo */}
              {imgs[0] ? <img src={publicImageUrl(imgs[0].storage_path)} alt="" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="t">{listing.title}</p>
              <p className="card-meta">
                <strong className="num" style={{ color: 'var(--ink)' }}>{fmtAud2(Number(listing.price_aud))}</strong>
                <LangBadge lang={listing.lang} />
                {listing.grader && <span>{gradeText(listing.grader, Number(listing.grade))}</span>}
                <span>Seller @{seller?.username ?? 'member'}</span>
              </p>
            </div>
            {available && <Link href={listingPath(listing.id, listing.title)} className="btn btn-secondary btn-sm">View</Link>}
          </div>
          {own ? (
            <div className="notice">This is your own listing. Buyers&apos; messages will appear in your <Link className="prose-link" href="/messages/">inbox</Link>.</div>
          ) : !available ? (
            <div className="notice notice-warn" role="alert">This listing is no longer available, so the seller can&apos;t be contacted about it.</div>
          ) : (
            <>
              <AntiScamBanner compact />
              <ComposeFirst listingId={listing.id} sellerUsername={seller?.username ?? 'seller'} suggestion={`Hi, is the ${listing.title} still available?`} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
