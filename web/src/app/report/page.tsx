import Link from 'next/link'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { ReportForm } from '@/components/account/ReportForm'
import { db } from '@/lib/account/data'
import { privateMeta } from '@/lib/accountGate'
import { one, requireMember, withQuery } from '@/lib/account/gate'
import { listingPath } from '@/lib/seo/urls'
import '../account/account.css'

export const metadata = { ...privateMeta, title: 'Report' }
export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

type Target = { type: 'listing' | 'user' | 'conversation'; id: string; label: string; back: string }

export default async function Report({ searchParams }: Props) {
  const sp = await searchParams
  const params = { listing: one(sp.listing), user: one(sp.user), conversation: one(sp.conversation) }
  const m = await requireMember(withQuery('/report/', params))
  if (!m) return <DemoNotice />
  const sb = await db()
  let target: Target | null = null

  if (params.listing && /^\d{1,12}$/.test(params.listing)) {
    const { data } = await sb.from('listings').select('id,title,status').eq('id', Number(params.listing)).maybeSingle()
    target = data
      ? { type: 'listing', id: String(data.id), label: `the listing “${data.title}”`, back: ['active', 'sold', 'expired'].includes(data.status) ? listingPath(data.id, data.title) : '/marketplace/' }
      : { type: 'listing', id: params.listing, label: `listing #${params.listing}`, back: '/marketplace/' }
  } else if (params.conversation && /^[0-9a-f-]{36}$/i.test(params.conversation)) {
    const { data } = await sb.from('conversations').select('id,buyer_id,seller_id').eq('id', params.conversation).maybeSingle()
    if (data) {
      const other = data.buyer_id === m.id ? data.seller_id : data.buyer_id
      const { data: p } = await sb.from('profiles').select('username').eq('id', other).maybeSingle()
      target = { type: 'conversation', id: data.id, label: `your conversation with @${p?.username ?? 'member'}`, back: `/messages/${data.id}/` }
    }
  } else if (params.user) {
    const isId = /^[0-9a-f-]{36}$/i.test(params.user)
    const { data } = await sb.from('profiles').select('id,username').eq(isId ? 'id' : 'username', params.user.toLowerCase()).maybeSingle()
    if (data) target = { type: 'user', id: data.id, label: `the member @${data.username}`, back: `/sellers/${data.username}/` }
  }

  return (
    <div className="container-x pb-16" style={{ maxWidth: 720 }}>
      <AccountHead eyebrow="Trust & safety" title="Report a problem" lead={target ? <>You&apos;re reporting {target.label}. Reports go to our moderators, who review them within a day.</> : undefined} />
      {target ? (
        <div className="panel">
          <ReportForm targetType={target.type} targetId={target.id} backHref={target.back} />
        </div>
      ) : (
        <div className="notice notice-warn" role="alert">
          We couldn&apos;t tell what you want to report. Use the <strong>Report</strong> link on the listing, seller page or conversation, or <Link className="prose-link" href="/contact/">contact us</Link>.
        </div>
      )}
    </div>
  )
}
