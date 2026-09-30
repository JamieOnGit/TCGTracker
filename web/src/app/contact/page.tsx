import { StaticPage, staticMeta } from '@/lib/staticPage'
export const metadata = staticMeta('/contact/', 'Contact TCGTracker', 'Contact TCGTracker about your account, a listing, data licensing or partnerships.')
export default function Contact() {
  return (
    <StaticPage path="/contact/" h1="Contact" eyebrow="Get in touch">
      <p>Email <a href="mailto:hello@tcgtracker.com.au">hello@tcgtracker.com.au</a>. We reply within two business days (AEST).</p>
      <ul>
        <li>Problem with a listing or member: use “Report” on the listing or in the message thread, so moderators see the context.</li>
        <li>Billing: Account → Billing lets you update your card, download invoices or cancel.</li>
        <li>Data licensing and partnerships: email with “Data” in the subject.</li>
      </ul>
    </StaticPage>
  )
}
