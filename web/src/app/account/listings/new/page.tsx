import { redirect } from 'next/navigation'
import { AccountHead, DemoNotice } from '@/components/account/bits'
import { ListingEditor } from '@/components/account/ListingEditor'
import { getAccount, getCardOption } from '@/lib/account/data'
import { editorProps } from '@/lib/account/editorProps'
import { one, requireMember, withQuery } from '@/lib/account/gate'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create a listing' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function NewListing({ searchParams }: Props) {
  const sp = await searchParams
  const path = withQuery('/account/listings/new/', { card: one(sp.card), grade: one(sp.grade) })
  const m = await requireMember(path)
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect(`/login/?next=${encodeURIComponent(path)}`)
  const cardId = one(sp.card)
  const card = cardId ? await getCardOption(cardId) : null
  return (
    <div className="container-x pb-16">
      <AccountHead eyebrow="Sell" title="Create a listing" lead="Five quick steps. Your draft is saved before you add photos, so you can come back to it." />
      <ListingEditor {...editorProps(acct, null, card, one(sp.grade) ?? null)} />
    </div>
  )
}
