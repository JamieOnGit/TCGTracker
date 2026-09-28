import { StaticPage, staticMeta } from '@/lib/staticPage'
export const metadata = staticMeta('/privacy/', 'Privacy Policy', 'How we collect, use and protect personal information under the Australian Privacy Act.', true)
export default function Privacy() {
  return (
    <StaticPage path="/privacy/" h1="Privacy Policy" eyebrow="TCG Trade">
      <p><strong>Draft outline, pending legal review. Not in force.</strong> To cover the Australian Privacy Principles: what we collect (account, listings, messages, payment via Stripe), why, where it&apos;s stored (Supabase region), who we share it with (Stripe, email provider), how to access or correct it, marketing consent (Spam Act 2003), and how to complain.</p>
    </StaticPage>
  )
}
