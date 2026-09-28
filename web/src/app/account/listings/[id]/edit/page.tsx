import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AccountHead, DemoNotice, StatusChip } from '@/components/account/bits'
import { ListingEditor } from '@/components/account/ListingEditor'
import { getAccount, getEditableListing } from '@/lib/account/data'
import { editorProps } from '@/lib/account/editorProps'
import { requireMember } from '@/lib/account/gate'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit listing' }

type Props = { params: Promise<{ id: string }> }

export default async function EditListing({ params }: Props) {
  const { id } = await params
  if (!/^\d{1,12}$/.test(id)) notFound()
  const path = `/account/listings/${id}/edit/`
  const m = await requireMember(path)
  if (!m) return <DemoNotice />
  const acct = await getAccount()
  if (!acct) redirect(`/login/?next=${encodeURIComponent(path)}`)
  const listing = await getEditableListing(Number(id), acct.userId)
  if (!listing) notFound()
  if (listing.status !== 'draft') {
    return (
      <div className="container-x pb-16">
        <AccountHead eyebrow="Edit listing" title={listing.title} />
        <StatusChip status={listing.status} />
        <div className="notice mt-6">
          Only drafts can be edited. Once a listing is submitted, the card, grade and cert are locked so buyers see exactly what was reviewed.
          To change it, withdraw it and create a new listing.
        </div>
        <p className="mt-6"><Link href="/account/listings/" className="btn btn-secondary">Back to my listings</Link></p>
      </div>
    )
  }
  return (
    <div className="container-x pb-16">
      <AccountHead eyebrow="Edit draft" title={listing.title} />
      <ListingEditor {...editorProps(acct, listing, null, null)} />
    </div>
  )
}
