import { StaticPage, staticMeta } from '@/lib/staticPage'
export const metadata = staticMeta('/contact/', 'Contact', 'How to contact the team, report a problem or ask about data licensing.')
export default function Contact() {
  return <StaticPage path="/contact/" h1="Contact"><p>Placeholder: contact details to be confirmed.</p></StaticPage>
}
