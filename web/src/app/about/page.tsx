import Link from 'next/link'
import { StaticPage, staticMeta } from '@/lib/staticPage'
export const metadata = staticMeta('/about/', 'About TCG Trade – Australia’s Graded Card Market', 'TCG Trade is an independent Australian site for Pokémon and One Piece card collectors: market data in AUD, a reviewed marketplace and 24/7 retail drop alerts.')
export default function About() {
  return (
    <StaticPage path="/about/" h1="About TCG Trade" eyebrow="Made in Australia" lead="The graded card market, measured in Australian dollars.">
      <p>TCG Trade exists because Australian collectors deserve local prices, local sellers and local restock alerts. Global price guides quote US dollars and US shops; we quote AUD and watch the stores you actually buy from.</p>
      <h2>What we do</h2>
      <ul>
        <li><Link href="/">Market cap rankings</Link> for graded Pokémon and One Piece cards, English and Japanese, in AUD.</li>
        <li>A <Link href="/marketplace/">marketplace</Link> where every listing is reviewed and buyers message sellers on-site.</li>
        <li><Link href="/drops/">Retail drop alerts</Link> for JB Hi-Fi, BIG W, Kmart, Target and more, checked around the clock.</li>
      </ul>
      <p>TCG Trade is independent and not affiliated with The Pokémon Company, Nintendo, Bandai or any retailer.</p>
    </StaticPage>
  )
}
