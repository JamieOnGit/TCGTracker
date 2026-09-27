import Link from 'next/link'
import { JsonLd } from '@/components/JsonLd'
import { dataset } from '@/lib/seo/jsonld'
import { StaticPage, staticMeta } from '@/lib/staticPage'

export const metadata = staticMeta('/methodology/', 'Methodology – How We Calculate Graded Card Market Cap', 'Exactly how market cap, floor price, outliers, FX and refresh times are calculated, with sources and attribution.')

// Keep in step with workers/tcgworkers/market/floor.py and market_cap.py.
export default function Methodology() {
  return (
    <StaticPage path="/methodology/" h1="Methodology">
      <h2>Market cap</h2>
      <p><code>market cap (card, grade) = graded population (card, grade) × floor price (card, grade)</code></p>
      <p>The default view is PSA 10: PSA 10 population × PSA 10 floor price. We also show per-grade market caps for other grades we have data for, and a card total (the sum across grades) as a secondary figure. Japanese and English versions of a card are separate cards with separate populations, prices and market caps.</p>
      <h2>Floor price</h2>
      <p>The floor is the lowest current asking price for that exact card, language and grade. Every floor carries its source, the time it was observed and how many asks it was drawn from.</p>
      <ol>
        <li>If there are active, approved listings on our marketplace, the floor is the lowest of them.</li>
        <li>Otherwise it is the lowest current ask from our approved external pricing source. Asks older than 7 days are ignored.</li>
        <li>If there is no valid ask, we use the most recent sale and label it &quot;last sale&quot;.</li>
        <li>If there is no data at all we show &quot;—&quot; and leave the card out of the ranking.</li>
      </ol>
      <h2>Outliers</h2>
      <p>Asks below 50% of the card&apos;s 30-day median sold price are ignored as likely errors or scams, once there are at least 3 sales in that window. Staff can also exclude individual data points; excluded points are logged.</p>
      <h2>Currency</h2>
      <p>Everything is shown in Australian dollars. Prices in other currencies are converted with the Reserve Bank of Australia&apos;s daily indicative rate (table F11.1). We store the original price, currency and the rate and date used.</p>
      <h2>Refresh times</h2>
      <ul>
        <li>Floor prices: every 4 hours</li>
        <li>Population: daily (or as often as the source allows)</li>
        <li>FX rates: daily</li>
        <li>Market cap snapshots: daily, used for 7-day and 30-day changes</li>
      </ul>
      <h2>Sources and attribution</h2>
      <ul>
        <li>Population: PSA — licence pending, not yet live.</li>
        <li>External prices: pending selection and approval.</li>
        <li>Marketplace asks and sales: this site.</li>
        <li>FX: Reserve Bank of Australia, CC BY 4.0.</li>
      </ul>
      <p>Data licence and downloads: <Link href="/data/">/data/</Link>. API: <Link href="/api/">/api/</Link>.</p>
      <JsonLd data={dataset({ name: 'Graded card market cap methodology', description: 'Definitions for market cap, floor price, outliers and FX.', path: '/methodology/', dateModified: '2026-09-27' })} />
    </StaticPage>
  )
}
