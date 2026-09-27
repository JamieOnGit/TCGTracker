import { absoluteUrl, siteName } from '@/lib/seo/urls'

export const revalidate = 86400

/** llms.txt (brief 8): what the site is, key pages, methodology and API. */
export function GET() {
  const u = absoluteUrl
  const body = `# ${siteName()}

> Australian market data, marketplace and retail drop alerts for graded Pokémon TCG and One Piece Card Game cards. Japanese (JP) and English (EN) printings are tracked as separate cards. All prices are in Australian dollars (AUD).

Market cap = graded population × floor price, per card and grade (PSA 10 by default). Floor = lowest current ask for that exact card, language and grade (our marketplace first, then an approved external source), with outlier rules and a last-sale fallback. Full definitions: ${u('/methodology/')}

## Key pages
- [Market cap rankings](${u('/')}): all cards ranked by PSA 10 market cap
- [Market cap by game and language](${u('/market-cap/')})
- [Card catalogue](${u('/cards/')}): game → language → set → card. Each card page has market cap by grade, population and price history as HTML tables, listings and sold history.
- [Marketplace](${u('/marketplace/')}): listings from Australian collectors, reviewed before going live
- [Retail drops](${u('/drops/')}): public, delayed history of restocks and pre-orders at Australian retailers
- [News](${u('/news/')})

## Data
- [Methodology](${u('/methodology/')})
- [Datasets (CSV/JSON)](${u('/data/')}): licence and attribution terms
- [Public API](${u('/api/')}): read-only, versioned at /api/v1/, API key required

## Identifiers
Every card has a stable card_id shown on its page and in the API, mapped to external IDs such as PSA SpecID.
`
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
