import { JsonLd } from '@/components/JsonLd'
import { dataset } from '@/lib/seo/jsonld'
import { StaticPage, staticMeta } from '@/lib/staticPage'

export const metadata = staticMeta('/data/', 'Open Data – Daily Graded Card Market Cap Datasets (CSV & JSON)', 'Download daily market cap snapshots and set summaries for Pokémon and One Piece graded cards, with licence and attribution terms.')

export default function Data() {
  return (
    <StaticPage path="/data/" h1="Data downloads" eyebrow="TCG Trade">
      <p>Daily market cap snapshots and set summaries, as CSV and JSON. Downloads open once our data sources are live and their licences confirm redistribution is allowed. Third-party data is only included where its terms permit.</p>
      <h2>Licence</h2>
      <p>Our own data (marketplace asks and sales, derived market caps where upstream terms allow) will be published under CC BY 4.0: credit this site with a link back.</p>
      <JsonLd data={dataset({ name: 'Daily graded card market cap snapshots', description: 'Daily card × grade market cap snapshots in AUD.', path: '/data/', dateModified: '2026-09-27' })} />
    </StaticPage>
  )
}
