# 03 — Card catalogue sources (brief §14.3 / §4.4)

Researched 2026-09-27. Scope: catalogue data for **Pokémon EN, Pokémon JP, One Piece EN, One Piece JP**. JP and EN printings are separate catalogue cards, linked by `counterpart_card_id`. Covers image rights as well.

Method: I read public docs, terms pages and site footers, and made a few sample requests to each API (no sign-ups, no payments). Anything I could not check today is marked **UNVERIFIED**. This is research, not legal advice. Every statement about image rights is flagged **for legal review**.

---

## 1. Summary table

| Source | Pokémon EN | Pokémon JP | One Piece EN | One Piece JP | Access | Cost | Images | Data licence / terms | Status today |
|---|---|---|---|---|---|---|---|---|---|
| **Pokémon TCG API** (pokemontcg.io) | Yes (legacy) | No | No | No | REST + GitHub JSON dump | Free (legacy keys) | `images.pokemontcg.io` (still serving) | Deprecated; "taken offline on March 1, 2027" | `api.pokemontcg.io` returned **HTTP 500/502** again at 09:06 UTC. New registrations are closed. |
| **Scrydex** (successor to pokemontcg.io) | Yes | Yes (~238 JP expansions listed) | Yes (OP/ST/EB/PRB/P) | **No JP found** (`/onepiece/jp/expansions` returns 404) | REST, API key (`X-Api-Key` + `X-Team-ID`) | From **US$29/mo** (5k credits). No free tier seen. | `images.scrydex.com`. The docs say you are "free to include" them and may self-host them. | ToS forbids redistribution and use as a "wholesale data source for a competing commercial product". Third-party IP "remains the property of its respective owners". | Live |
| **TCGdex** (api.tcgdex.net) | Yes (220 sets) | Yes (**184 sets**, ids like `SV2a`) | No | No | REST + GraphQL, no key | Free | `assets.tcgdex.net`. **JP images are patchy**: missing for PMCG1, M2a and M6. | Database under the **MIT** licence. "not produced, endorsed, supported or affiliated with Nintendo or The Pokémon Company". Images are not covered by MIT (see §4). | Live, prices included (Cardmarket) |
| **pokemon-card.com** (official JP) | No | Yes (authoritative) | No | No | HTML plus an undocumented JSON endpoint (`/card-search/resultAPI.php`) | Free | Official scans | **Personal use only**. Copying, reposting and use on other networks are forbidden (quoted in §3.4). | Live. No robots.txt (404). |
| **pokemon.com card DB** (official EN) | Yes (authoritative) | No | No | No | HTML only | Free | Official scans | Terms **UNVERIFIED** (site blocked, see §3.5) | curl returns **403 (Imperva/Incapsula bot wall)**. The Wayback Machine was not reachable. |
| **Limitless TCG** (limitlesstcg.com) | Yes | Yes (full JP list incl. M6a 16 Sep 26) | Yes (onepiece.limitlesstcg.com) | Not a separate JP print DB (the JP view appears to be UI language only, UNVERIFIED) | HTML. The API is for **tournaments only**, not cards. | Free site | Hosted on DigitalOcean CDN (`limitlesstcg.nyc3.cdn.digitaloceanspaces.com`) | Footer states the images are © TPC/Nintendo/Game Freak/Creatures (or Oda/Shueisha/Toei/Bandai). No ToS page (`/terms` returns 404). robots.txt allows everything. | Live. Good for cross-checking and for EN↔JP mapping. |
| **Official OPCG EN** (en.onepiece-cardgame.com/cardlist) | No | No | Yes (authoritative, incl. `_pN` parallels) | No | HTML (one page per series) | Free | Official scans `/images/cardlist/card/OP05-119_p1.png` | "All images, text and data on this website may not be reproduced without permission." | Live. No robots.txt (404). |
| **Official OPCG JP** (www.onepiece-cardgame.com/cardlist) | No | No | No | Yes (authoritative) | HTML | Free | Official scans | 「すべての画像・テキスト・データの無断転用、転載をお断りします。」 | Live |
| **OPTCG API** (optcgapi.com) | No | No | Yes ("based off the english release"), OP-01..OP-15 + ST + promos + DON | No | REST, no key | Free | Self-hosted `optcgapi.com/media/static/Card_Images/…` | No licence stated. Hobby project by one person. | Live, prices scraped daily |
| **apitcg.com** | Yes | UNVERIFIED | Yes | UNVERIFIED | REST, needs a free API key (account) | Free key | Returns `images` field | No public ToS found (`/terms` returns 404) | Live. Not tested (sign-up needed). |
| **JustTCG** | Yes | Yes ("Pokemon Japan 30K+ cards") | Yes | UNVERIFIED | REST, key | Free tier is **non-commercial only**; paid from US$19/mo | No images found in docs (pricing API) | Paid tiers allow "End-user display" of prices. No redistribution of raw data. | Live. More relevant to pricing (doc 04?) than to the catalogue. |
| **PriceCharting** | Yes | Partial (UNVERIFIED) | Yes | UNVERIFIED | API/CSV, paid only | Paid | — | "licensed for **internal use only**". Displaying to users needs a commercial licence. | Live. Not suitable as the catalogue source. |
| **Bulbapedia** | Reference | Reference | No | No | MediaWiki | Free | Card scans on Bulbagarden Archives | **CC BY-NC-SA 2.5** (confirmed via its MediaWiki API). **Non-commercial**, so it cannot be used on a commercial site. | Cloudflare challenge on HTML. API reachable. |

**Bottom line.** No single source covers all four catalogues.
- **Pokémon:** Scrydex (paid) is the only maintained API that covers both EN and JP with stable IDs and images. TCGdex (free, MIT) covers EN and JP metadata well, but its JP images have gaps.
- **One Piece:** the official Bandai card lists are the only authoritative source for **both** EN and JP. Their IDs (`OP05-119`, `OP05-119_p1`) are the de-facto standard that every aggregator reuses.

---

## 2. How set codes and numbers differ between EN and JP (drives `counterpart_card_id`)

### 2.1 Pokémon: different set codes AND different card numbers

Verified with TCGdex and Scrydex. Example: the "151" set.

| | EN | JP |
|---|---|---|
| Official set name | *Scarlet & Violet—151* | ポケモンカード151 |
| Printed set code / abbreviation | `MEW` (TCGdex `abbreviation.official`, Limitless) | `SV2a` |
| pokemontcg.io / Scrydex id | `sv3pt5` | `sv2a_ja` (Scrydex) |
| TCGdex id | `sv03.5` | `SV2a` |
| Release | 2023-09-22 | 2023-06-16 |
| Cards (official / total) | 165 / 207 | 165 / 210 |
| Charizard ex SIR | **199/165** (`sv3pt5-199`, `sv03.5-199`) | **201/165** (`sv2a_ja-201`, `SV2a-201`) |
| Card #205 | Mew ex **Hyper Rare** (gold) | Mew ex **Special Illustration Rare** (the same number is a different print) |

Consequences:
- Pokémon JP↔EN mapping is **not derivable** from set code + number. JP sets are often split or merged into EN sets. For example, JP SV1S + SV1V + SV1a feed EN *Scarlet & Violet* and *Paldea Evolved* (UNVERIFIED which cards go where). Secret-rare numbering also differs.
- Some JP cards have **no EN counterpart** (JP-only promos and decks such as MC "Starter Deck 100 Battle Collection", 774 cards). Some EN cards have no JP counterpart (EN-exclusive promos, trainer kits).
- The mapping must be **curated**: seeded by name + illustrator + rarity matching, then human-confirmed. `counterpart_card_id` must be nullable and many-to-one tolerant. Neither TCGdex nor Scrydex exposes a cross-language link field that I could find (UNVERIFIED for Scrydex's full schema).
- Pokémon JP rarity codes differ (SAR / AR / SR / UR / HR / ACE / S / SSR / CHR / CSR…) from EN names (Special Illustration Rare, Illustration Rare, Hyper Rare…). Store both `rarity_code` (as printed) and `rarity_normalized`.

### 2.2 One Piece: same card number across languages, but variant suffixes are NOT stable

Verified on the official EN and JP card lists for OP-05 (`series=569105` EN / `550105` JP):
- Both lists contain exactly 154 entries, with the **same base numbers**: `OP05-119` is Monkey.D.Luffy SEC in both.
- `OP05-119`, `OP05-119_p1` (alt art) and `OP05-119_p2` (manga) exist in both, with the same image filenames.
- **But:** the ST01-012 reprint parallel inside OP-05 is `ST01-012_p2` on the EN list and `ST01-012_p4` on the JP list. **The `_pN` suffix is an ordinal assigned per language, not a semantic variant code.**
- One base number spans many products. OPTCG API lists 9 prints of `OP05-119`: `_p1` alt art, `_p2` manga, `_p4` (a later alt art), `_p6` Wanted Poster, `_p7` SP, `_p8` SP gold, `_r1` reprint, `_r2` manga reprint. The `_r*` ids are OPTCG API's own invention, not Bandai's (UNVERIFIED).
- Scrydex instead uses semantic variant names on one card id: `OP05-119?variant=altArt | mangaAltArt | foil`.
- **Release timing:**
  - Historically JP led EN by several months (UNVERIFIED for exact gaps; for example OP-05 was JP early 2023 and EN later 2023).
  - Now they are near-simultaneous: **OP-18 JP 2026-11-21 (土) vs EN 2026-11-20** (both official product pages). OP-17 EN release was 2026-08-28.
  - Product packaging still diverges. JP has a stand-alone **EB-04 "EGGHEAD CRISIS"**, while the EN card list labels OP-14 and OP-15 as `[OP14-EB04]` / `[OP15-EB04]`, i.e. EB-04 cards were folded into EN boosters.
  - Card *numbers* (`EB04-xxx`) are presumably still identical across languages. This is UNVERIFIED and worth a spot check.
- Consequence: for One Piece, `counterpart_card_id` can usually be auto-proposed by `(base_number, variant_semantic)`. It must **not** be proposed by `(base_number, _pN)`. We need our own semantic `variant` value per print (base / alt_art / manga / sp / sp_gold / wanted / treasure / promo-stamp / reprint).

---

## 3. Per-source notes

### 3.1 Pokémon TCG API (pokemontcg.io) — deprecated, do not build on it

- The `https://pokemontcg.io/` page title says "Pokémon TCG API - Now part of Scrydex". Body: "The Pokémon TCG API is now part of Scrydex - a suite of TCG developer APIs."
- `https://docs.pokemontcg.io/` banner: *"The Pokémon TCG API is deprecated. New account registrations are no longer available. Existing API keys will continue to function through March 1, 2027. Please migrate your application to Scrydex."*
- GitHub `PokemonTCG/pokemon-tcg-data` README: *"The Pokémon TCG API is scheduled to be taken offline on March 1, 2027."* and *"this repository should not be used as the primary data source for new applications."* The dump is still being updated: the last set in `sets/en.json` is `me55c`, released 2026/09/16.
- Live check 2026-09-27 ~09:06 UTC:
  - `GET https://api.pokemontcg.io/v2/sets?pageSize=1` returned **502**.
  - `/v2/cards/sv3pt5-1` returned **500**.
  - `images.pokemontcg.io/sv3pt5/1.png` returned 200.
- Coverage: EN only. No licence file in the data repo (`LICENSE` returns 404).
- The ids (`sv3pt5-199`) carry over to Scrydex EN, which is useful as a migration key.

### 3.2 Scrydex (scrydex.com)

- Games: Pokémon (EN + JA + TCG Pocket), MTG, Lorcana, Gundam, One Piece (beta), Riftbound (beta).
- **Pokémon JP:** `https://scrydex.com/pokemon/jp/expansions` lists 238 JP expansions, from `base1_ja` through `m2a_ja` and `m6a_ja`. The expansion object has `language_code` ("EN", "JA") and a translation block for non-English expansions.
- **One Piece JP:** `/onepiece/jp/expansions` returned 404, and the OP expansion list has 0 `_ja` ids, so **EN only** (as of today; UNVERIFIED whether planned).
- IDs:
  - Card id = `{expansion_id}-{number}`: `sv3pt5-199`, `sv2a_ja-201`, `OP05-119`.
  - Variants are a nested array with names (`holofoil`, `unlimitedHolofoil`, `altArt`, `mangaAltArt`).
  - `printed_number`, `rarity_code`, `expansion_sort_order`, release date on the expansion.
- Access: `https://api.scrydex.com/pokemon/v1/cards/<id>` with `X-Api-Key` + `X-Team-ID` (the unauthenticated root returns 401). 1 credit per request, 5 per Vision call. Per-second rate limit returns 429.
- **Pricing** (scrydex.com/pricing): Starter **$29/mo** for 5,000 credits (+$0.006 overage), Growth $99/mo for 50k, Professional $399/mo for 250k, Enterprise custom. No free tier seen.
- **Images** (docs/getting-started/best-practices): *"When using the Scrydex API, you are free to include the provided card images in your applications."* The docs recommend *"Store Images on Your Own Servers"* and say *"consuming images does not cost any credits"*. They also warn *"Never assume the urls … Always reference the urls as returned by the API."*
- **ToS** (scrydex.com/terms), relevant clauses:
  - §4: you will not *"Resell, sublicense, redistribute, mirror, or commercially exploit the Services without prior written authorization"* nor *"Use the Services primarily as a substitute backend, proxy, or wholesale data source for a competing commercial product or service without written authorization"*.
  - §9: *"Any third-party card data, metadata, trademarks, or related content accessible through the Services remains the property of its respective owners or licensors. Scrydex does not claim ownership of third-party intellectual property."*
  - So Scrydex's permission to "include" images is permission from **Scrydex**. It is not a licence from The Pokémon Company or Bandai (**legal review**).
- Also offers prices, graded prices, pop reports, sold listings and Vision card-ID. It overlaps with other brief sections (pricing, scanning).

### 3.3 TCGdex (api.tcgdex.net)

- Languages (FAQ): *"English, French, Spanish, German, Italian, Portuguese (Brazilian), Japanese, Chinese (Traditional), Indonesian, and Thai."* Completion varies by language.
- `GET /v2/ja/sets` returns **184 JP sets** across the series PMCG, neo, VS, web, e, ADV, PCG, LEGEND, XY, XY BREAK, SM, S, SV and M. Set ids are the **official JP codes** (`SV2a`, `M2a`, `SV11W`, `M-P`), which is good for our `set_code`.
- JP card: `SV2a-201` gives name リザードンex, rarity "Special illustration rare", illustrator, hp, types, `variants` and `variants_detailed` with Cardmarket product id and EUR pricing. EN set `sv03.5` carries `abbreviation.official = "MEW"`.
- **JP image gaps** (count of cards without an image): PMCG1 102/102, SV2a 0/210, S12a 4/258, **M2a 250/250**, **M6 113/113**. M6a (released 16 Sep 26) is not in TCGdex yet.
- Image URL pattern: `https://assets.tcgdex.net/{lang}/{serie}/{set}/{localId}/{high|low}.{webp|png|jpg}` (verified `…/ja/SV/SV2a/201/high.webp` returns 200 image/webp).
- No key. FAQ: *"The TCGdex API is free to use and requires no API key."* and *"There are no published hard rate limits, but please be considerate. For bulk data needs, cache responses locally."*
- Licence (github.com/tcgdex/cards-database README): *"The Database is licensed under the MIT License"* and *"This database is not produced, endorsed, supported or affiliated with Nintendo or The Pokémon Company."* MIT covers TCGdex's compilation and code. The card images and card text are TPC-owned, and TCGdex cannot license them (**legal review**).
- Community-maintained (images contributed via Discord). Accuracy caveats are acknowledged in their FAQ, e.g. "Why are some Cardmarket or TCGPlayer IDs wrong?"

### 3.4 pokemon-card.com (official JP database)

- Search UI: `https://www.pokemon-card.com/card-search/`. Behind it is an undocumented JSON endpoint: `/card-search/resultAPI.php?keyword=…&regulation_sidebar_form=all`. It returns `cardID` (e.g. `44638`) and the thumbnail path `/assets/images/card_images/large/SV4a/044638_P_RIZADONEX.jpg`.
- Detail pages (`/card-search/details.php/card/{cardID}/regu/all`) show name, image, regulation mark, number (`115 / 190`), rarity icon (`ic_rare_rr.gif`), illustrator, full text and product name. The rarity is an **icon filename, not text**, so it needs mapping. The site's `cardID` is a stable-looking internal integer (UNVERIFIED stability).
- **Site policy** (`https://www.pokemon-card.com/policy.html`, 著作権について): *「このサイトに掲載されているデザイン、写真、映像、文章、音楽、音声など、すべてのコンテンツデータ…の著作権、または使用を許諾する権利は、株式会社ポケモン…に帰属します。データは、個人的に楽しむ場合に限って使用を許諾されるものであり…このサイトからは、データのコピー、複製、改変、出版、掲示、電送、配布することは固くお断りします。またこれらのデータを、他のインターネットなどの公衆ネットワーク上で利用することはできません。」*
  - Gist: content is licensed for personal enjoyment only. Copying, reproduction, modification, publication, posting, transmission and distribution are refused, and the data may not be used on other public networks such as the internet.
- Links: *「当サイトに掲載されている著作物を複製、使用してのリンク設定はご遠慮いただきます。…必ずテキストリンクでお願いいたします。」* In other words, **text links only**. No linking with their images, which bears directly on hot-linking.
- Footer: *「©Pokémon/Nintendo/Creatures/GAME FREAK ポケットモンスター・ポケモン・Pokémonは任天堂・クリーチャーズ・ゲームフリークの商標です。このホームページに掲載された画像その他の内容の無断転載はお断りします。」*
- pokemon.co.jp/rules/ has the same clause for the main Pokémon site.
- **Recommendation:** use for manual verification and as a reference for JP names and numbers only. Do **not** scrape images from it or hot-link them. Scraping the undocumented endpoint at volume is likely against the spirit of the policy (legal review).

### 3.5 pokemon.com card database (official EN)

- `https://www.pokemon.com/us/pokemon-tcg/pokemon-cards` and `/us/legal/terms-of-use` both returned **403 from Imperva/Incapsula** to curl. I did not try to get around the bot wall. Wayback snapshots exist (2026-09-10 / 2026-09-16), but web.archive.org was unreachable through the proxy.
- **UNVERIFIED (from memory, must be re-checked by a human in a normal browser):** the pokemon.com Terms of Use restrict site content to personal, non-commercial use. The card database has historically been HTML-only with no API.
- Treat it like the JP site: reference only, no image reuse.

### 3.6 Limitless TCG

- Pokémon: EN sets are keyed by official abbreviations (`MEW`, …). JP sets are keyed by JP codes (`/cards/jp/SV2a/201`), and the list is current through M6a (16 Sep 26). There is also an "English (transl.)" view of JP cards.
- One Piece: `onepiece.limitlesstcg.com/cards/OP05-119` with images `…/one-piece/OP05/OP05-119_EN.webp`. The JP set list shows the same EN release dates, so treat it as an **EN print DB** (UNVERIFIED).
- Footer (Pokémon): *"The literal and graphical information presented on this website about the Pokémon Trading Card Game, including card images and text, is copyright The Pokémon Company (Pokémon), Nintendo, Game Freak and/or Creatures. This website is not produced by, endorsed by, supported by, or affiliated with Pokémon, Nintendo, Game Freak or Creatures."*
- Footer (One Piece): *"…including card images and text, is copyright Eiichiro Oda/Shueisha, Toei Animation and/or Bandai…"*
- Limitless has **no card API**. docs.limitlesstcg.com/developer covers tournament data only, with rate-limit headers and keys *"only given out to public-facing projects"*.
- No ToS page (`/terms` returns 404). The legal notice names Robin Schulz (Gdańsk, PL). robots.txt: `User-agent: * / Disallow:` (allows all).
- Useful for **EN↔JP mapping research** and spot checks. Not a licensed feed. Scraping it would be a courtesy question to ask them first.

### 3.7 Official One Piece Card Game card lists (Bandai)

- EN: `https://en.onepiece-cardgame.com/cardlist/?series=5691xx` (OP-01 = 569101 … OP-17 = 569117, ST-01 = 569001…, EB = 5692xx, PRB = 5693xx, promos = 569901, other = 569801).
- JP: `https://www.onepiece-cardgame.com/cardlist/?series=5501xx` (same scheme, 550 prefix).
- One HTML page per series contains every card as `<dl class="modalCol" id="OP05-119_p1">`. Fields: id, rarity (`SEC`), type, name, cost, attribute, power, counter, colour, block icon, types, effect text, 入手情報 (source product) and image `../images/cardlist/card/OP05-119_p1.png?260828`.
- There is no release date per card. It comes from the products page (e.g. OP-18 EN "Release Date November 20, 2026"; JP 「発売日 2026.11.21(土)」).
- EN footer: *"©Eiichiro Oda/Shueisha ©Eiichiro Oda/Shueisha, Toei Animation — All images, text and data on this website may not be reproduced without permission."*
- JP footer: *「©尾田栄一郎／集英社 ©尾田栄一郎／集英社・フジテレビ・東映アニメーション このwebサイトに記載されているすべての画像・テキスト・データの無断転用、転載をお断りします。」*
- Bandai corporate site terms (`https://www.bandai.co.jp/site/notice/`): *「私的使用その他法令等によって認められる範囲を超えて、掲載情報を使用（複製、改変、掲示、頒布、ライセンス、販売、出版等を含むが、これに限りません。）することは、バンダイの事前許諾がない限り、禁止いたします。」* In short: use beyond private use or what the law permits is prohibited without Bandai's prior permission.
- No robots.txt (404) on either domain. I found no published fan-content or image-use guideline for the OPCG.
- **Rights holders:** Eiichiro Oda / Shueisha (manga), Fuji TV / Toei Animation (anime-derived art, per the JP footer), and Bandai (game and card design).

### 3.8 OPTCG API (optcgapi.com)

- *"A free to use API … This data is based off the english release of the One Piece Card Game."* Covers "OP-01 through OP-15, as well as all the data from the starter decks", plus promos and DON (added 2026-03-15). OP-16 and OP-17 are **not** included per the homepage.
- `GET /api/sets/card/OP05-119/` returns an array of prints with `card_set_id`, `card_image_id` (`OP05-119_p1`), `card_name` ("(Alternate Art) (Manga)"), rarity, market/inventory price (`date_scraped` 2026-09-26) and `card_image` (self-hosted .jpg).
- No licence or ToS. Footer: *"One Piece and the One Piece Trading Card Game data are trademarks of Eiichiro Oda, Bandai, Shonen Jump, and Viz Media."* Single maintainer, so there is a bus-factor risk.
- Useful as a cross-check of variant naming (alt art / manga / SP / Wanted Poster). Not a foundation.

### 3.9 apitcg.com

- OpenAPI at `https://docs.apitcg.com/openapi.json`. *"All data endpoints require an API key. Getting one is free."* The key is sent in an `x-api-key` header.
- 16 TCGs including `one-piece` and `pokemon`. Endpoints `/api/{tcg}/sets` and `/api/products?tcg=…`. Max `limit` 100. 429 on too many requests.
- JP coverage, image source and terms: **UNVERIFIED** (no public ToS page found; I did not sign up).

### 3.10 JustTCG

- Pricing-first API. The supported-games page lists "Pokemon Japan 30K+ cards", "Pokemon 30K+", "One Piece Card Game 7K+".
- Plans: Free $0 (1,000/mo, 100/day, 10/min), Starter $19, Professional $49, Enterprise $149.
- Terms:
  - *"Use the free tier for commercial, business, scraping, or reselling purposes"* is prohibited: *"the free tier is intended solely for personal, non-commercial use"*.
  - Paid tiers allow *"End-user display: Display current prices, historical trends, and percentage changes to end users"*.
  - All tiers prohibit *"Resell, redistribute, sub-license, or repackage the raw data"*.
- Identifier lesson from their docs: *"Slugs are derived from mutable text (names, sets, rarities), so they are not stable … UUIDs … never change."* This is adopted in §5.
- No card images found in the docs.

### 3.11 PriceCharting

- *"API's are a premium tool. You must have a paid subscription"*.
- *"The API and CSV data are licensed for internal use only. Sharing our price data with a third party, or making it available within an application or service used by others, requires a commercial license and express written permission from us."*
- *"All data gathered from the API or CSV must be purged after your subscription has ended."*
- Not suitable as a catalogue source.

### 3.12 Bulbapedia

- MediaWiki `siteinfo.rightsinfo`: `"Attribution-NonCommercial-ShareAlike 2.5"` (`http://creativecommons.org/licenses/by-nc-sa/2.5/`).
- **NC means it cannot be used on a commercial marketplace.** Card scans on Bulbagarden Archives are TPC-copyright, hosted under US fair-use claims.
- HTML is behind a Cloudflare challenge. Human reference only (set lists, JP↔EN notes).

---

## 4. Image rights

**Flag for legal review. These are observations, not conclusions.**

### 4.1 Who owns what

- **Pokémon cards:** copyright in the artwork, card design and text belongs to The Pokémon Company / Nintendo / Creatures / GAME FREAK (credit line ©Pokémon/Nintendo/Creatures/GAME FREAK). The JP site says rights belong to 株式会社ポケモン (and Creatures). "Pokémon" is a trademark of Nintendo/Creatures/GAME FREAK. Individual illustrators are credited, but TPC controls the rights (UNVERIFIED how illustrator agreements work).
- **One Piece cards:** © Eiichiro Oda / Shueisha, with Fuji TV / Toei Animation for anime-derived content. Bandai owns the card game product and site content.

### 4.2 What the official sites say

| Site | Clause (verbatim) | Effect |
|---|---|---|
| pokemon-card.com / pokemon.co.jp | 「データは、個人的に楽しむ場合に限って使用を許諾…コピー、複製、改変、出版、掲示、電送、配布することは固くお断りします。…他のインターネットなどの公衆ネットワーク上で利用することはできません。」 | Personal use only. No reposting online. |
| pokemon-card.com (links) | 「当サイトに掲載されている著作物を複製、使用してのリンク設定はご遠慮いただきます。…必ずテキストリンクでお願いいたします。」 | Text links only. **Hot-linking their card images conflicts with this.** |
| pokemon.com (EN) | UNVERIFIED (blocked) | Presumed personal / non-commercial |
| en.onepiece-cardgame.com | "All images, text and data on this website may not be reproduced without permission." | No reproduction without permission |
| www.onepiece-cardgame.com | 「すべての画像・テキスト・データの無断転用、転載をお断りします。」 | Same |
| bandai.co.jp notice | 「私的使用その他法令等によって認められる範囲を超えて…事前許諾がない限り、禁止」 | Beyond private use or statutory exceptions, prior permission is needed |

**No official fan-site or commercial image licence was found for either IP.** I found no Pokémon fan-content policy on the reachable JP pages, and no OPCG image-use guideline.

### 4.3 What third-party sources say

- **Scrydex** says you are *"free to include the provided card images"* and may self-host them. It also says third-party IP *"remains the property of its respective owners"*. That permission covers Scrydex's own terms only. It is **not** a rights-holder licence.
- **TCGdex** is MIT for the data. It is silent on image rights and has a non-affiliation disclaimer.
- **Limitless, OPTCG API and the pokemontcg.io images** all display the scans with a copyright or non-affiliation notice. This is common industry practice (TCGplayer, Cardmarket, eBay catalogues and so on). It is widely tolerated, but that is not the same as licensed.

### 4.4 Practical options (for Jamie + lawyer to decide)

1. **User-uploaded listing photos as the primary image on listings (recommended default).**
   - The seller photographs *their own physical card*. This also proves condition, which buyers need anyway.
   - The photo still depicts copyrighted artwork. Whether a photo of a lawfully-owned card offered for resale is OK under Australian law is an **open legal question** (consider s 40–42 fair dealing purposes, which do *not* obviously include "selling"). Flag for legal review.
   - Seller terms should warrant that they own the photo and the card.
2. **Catalogue reference image (the stock scan on catalogue pages).** Choices:
   - (a) License images from a data vendor that permits display. Scrydex permits this contractually, but it can't grant TPC/Bandai rights.
   - (b) Show catalogue pages **without** stock images, or with a placeholder plus user photos.
   - (c) Seek permission from TPC (Pokémon Australia / TPCi) and Bandai. This is unlikely to be granted quickly (UNVERIFIED).
   - Most marketplaces show scans. Our risk appetite is a business/legal call.
3. **Hot-linking vs self-hosting:**
   - Hot-linking official sites is explicitly disfavoured (pokemon-card.com asks for text links only) and breaks when their URLs change.
   - Hot-linking vendor CDNs (Scrydex, TCGdex, pokemontcg.io) depends on their ToS and uptime. Scrydex says to use returned URLs and recommends self-hosting.
   - Self-hosting means *we* are the party reproducing and communicating the work under the Copyright Act 1968 (Cth). Hot-linking may not avoid liability either (authorisation/communication questions). **Legal review.**
4. **Australian fair dealing.** Relevant purposes under the Copyright Act 1968 (Cth) are research/study (s 40), criticism/review (s 41), parody/satire (s 41A) and news reporting (s 42). There is **no general US-style "fair use"**, and commercial sale listings may not fit any purpose. Price-guide or review content *might* engage s 41, but I draw no conclusion. **Legal review required.**
5. **Trademarks.** Using "Pokémon" or "One Piece" descriptively to identify genuine goods for resale is common. We should avoid logos, avoid implying affiliation, and add a non-affiliation footer like Limitless does. **Legal review.**
6. **Takedown readiness.** Whatever we choose, build image sourcing so it can be switched off per game/language (a feature flag) and add a DMCA-style / Australian notice-and-takedown process.

---

## 5. Identifier scheme proposal

### 5.1 Principles
- The internal primary key is an **opaque UUID** (`card_id`). This follows JustTCG's hard-won lesson that slugs from mutable text aren't stable.
- A **natural key** is unique and immutable once published: `(game, lang, set_code, number, variant)`.
- A **slug** is derived, human-readable, used in URLs, can be regenerated, and old slugs 301-redirect.
- **External IDs are stored in a side table**, never used as our key: Scrydex id, TCGdex id, pokemontcg.io id, pokemon-card.com `cardID`, Bandai `_pN` id, Cardmarket/TCGplayer product ids.

### 5.2 Natural key fields

| Field | Values | Notes |
|---|---|---|
| `game` | `pkm`, `opc` | |
| `lang` | `en`, `ja` | Printed language. Later: `zh-tw`, `ko`, `fr`… |
| `set_code` | **Printed/official code, upper-cased, as the publisher uses it.** Pokémon EN: official abbreviation (`MEW`, `PAL`, `SVI`…). Pokémon JP: `SV2A`, `M2A`, `SV11W`. OPC: `OP05`, `ST01`, `EB04`, `PRB01`, `P` (promo). | Keep a separate `set_aliases` table (`sv3pt5`, `sv03.5`, `sv2a_ja`, Bandai series 569105/550105). EN Pokémon abbreviations for older sets and some promos are inconsistent, so they need a curated list (UNVERIFIED completeness). |
| `number` | The printed collector number **as a string, without the denominator**: `199`, `201`, `TG05`, `SWSH050`, `119`, `001` | Keep `printed_number` (`199/165`) and `set_official_count` separately. For OPC, `number` = the part after the dash (`119`). The full printed code `OP05-119` is kept as `printed_code`. |
| `variant` | Our semantic enum. Pokémon: `normal`, `holo`, `reverse`, `reverse_pokeball`, `reverse_masterball`, `first_ed`, `shadowless`, `stamped_<x>`, `staff`… OPC: `base`, `alt_art`, `manga`, `sp`, `sp_gold`, `wanted`, `treasure`, `reprint`, `promo_<event>`… | **Never** use Bandai `_pN` as the variant (it differs EN vs JP: `ST01-012_p2` EN vs `_p4` JP). Store `_pN` as `source_variant_id` per language. For Pokémon, rarity (SIR/SAR) is an attribute, not a variant, because the number already differs. |

**Uniqueness:** `UNIQUE(game, lang, set_code, number, variant)`.

**Slug:** `{game}-{lang}-{set_code}-{number}[-{variant}]-{name-kebab}`, lower-case, with `variant` omitted when it is `normal`/`base`. Examples:
- `pkm-en-mew-199-charizard-ex`
- `pkm-ja-sv2a-201-charizard-ex` (the name is romanised or English-translated in the slug; the display name stays JP)
- `opc-en-op05-119-manga-monkey-d-luffy`
- `opc-ja-op05-119-manga-monkey-d-luffy`

### 5.3 Other catalogue fields (minimum)

- Card data: `name` (printed language), `name_en` (translation for JP), `supertype`/`category`, `rarity_code` (as printed: `SAR`, `SEC`, `SR`, `RR`), `rarity_normalized`, `illustrator`.
- Set and release: `release_date` (from the set; can be overridden per card for promos), `set_name`, `set_official_count`, `source_product` (important for OPC reprints: OP05-119 appears in OP05, PRB-01 and others).
- Media: `image_ref` (our own storage key, nullable) and `image_source` + `image_licence_note`.
- Linking: `counterpart_card_id` (nullable, JP↔EN) and `counterpart_confidence` (`auto`/`confirmed`).
- `external_ids` (see 5.1).

### 5.4 Counterpart linking rules

- **OPC:** auto-propose when `game`, `set_code`, `number` and `variant` (semantic) are equal and the other `lang`. A human confirms when the variant was inferred.
- **PKM:** propose by `(name_en, illustrator, rarity_normalized, set family)`. Always human-confirm. Allow null.
- Treat it as a 1:1 link table (`card_counterparts(card_a, card_b, confidence, source)`) rather than a single column, so one JP print can map to several EN prints (e.g. EN reprints) if needed.

---

## 6. Recommendation

1. **Pokémon EN + JP metadata:**
   - Bootstrap from **TCGdex** (free, MIT, official JP set codes, 184 JP sets).
   - Cross-check new sets against **Limitless** and the official sites manually.
   - Budget **Scrydex Starter (US$29/mo)** if we want one maintained EN+JP feed with contractual image-display permission and pricing. Evaluate at the pricing workstream.
   - Do **not** depend on pokemontcg.io. It is intermittently 500/502 today and scheduled to shut down 2027-03-01.
2. **One Piece EN + JP metadata:**
   - Ingest from the **official Bandai card lists**: one HTML page per series, low request volume, authoritative, and the only JP source found.
   - The data (text) is also "not to be reproduced without permission". We'd store *facts* (number, name, rarity, colour, cost) rather than copying card text or images wholesale. The rights position on factual data compilation needs **legal review**.
   - Alternative: Scrydex for EN only, plus our own curation for JP.
   - Use OPTCG API only as a cross-check.
3. **Images:**
   - Launch with **seller-uploaded photos** on listings.
   - Catalogue pages get either (a) Scrydex-provided images under its contract, self-hosted as it recommends, or (b) placeholders, pending legal advice.
   - **Never hot-link** pokemon-card.com, pokemon.com or onepiece-cardgame.com images.
   - Add a non-affiliation and copyright footer for both IPs.
4. Build the **identifier scheme in §5** now. External IDs go in a side table, so sources can be swapped without re-keying listings.

---

## 7. Open questions for Jamie

1. **Budget:** OK to pay for Scrydex (US$29–99/mo) for Pokémon EN+JP data and images? Or start free (TCGdex + manual curation)?
2. **Image risk appetite:** at launch, should catalogue pages show stock card scans (industry norm, but not licensed by TPC/Bandai), or user photos and placeholders only? Can we get an Australian IP lawyer's opinion before launch?
3. Should we **approach TPC (Pokémon Australia) and Bandai** for a permission or letter of comfort? Or not raise our profile?
4. **One Piece JP:** is scraping the official Bandai JP card list (low volume, facts only) acceptable to you, pending legal review? It is the only complete JP source found.
5. **Variant granularity:** for Pokémon, do reverse-holo pattern variants (Poké Ball / Master Ball reverse) and stamped promos need separate catalogue cards (i.e. separate listings)? For OPC, separate cards for SP vs SP gold vs Wanted Poster? (Recommendation: yes, because prices differ by orders of magnitude.)
6. **Other languages:** do we want Chinese (Simplified/Traditional), Korean or Thai prints later? Significant for Pokémon in the AU market (UNVERIFIED demand). The schema supports it.
7. **Sealed products** (booster boxes, ETBs): are they in catalogue scope? Scrydex and apitcg have sealed endpoints. TCGdex does not (UNVERIFIED).
8. Who does the **human curation** of JP↔EN Pokémon counterpart links (volunteer mods, you, or paid)?

---

## Appendix: URLs checked (2026-09-27)

- https://pokemontcg.io/ · https://docs.pokemontcg.io/ · https://dev.pokemontcg.io/ · https://api.pokemontcg.io/v2/sets (502) · https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/README.md
- https://scrydex.com/ · /pricing · /terms · /docs · /docs/getting-started/{best-practices,rate-limits,api-credits} · /docs/pokemon/cards · /docs/onepiece/cards · /pokemon/jp/expansions · /pokemon/expansions/151/sv2a_ja
- https://api.tcgdex.net/v2/ja/sets · /v2/ja/sets/SV2a · /v2/ja/cards/SV2a-201 · /v2/en/cards/sv03.5-199 · https://tcgdex.dev/faq · https://tcgdex.dev/assets · https://github.com/tcgdex/cards-database (README, LICENSE)
- https://www.pokemon-card.com/card-search/ · /policy.html · https://www.pokemon.co.jp/rules/
- https://www.pokemon.com/us/pokemon-tcg/pokemon-cards (403 Incapsula)
- https://limitlesstcg.com/cards · /cards/jp · /legal · https://onepiece.limitlesstcg.com/cards · https://docs.limitlesstcg.com/developer
- https://en.onepiece-cardgame.com/cardlist/?series=569105 · https://www.onepiece-cardgame.com/cardlist/?series=550105 · https://en.onepiece-cardgame.com/products/op18.html · https://www.onepiece-cardgame.com/products/ · https://www.bandai.co.jp/site/notice/ · https://www.bandai.co.jp/site/about_tm/
- https://optcgapi.com/ · /documentation · /about/updates/ · /api/sets/card/OP05-119/
- https://docs.apitcg.com/openapi.json
- https://justtcg.com/pricing · /terms · /docs/identifiers · /supported-games
- https://www.pricecharting.com/api-documentation
- https://bulbapedia.bulbagarden.net/w/api.php?action=query&meta=siteinfo&siprop=rightsinfo
