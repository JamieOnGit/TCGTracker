# 09 — AU retailer registry (Pokémon TCG / One Piece sealed)

**Date:** 2026-10-01 · **Data:** `09-retailer-registry.json` (67 stores)

## Method

- Found candidates with web search ("pokemon booster box australia", "one piece card game booster box australia shop", "pokemon tcg australia online store", plus searches on the seed names), then probed each store.
- Every request sent the honest UA `TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/)` and checked robots.txt first (stdlib `robotparser`, our UA). Requests to the same store were at least 2.5 s apart. The first pass made up to 4 requests per store. Some stores got 1–2 more follow-up requests later to page `collections.json` past 250 or to verify a hand-picked handle.
- Steps: `/robots.txt` → `/products.json?limit=1` (Shopify) → `/collections.json?limit=250` → `/collections/<handle>/products.json?limit=1`. For WooCommerce: `/wp-json/wc/store/v1/products?per_page=1` → `/products/categories?per_page=100`.
- We stopped at the first challenge, 403, 429 or 202 JS interstitial, with no retries and no workarounds. All probes ran from a **US cloud IP** (Cloudflare `IAD` edge).
- Prices are assumed to be GST-inclusive AUD for every store (all are AU retailers). Shopify variants expose `available` and the WooCommerce Store API exposes `is_in_stock`.

## Counts

| | Stores | feed_ok |
|---|---|---|
| Shopify | 45 | 39 |
| WooCommerce | 2 | 2 |
| Other (custom / Neto / unknown) | 20 | 0 |
| **Total** | **67** | **41** |

Of the 41 stores with a working feed, 39 have a Pokémon collection and 33 have a One Piece collection.

Why the other 26 have no usable feed:

| Reason | Stores |
|---|---|
| challenge | 10 |
| no-feed (no JSON feed, or the collection is empty or singles-only) | 14 |
| 403 | 1 (That TCG Store) |
| robots | 1 (TCG Collectors) |

There were no 429s.

## Big-box retailers

| Retailer | Result from US cloud IP | Try from AU server? |
|---|---|---|
| EB Games | Cloudflare challenge on robots.txt | Yes, maybe |
| ZiNG Pop Culture | Cloudflare challenge on robots.txt | Yes, maybe |
| Kmart | Akamai 403 on robots.txt | Yes, likely geo/IP-reputation |
| BIG W | 403 challenge on robots.txt | Yes, likely geo/IP-reputation |
| Mr Toys Toyworld | Cloudflare challenge | Yes, maybe |
| Amazon AU | 503 robot check | No: use PA-API |
| JB Hi-Fi | **Not blocked.** Shopify feed is open, but no TCG collection found (750+ collections; `pokemon-trading-cards` is empty; the category page is a search-driven nested path) | n/a: watch specific `/products/<handle>.json` |
| Target AU | Reachable, custom platform (see 07 for `api.target.com.au`) | n/a: custom adapter |
| Myer, David Jones | Reachable, custom platforms, no feed, little TCG stock | Low priority |
| Toys"R"Us AU, Kidstuff, Toyworld | **Shopify, open feeds** (`pokemon-tcg`, `pokemon`, `trading-cards`) | n/a |

Some specialists were also blocked: Vault of the Cards (Shopify returned 401 plus a challenge page), Overhauled Games (Cloudflare), and JToys and Mystical Merchants (HTTP 202 SiteGround-style JS challenge on every path). Re-check these from an AU IP as well.

## Surprises and notes

- **Most specialists run Shopify with open feeds.** Collection quality varies a lot, though. Many stores have hundreds of per-set or per-character collections; a few have no Pokémon sealed collection at all (PokeSource, Card Traders) and need `all` plus a title/product_type filter.
- **Several handles mix in singles, LEGO, plush or "Live Break" items.** The monitor should filter sealed products by title and product_type keywords (booster box, ETB, bundle, tin, blister, collection).
- **Good Games' `tcg.` subdomain returns empty collections.** Use `www.goodgames.com.au` instead.
- **Mind Games** (WooCommerce) sets robots `Crawl-delay: 10`. That is fine at 1 req/min.
- **Possibly Neto/Maropost (no JSON feed):** Cards by Brammers, TrainerHub and Chaotic Factory. They would need sitemap or HTML parsing. Misty's Collectables' platform is unidentified.
- **Unreachable through the research proxy:** The Feisty Lizard and Mochi Pals. Retry these from production.
- **Lookalike domains** appeared in search results: `trainertownshop.shop` and an IDN `pokéboxaustralia.com`. Both are possibly scam clones. We did not probe them or include them in the registry.
- Seed names that turned up nothing: Card Merchant, Jolly Roger Games, Gamers Guild (only a Gameology membership program), K&M Cards, The Card Vault, Big Box Collectibles, Next Level Games.
