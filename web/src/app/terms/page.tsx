import { StaticPage, staticMeta } from '@/lib/staticPage'
export const metadata = staticMeta('/terms/', 'Terms of Service & Marketplace Rules', 'Terms of service, subscription terms and marketplace rules.', true)
export default function Terms() {
  return (
    <StaticPage path="/terms/" h1="Terms of Service">
      <p><strong>Draft outline, pending legal review. Not in force.</strong></p>
      <ul>
        <li>Subscription terms (Australian Consumer Law): price in AUD incl. GST, billing period, how to cancel in two clicks, what happens on failed payment.</li>
        <li>Marketplace rules: prohibited items; fakes, proxies and reproductions banned; accurate grading and condition claims; off-platform payment risks.</li>
        <li>Data: attribution and licence terms for our datasets and API.</li>
        <li>Trademarks: Pokémon and One Piece are used descriptively; no affiliation.</li>
      </ul>
    </StaticPage>
  )
}
