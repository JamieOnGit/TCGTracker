import Link from 'next/link'
import { JsonLd } from '@/components/JsonLd'
import { dataset } from '@/lib/seo/jsonld'
import { StaticPage, staticMeta } from '@/lib/staticPage'

export const metadata = staticMeta('/methodology/', 'Methodology – How TCG Trade Calculates Card Values & Market Cap in AUD', 'Exactly how TCG Trade calculates graded card values, market cap, price changes and AUD conversion, where the data comes from, and how often it updates.')

// Keep in step with workers/tcgworkers/market/floor.py, market_cap.py and sources/pricing/pricecharting.py.
export default function Methodology() {
  return (
    <StaticPage path="/methodology/" h1="Methodology" eyebrow="How the numbers work" lead="Every figure on TCG Trade comes from a documented rule. Here they are.">
      <h2>Market cap</h2>
      <p><code>market cap (card, grade) = graded population (card, grade) × value (card, grade)</code></p>
      <p>We show PSA 10 by default, with other grades on each card page. Japanese and English printings are separate cards with their own populations, values and market caps. Until licensed PSA population data is connected, rankings are ordered by PSA 10 value and the market-cap column shows “—”.</p>
      <h2>Value (the floor)</h2>
      <p>The value of a card in a grade is the lowest current asking price for that exact card, language and grade:</p>
      <ol>
        <li>If there are live, approved listings on TCG Trade, it is the lowest of them.</li>
        <li>Otherwise it is the current market value from our pricing partner, PriceCharting, converted to AUD.</li>
        <li>If there is no current price, we use the most recent sale and label it “last sale”.</li>
        <li>With no data at all we show “—” and leave the card out of the rankings.</li>
      </ol>
      <p>PriceCharting’s PSA 10 figure is PSA-specific. Its grade 9 figure combines PSA 9 and BGS 9 sales, so we label it “Grade 9”.</p>
      <h2>Outliers</h2>
      <p>Asks below 50% of a card’s 30-day median sale price are ignored as likely errors or scams, once there are at least 3 sales in that window. Staff can exclude individual data points; every exclusion is logged.</p>
      <h2>Australian dollars</h2>
      <p>All prices are in AUD. USD prices are converted with the Reserve Bank of Australia’s daily indicative rate (table F11.1, CC BY 4.0). We store the original price, currency and the rate and date used.</p>
      <h2>How often it updates</h2>
      <ul>
        <li>Values: every 4 hours</li>
        <li>Population: daily, once a licensed source is connected</li>
        <li>Exchange rates: daily</li>
        <li>History and 7/30-day changes: one snapshot per day (Melbourne time)</li>
        <li>Retail drops: every 1–2 minutes for watched products, every 5 minutes for discovery, 24/7</li>
      </ul>
      <h2>Sources</h2>
      <ul>
        <li>Prices: PriceCharting (with permission), and the TCG Trade marketplace</li>
        <li>Population: PSA (licence pending)</li>
        <li>Exchange rates: Reserve Bank of Australia</li>
        <li>Retail availability: the retailers’ own public product pages</li>
      </ul>
      <p>Downloads and licence: <Link href="/data/">Data</Link>. API: <Link href="/api/">API</Link>. Values are indicative, not financial advice.</p>
      <JsonLd data={dataset({ name: 'TCG Trade methodology', description: 'Definitions for card value, market cap, outliers and AUD conversion.', path: '/methodology/', dateModified: '2026-09-28' })} />
    </StaticPage>
  )
}
