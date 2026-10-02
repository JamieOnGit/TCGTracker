import { GUIDES } from '@/content/guides'
import { absoluteUrl, dropsStatePath, GAME_NAMES, GAMES, guidesPath, inStockPath, productsPath, stockPath, releasesIcsPath, releasesPath, scoutsPath, siteName, storesPath } from '@/lib/seo/urls'

export const revalidate = 86400

/** llms.txt (brief 8): what the site is, key pages, methodology and API. */
export function GET() {
  const u = absoluteUrl
  const body = `# ${siteName()}

> Australian market data, marketplace and retail drop alerts for graded Pokémon TCG and One Piece Card Game cards. Japanese (JP) and English (EN) printings are tracked as separate cards. All prices are in Australian dollars (AUD).

Rankings use each card's market price: the ungraded Near Mint card's recent-sales price (JustTCG), in AUD, with PSA 10 values alongside. Market cap = graded population × floor price, per card and PSA grade. Floor = lowest current ask for that exact card, language and grade (our marketplace first, then an approved external source), with outlier rules and a last-sale fallback. Full definitions: ${u('/methodology/')}

## Key pages
- [Market cap rankings](${u('/')}): all cards ranked by PSA 10 market cap
- [Market cap by game and language](${u('/market-cap/pokemon/')}), [One Piece](${u('/market-cap/one-piece/')})
- [Card catalogue](${u('/cards/')}): game → language → set → card. Each card page has market cap by grade, population and price history as HTML tables, listings and sold history.
- [Marketplace](${u('/marketplace/')}): listings from Australian collectors, reviewed before going live
- [Retail drops](${u('/drops/')}): public, delayed history of restocks and pre-orders at Australian retailers (JB Hi-Fi, BIG W, Kmart, Target, EB Games, Premium Bandai AU) from website monitors and confirmed member in-store sightings. Per retailer: /drops/{retailer}/ (e.g. ${u('/drops/kmart/')}); per state: /drops/{state}/ (e.g. ${u(dropsStatePath('VIC'))}); top reporters: ${u(scoutsPath())}
- [In stock now](${u(inStockPath())}): Pokémon and One Piece sealed products in stock or on pre-order right now at Australian stores, grouped by product, with the lowest price against RRP
- [Sealed products](${u(productsPath())}): one page per sealed product at /products/{game}/{lang}/{slug}/ (e.g. booster boxes, Elite Trainer Boxes), with a store-by-store availability table (status, price, difference from RRP, last change), RRP in AUD and restock history. Per game: ${GAMES.map((g) => u(productsPath(g))).join(', ')}
- [Live stock](${u(stockPath())}): live Pokémon and One Piece stock at Australian stores, refreshed every minute: listings in stock and on pre-order per store, the most available products, and in-store member sightings by state. Per store, every listing with price and last change: /stock/{store}/ (e.g. ${u(stockPath('kmart'))})
- [Stores we watch](${u(storesPath())}): every store in the feed and how it is covered: checked live from the store's openly published catalogue, or by member sightings where a store blocks automated access or has no online catalogue
- [eBay deals](${u('/deals/')}): graded cards listed on eBay (official eBay API) below our market value for that card and grade
- [Release calendar](${u('/releases/')}): Australian release dates for English and Japanese sets and products, with date precision (day, month, quarter or TBC), confidence (official, retailer listing, unconfirmed), RRP in AUD and stockists. ${GAMES.map((g) => `${GAME_NAMES[g]}: ${u(releasesPath(g))}`).join('; ')}. Each release has a page at /releases/{game}/{slug}/. iCalendar feed: ${u(releasesIcsPath())}
- [Guides](${u(guidesPath())}): evergreen guides for Australian collectors
${GUIDES.map((g) => `  - [${g.title}](${u(guidesPath(g.slug))}): ${g.dek}`).join('\n')}
- [News](${u('/news/')})

## Data
- [Methodology](${u('/methodology/')})
- [Datasets (CSV/JSON)](${u('/data/')}): licence and attribution terms
- [Public API](${u('/api/')}): read-only, versioned at /api/v1/, API key required

## Identifiers
All dates and times are Australian: calendar dates for releases, AEST/AEDT (Australia/Melbourne) for events.

Every card has a stable card_id shown on its page and in the API, mapped to external IDs such as PSA SpecID.
`
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
