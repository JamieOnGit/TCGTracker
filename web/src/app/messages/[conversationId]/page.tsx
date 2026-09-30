import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AntiScamBanner, DemoNotice } from '@/components/account/bits'
import { ThreadClient } from '@/components/account/ThreadClient'
import { fmtAud2, LangBadge, PremiumBadge } from '@/components/Format'
import { db, getThread } from '@/lib/account/data'
import { requireMember } from '@/lib/account/gate'
import { listingPath } from '@/lib/seo/urls'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conversation' }

type Props = { params: Promise<{ conversationId: string }> }

export default async function ThreadPage({ params }: Props) {
  const { conversationId } = await params
  const m = await requireMember(`/messages/${conversationId}/`)
  if (!m) return <DemoNotice />
  const t = await getThread(conversationId, m.id)
  if (!t) notFound()
  await (await db()).rpc('mark_conversation_read', { p_conversation: conversationId })
  const l = t.listing
  const live = l.status === 'active' || l.status === 'sold' || l.status === 'expired'

  return (
    <div className="container-x pb-8" style={{ maxWidth: 1080 }}>
      <p className="pt-6 text-sm"><Link href="/messages/" className="prose-link">← All messages</Link></p>
      <div className="thread-wrap mt-4">
        <div className="min-w-0">
          <div className="listing-head" data-testid="listing-header">
            <span className="inbox-thumb" style={{ width: 44 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- listing photo */}
              {l.thumbUrl ? <img src={l.thumbUrl} alt="" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="t">{l.title ?? 'Listing no longer available'}</p>
              <p className="card-meta">
                {l.priceAud !== null && <strong className="num" style={{ color: 'var(--ink)' }}>{fmtAud2(l.priceAud)}</strong>}
                {l.lang && <LangBadge lang={l.lang} />}
                {l.gradeText && <span>{l.gradeText}</span>}
                {l.status && l.status !== 'active' && <span className="chip-status" data-tone={l.status === 'sold' ? 'neutral' : 'warn'}>{l.status === 'sold' ? 'Sold' : l.status === 'expired' ? 'Expired' : 'Unavailable'}</span>}
              </p>
            </div>
            {live && l.title && <Link href={listingPath(l.id, l.title)} className="btn btn-secondary btn-sm">View listing</Link>}
          </div>
          <p className="muted mt-3 text-sm">
            {t.role === 'buyer' ? 'Seller' : 'Buyer'}: <Link className="prose-link" href={`/sellers/${t.otherUsername}/`}>@{t.otherUsername}</Link> {t.otherPremium && <PremiumBadge />}
          </p>
          <div className="mt-3 lg:hidden"><AntiScamBanner compact /></div>
          <ThreadClient
            conversationId={t.id}
            userId={m.id}
            otherId={t.otherId}
            otherUsername={t.otherUsername}
            initial={t.messages}
            blockedByMe={t.blockedByMe}
            otherLastReadAt={t.otherLastReadAt}
          />
        </div>
        <div className="hidden gap-4 lg:grid">
          <AntiScamBanner />
          <div className="panel text-sm">
            <p className="font-medium">Before you pay</p>
            <ul className="muted mt-2 grid gap-2">
              <li>Check the cert number on the grader&apos;s website.</li>
              <li>Ask for a photo with today&apos;s date and the seller&apos;s username.</li>
              <li>Use a payment method with buyer protection.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
