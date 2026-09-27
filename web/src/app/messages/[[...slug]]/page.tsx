import { PendingUi, privateMeta, requireUser } from '@/lib/accountGate'

export const metadata = privateMeta
export const dynamic = 'force-dynamic'

export default async function Messages({ params }: { params: Promise<{ slug?: string[] }> }) {
  const key = ((await params).slug ?? []).join('/')
  await requireUser(`/messages/${key ? `${key}/` : ''}`)
  return (
    <PendingUi
      title={key === 'new' ? 'Message seller' : 'Messages'}
      items={['Inbox with unread counts', 'Thread tied to a listing, near-real-time (Supabase Realtime)', 'Image attachments (size-limited)', 'Contact details hidden by default', 'Block and report from the thread', 'Anti-scam banner']}
    />
  )
}
