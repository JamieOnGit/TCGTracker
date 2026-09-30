import { AccountNav } from '@/components/account/AccountNav'
import { privateMeta } from '@/lib/accountGate'
import '../account/account.css'

export const metadata = privateMeta

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AccountNav />
      {children}
    </>
  )
}
