# Section 14 report: summary and decisions needed

Researched 2026-09-27 from a cloud container with a US IP. The full reports are next to this file. Anything we couldn't confirm from a primary source is marked UNVERIFIED in those reports.

| # | Topic | Headline | Report |
|---|---|---|---|
| 14.1 | PSA API | The API **does** have a per-grade population endpoint (`/pop/GetPSASpecPopulation/{specID}`). But the quota is 100 calls/day (reports say about 1/day since June 2026), there's no way to list SpecIDs, and PSA's published terms allow only **personal, non-commercial** use and ban scraping. The API End User Agreement is behind a login and hasn't been read. **We can't use it for the market cap without a paid plan or licence.** | [01-psa-api.md](01-psa-api.md) |
| 14.2 | Pricing | **PriceCharting** is the only source verified to cover Pokémon EN, Pokémon JP, One Piece EN and One Piece JP as separate records with PSA 10 prices. It costs US$49/mo for API/CSV, but its standard licence is **internal use only**, so public display needs a signed commercial licence. Its "Grade 9" mixes PSA 9 and BGS 9. All 20 sample cards mapped one-to-one to a catalogue key, JP and EN separately. Fallbacks for Pokémon only: Scrydex (US$99/mo) and JustTCG (US$49/mo). There's no fallback for One Piece JP. | [02-pricing-sources.md](02-pricing-sources.md), [sample-20-cards.json](sample-20-cards.json) |
| 14.3 | Catalogue | pokemontcg.io is deprecated and shuts down on 1 Mar 2027. **TCGdex** (free, MIT) covers Pokémon EN and JP with official JP set codes. **Scrydex** (from US$29/mo) is a maintained EN+JP feed and permits image display. For One Piece, Bandai's official card lists are the only complete JP source, and their terms forbid reproduction. **No source grants commercial rights to card images.** Launch with seller photos and get legal advice before using stock scans. JP and EN Pokémon cards have different set codes *and* numbers (EN 151 #199 is JP SV2a #201), so counterpart links need a person to curate them. | [03-catalogue-sources.md](03-catalogue-sources.md) |
| 14.4 | Retailers | **JB Hi-Fi:** feasible (its Algolia search JSON, no anti-bot clause in the terms). All of its One Piece stock is third-party marketplace sellers. **Premium Bandai AU:** technically feasible, but its terms **explicitly ban robots/spiders**, and it doesn't sell Pokémon. **EB Games, BIG W, Kmart:** blocked our cloud IP at the edge (Cloudflare, Akamai), including robots.txt. They need re-checking from an Australian home connection. | [04-retailers.md](04-retailers.md) |
| 14.5 | Design review | cardscentral.com blocks automated browsers (Vercel checkpoint, HTTP 429). We didn't try to get past it. A proposed token set (palette, fonts, contrast-checked) is in the report. **We need screenshots from Jamie.** | [05-design-review.md](05-design-review.md) |

## Recommendations (each needs Jamie's approval)

1. **Pricing:** PriceCharting plus a commercial licence as the primary source. Optionally add JustTCG or Scrydex as a PSA 9 cross-check for Pokémon.
2. **Population:** email PSA (collectors-apis@collectors.com) for a paid plan or data licence, and GemRate for its partner API. Until then, launch without population-based market cap, or show only populations we're licensed for.
3. **Catalogue:** TCGdex for Pokémon (free), with Scrydex Starter if budget allows. The official Bandai lists for One Piece, storing facts only, subject to legal review.
4. **Images:** seller photos at launch, with stock scans only after legal advice.
5. **Retailers:** start with JB Hi-Fi only. Hold Premium Bandai until Jamie accepts or declines the terms risk, or gets permission. Re-check EB Games, BIG W and Kmart from an AU connection.
6. **FX:** the RBA's daily F11.1 table (free, CC BY 4.0, AUD-based). Already implemented.
