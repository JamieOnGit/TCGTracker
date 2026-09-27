import { PendingUi, privateMeta, requireUser } from '@/lib/accountGate'
export const metadata = privateMeta
export const dynamic = 'force-dynamic'
export default async function Report() {
  await requireUser('/report/')
  return <PendingUi title="Report" items={['Reason (scam, counterfeit, misrepresented, off-platform payment...)', 'Details', 'Goes to the moderation queue']} />
}
