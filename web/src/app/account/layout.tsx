import { AccountNav } from '@/components/account/AccountNav'
import { privateMeta } from '@/lib/accountGate'
import './account.css'

export const metadata = privateMeta

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AccountNav />
      {children}
    </>
  )
}
