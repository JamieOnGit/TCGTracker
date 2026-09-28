import { StaticPage, staticMeta } from '@/lib/staticPage'

export const metadata = staticMeta('/api/', 'Public Data API – TCG Market Cap, Prices & Population', 'Read-only, versioned JSON API for cards, sets, market cap rankings, price history and population history.')

export default function Api() {
  return (
    <StaticPage path="/api/" h1="Public data API" eyebrow="TCG Trade">
      <p>A read-only, versioned API at <code>/api/v1/</code> is planned (brief phase 4). Every request needs an API key; free and paid tiers have different rate limits. It will be documented with OpenAPI.</p>
      <h2>Planned endpoints</h2>
      <ul>
        <li><code>GET /api/v1/cards</code>, <code>/api/v1/cards/{'{card_id}'}</code></li>
        <li><code>GET /api/v1/sets</code></li>
        <li><code>GET /api/v1/market-cap?game=&amp;lang=&amp;grade=</code></li>
        <li><code>GET /api/v1/cards/{'{card_id}'}/prices</code>, <code>/population</code></li>
      </ul>
    </StaticPage>
  )
}
