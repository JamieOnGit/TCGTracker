# 06 — Design direction: "Aman calm + data-dense precision"

Brief refs: aesthetic = aman.com · data patterns = pokewealth.com/rankings, tcgindex.io/pokemon, tcgcharts.com/charts · Reviewed 2026-09-28 · Target stack: Next.js (App Router) + Tailwind v4.

> This document studies how those sites work and sets out our own direction. We copy no code, logos, images, copy or trademarks. The screenshots are internal reference only and live **outside the repo** in `/tmp/claude-0/design-research/`.

---

## 0. Access log and evidence

| Site | Page(s) | Method | Result |
|---|---|---|---|
| aman.com | `/` and `/resorts/aman-tokyo` | Playwright + Chromium, 1440×900 and 390×844 @2x. Clicked "Accept all cookies" as a user would. | 200. The hero video would not play in headless mode ("Player error"). The rest of the page rendered. |
| pokewealth.com | `/rankings` | Same | 200 |
| tcgcharts.com | `/charts` | Same | 200 |
| tcgindex.io | `/pokemon` | Same, then plain `curl` | **403, Cloudflare "Sorry, you have been blocked"**, for both the browser and curl. We did not try to get around it. Observations in §1.3 come from WebFetch summaries of `/pokemon` and `/pokemon/price-guide` and from search-result descriptions, so they are **second-hand**. |

TLS note: Chromium did not trust the agent-proxy CA from NSS. We pinned the proxy CA's SPKI with `--ignore-certificate-errors-spki-list`. Verification was not disabled.

Files in `/tmp/claude-0/design-research/`:

| File | What |
|---|---|
| `aman-home-desktop.png`, `aman-home-desktop-fold.png`, `aman-home-mobile.png` | Aman homepage |
| `aman-inner-desktop.png`, `aman-inner-desktop-fold.png`, `aman-inner-mobile.png` | Aman Tokyo property page |
| `pokewealth-rankings-desktop.png`, `-desktop-fold.png`, `-mobile.png`, `-mobile-table-fold.png` | PokeWealth rankings |
| `tcgcharts-charts-desktop.png`, `-desktop-fold.png`, `-mobile.png` | TCGCharts market-cap chart |
| `tcgindex-pokemon-BLOCKED-desktop.png`, `-mobile.png`, `-desktop-fold.png`, `tcgindex-pokemon.html` | The Cloudflare block page only |
| `*-styles.json`, `*-mobile.json` | Computed styles pulled with `page.evaluate`: fonts, sizes, colours, borders, radii, table cells, sticky elements |

---

## 1. Per-site observations

### 1.1 Aman (aesthetic reference)

**Measured**
- **Fonts.** All self-hosted from `/themes/custom/aman/assets/dist/font/`. A Typekit preconnect is also present.
  - Lyon Display Web 300 (Commercial Type) for display.
  - Lyon Text Web 400 for headings and body serif.
  - Whitney SSm 300/400 (Hoefler&Co) for UI, nav, labels and captions.
  - Also Calligraph810 and Noto Serif JP/SC for CJK.
  - None of these are free.
- **Type.**
  - H1/H2: Lyon Text **31px / 400 / lh 1.45 / +0.5px**. There is no bold anywhere.
  - H3: 19.6px / +0.98px.
  - Eyebrows ("HOTELS & RESORTS", "TOKYO, JAPAN"): Whitney **10px, uppercase, +2px tracking**.
  - Body and nav: 14px, +0.7–0.8px tracking, lh 1.45.
  - Menu-drawer links: 24px sans.
  - Captions: 9.8px uppercase.
- **Colour.**
  - Background `#F3EEE7` (warm stone paper). Alternate section band `#E6E2DB`.
  - Text `#313131`. Secondary text `#585858`.
  - Hairlines `#DAD9D7` and `#E6E6E6`.
  - The primary button inverts the page: fill `#313131`, text `#F3EEE7`.
  - There is **no accent colour at all**. Photography supplies the colour.
- **Shape.**
  - Buttons are `border-radius: 0`, 1px border, padding `10px 15px`, 42px high.
  - Text links are "Discover more" with a 1px underline.
  - Nearly zero radii across the site. The only ones measured are 2.8–4px on the map widget.
  - No shadows.
- **Layout.**
  - Container is 1391px at 1440 (about 25px gutters). Images run almost edge to edge.
  - Grids are asymmetric: a 2/3 image beside a 1/3 image.
  - Every block follows the same rhythm: eyebrow, serif title, short paragraph, underlined link.
  - Vertical gaps between sections are very large (about 120–160px).
- **Nav.**
  - Header is centred on the wordmark, with "☰ Menu" and search on the left and a language select (underlined) and a dark "Reserve" button on the right.
  - On inner pages a second hairline-bordered sub-nav runs across the page. Its first item is the property name in tracked serif caps.
- **Mobile.**
  - Sticky header. The menu is a full-screen drawer.
  - A **fixed bottom booking CTA bar** (`booking-bar-cta`).
- **Footer.** Surprisingly **dense**: four columns of small 12–13px destination lists. Aman shows that calm and density can sit side by side when the type is small, hairline-separated and single-colour.

**Take**
- Stone paper background.
- Near-black ink instead of pure black.
- Weight 400 serif headings, never bold.
- Tiny tracked uppercase eyebrows.
- Square corners.
- An inverted dark primary button.
- Underlined text links instead of buttons wherever possible.
- Generous section spacing.
- A hairline sub-nav.
- A dense but quiet footer.

**Avoid**
- Autoplay hero video: it is heavy and fragile, and headless shows the failure.
- 10px captions for anything important. Our data needs ≥12px.
- Low-contrast `#585858`-on-stone for small text. It is fine at 14px but not at 10px.
- The hamburger-only desktop nav. We need direct nav to data.

### 1.2 PokeWealth — rankings (market-cap table reference)

**Measured**
- **Font.** No web font: system `ui-sans-serif` stack.
- **Type.**
  - H1: 36px / 700 / −0.9px.
  - Eyebrow "THE POKÉMON MARKET": blue uppercase, tracked.
  - Body: 14px, muted `#566881`.
- **Colour.** Light theme:
  - Background `#FAFCFF`, text `#0B1E42`, muted `#566881`, borders `#E1E7EF`.
  - Accent `#2463EB`. Up `#10B77F`. Down `#DC2828`.
  - Amber notice `#FFFBEB` / `#FDE68A`.
  - The CSS also ships a dark "gold on espresso" theme: `#0E0B06` background, `#B8860B` gold, `#F5E6C8` text.
- **Table.**
  - 50 rows per page. **Row height 81px** because of the two-line card cell plus badges.
  - `td` padding `8px 12px`. Row borders `rgba(225,231,239,.7)`. Numbers use `font-variant-numeric: lining-nums tabular-nums`.
  - Header cells are **inconsistent**: "CARD" is 12px / 600 / uppercase / +0.3px, but the numeric headers are 14px bold.
  - Columns: Rank · ☆ watch · Card (thumbnail + name + set · number + "Strict"/"Alt art" pills) · PSA 10 Value (with "as of" date when stale) · 1D · 7D · 30D · 90D · Market cap · PSA 10 pop ("counted Sep 2026") · cart button.
- **Controls.**
  - Tabs under the header: Rankings / Movers / Index / Market Intelligence / Bubble Map.
  - A full-width search, then a row of 36px toggle buttons (High confidence / Current evidence only / Hide under review) and dropdowns (All sets / All languages).
  - A provenance line: "1,000 indexed cards · PSA 10 · USD · Market observed to Sep 27, 2026 · 801 of 1,000 rows priced on older evidence".
  - A yellow provisional-data banner.
- **Chrome.** A scrolling price ticker under the header. Radii are 10px (207 instances) plus pills (83). Floating "Ask AI" pill.
- **Mobile.**
  - The `<table>` survives. Cells reflow into a two-block row: rank, thumbnail, name / set / "Cap $77.32M · Pop…", price on the right, then a 1D/7D/30D/90D mini-grid.
  - `thead` is sticky below the header.
  - **Bottom tab bar** (Home / Markets / Scan FAB / Portfolio / Watchlist).
  - Full page is 7,344px tall at 390 wide.

**What's great**
- Market cap and population sit next to price, which is the core idea.
- Honest provenance and staleness: "as of Sep 7", "counted Sep 2026", confidence toggles.
- Tabular lining numerals.
- The mobile row keeps every period visible rather than hiding them.
- A watchlist star on each row.

**What to avoid**
- Red/green as the only signal: no arrows or glyphs.
- A saturated green cart button on every row, which reads as visual noise.
- The ticker tape.
- Floating AI/FAB clutter.
- Mixed header styles.
- Truncating on mobile ("−18.…", "Legendary Coll…"), which destroys numbers.
- 81px desktop rows: they cost density for badge clutter.
- Explanatory paragraphs sitting above the table.

### 1.3 TCGIndex — /pokemon (browse/hub reference; second-hand, site blocked us)

From the fetched summaries:
- The game hub opens with a **"Today's Market Brief"**: a row of metric tiles (overall sentiment "Neutral 50%", weekly and monthly performance, **Breadth, Momentum, Volatility, Confidence** as % scores).
- Below that are signal cards: thumbnail, name, set, entry vs current price, return %, and a signal label such as "Breakout" or "Clean signal". Premium picks are locked behind "Members only" badges.
- **Sets directory table**: `Set · Tracked value · 7d`, ranked by value. Each set links to a page with "full value history, top cards and price analytics".
- Ranked top-cards list (e.g. "Umbreon (H30) · Skyridge $5,000") with a buy link.
- Link hubs: "most valuable cards", "biggest movers this week", "market index & report".
- Tools: **Set Screener** (a ranked table), **Card Screener**, and a **Set Performance Heatmap** (a grid coloured by gain/loss).
- Multi-TCG switcher: it tracks 14 TCGs, and the game appears in the URL (`/pokemon`, `/pokemon/price-guide`, `/pokemon/market-cap`).
- Content-heavy, SEO-friendly pages with sentences generated from live data ("the index moved about 6%, but only around 55% of cards are rising").

**Take**
- The game → set → card hierarchy, with game-scoped URLs.
- A set directory ranked by value.
- A breadth/momentum "brief" as quiet stat tiles.
- The set heatmap.
- One-sentence data summaries in plain English. These suit Aman-style copy well.

**Avoid**
- Signal-driven "Breakout" hype language, which clashes with our tone and edges toward financial advice.
- Too many locked teaser tiles.

### 1.4 TCGCharts — /charts (charts page reference)

**Measured**
- **Font.** Inter 300–700, self-hosted through `next/font`.
- **Type.**
  - H1: 30px / 700.
  - Card titles: 16–18px / 600.
  - Body: 16px, muted `#4B5563`.
- **Colour.** Tailwind-gray palette:
  - Background `#F9FAFB`, cards `#FFFFFF`, text `#111827`.
  - Borders `#E5E7EB` and `#D1D5DB`.
  - Accent blue `#2563EB`. Up `#16A34A`. Down `#DC2626`.
  - Info callout `#EFF6FF` with blue text.
- **Radii.** 8px on cards (24), 6px on segmented controls (13), 4px (8).
- **Layout.**
  - A 48px icon rail on the far left (watchlist, charts, discover, research, account).
  - A white **section index card** titled "CHARTS" in tracked 12px caps: Market Cap, Character Market Cap, Fear & Greed Index, PKMN200 Index, GRAIL25 Index.
  - Main area: H1 + BETA pill + one-paragraph definition. On the left, a stack of **stat tiles**: Total Market Cap **$10.94B** in large bold text with the exact figure `$10,940,694,046 · 90,593 cards tracked` underneath, a 1Y change of **+40.66%** with an icon, and a 1-year high/low with coloured value pills. On the right, the "Market Cap Over Time" chart card.
- **Chart.**
  - A segmented range control **7D 1M 3M 1Y All** (12px / 500, 6px radius, the active item on white). A separate **Log** toggle.
  - A green line with a heavy gradient area fill and faint horizontal gridlines.
  - "Updated: Today · click and drag to measure any period". Drag-to-measure is the standout interaction.
  - Then a "How market cap works" callout and a FAQ accordion.
- **Footer bar.** Theme toggle (light / dark / system) and **currency toggle $ € ¥**.
- **Mobile.**
  - The section index becomes horizontally scrolling chips.
  - Stat tiles become a horizontal carousel. The 1Y change is half off-screen, so data is hidden.
  - Bottom tab bar (Home, Watchlist, Collection, Discover, Log in).
  - X-axis labels collide ("eptemb11December23 February").

**What's great**
- The big-number + exact-figure + scope-note stat tile.
- The range segmented control with a separate Log toggle.
- Drag-to-measure.
- A left section index for many related charts.
- A methodology callout next to the chart.
- A currency toggle.
- A theme toggle.

**What to avoid**
- A saturated green gradient area.
- Bold 700 headlines.
- Founder/beta banners.
- A floating feedback button.
- Stat carousels that hide numbers on mobile.
- Axis-label clipping.
- Blue-on-blue callout text at 14px across the full width.

---

## 2. Synthesis — the TCG Trade direction

**One sentence:** the page reads like a quiet hotel brochure, and the numbers inside it read like a terminal. The difference is carried by type and alignment, not by colour or boxes.

Principles:
1. **Paper, ink, hairlines.**
   - A stone background with near-black ink.
   - Structure comes from 1px rules and whitespace, never from filled cards with shadows.
   - Surfaces are only slightly lighter than the page.
2. **Two voices.**
   - The *serif* (Newsreader) speaks: page titles, card names on detail pages, section headings, empty states. It is always weight 300–400 and never bold.
   - The *sans* (Inter, tabular) measures: every number, table, control and label.
3. **One accent, used rarely.**
   - Bronze `#7C5D34` marks only four things: the active state, focus, Premium, and links in running text.
   - Market movement uses a separate, colour-blind-safe pair (teal ▲ / burnt sienna ▼), always with a glyph and sign.
4. **Density inside, calm outside.**
   - The outer page has big margins, a slow vertical rhythm and one idea per band.
   - Inside a data block, rows are 48–56px, text is 13–14px, and alignment is strict.
   - This is Aman's footer principle applied to tables.
5. **Honest data.**
   - Adopt PokeWealth's provenance line and "as of" stamps, and TCGCharts' exact-figure subtitles.
   - Each stamp is set as small muted text, never as banners.
6. **Square.**
   - Corners are 0–2px. The one exception is **card images**, which carry the real card's corner radius (about 3.5mm on a 63mm card), so the product itself is the only rounded object on the page.

### 2.1 Global frame

- **Container.** `max-width: 1320px`. Side padding is 16px mobile, 32px tablet and 48px desktop. The grid is 12 columns with 24px gutters. Reading measure is 680px.
- **Vertical rhythm.** Section gaps are 96px (`py-24`) on desktop and 64px (`py-16`) on mobile. Gaps inside a section are 24–32px.

**Header (desktop, 64px, sticky)**
- Layout: wordmark left, primary nav centred, utilities right. It sits on `--bg` with a 1px `--line` bottom rule and turns to `--surface` after 8px of scroll. There is no shadow.
- Wordmark: "TCG TRADE" in Newsreader 400, 15px, `letter-spacing: .28em`, uppercase. This is our own typographic mark, not a logo image.
- Nav: Market · Charts · Sets · Marketplace · Drops. Inter 14/450 with +0.01em tracking, in `--ink-muted`. The active item is `--ink` with a 1px bronze underline, 6px below the baseline.
- Utilities:
  - Search field (240px, ⌘K hint).
  - A `AUD | USD` mini segmented control.
  - "Sign in" as a text link.
  - "Get alerts" as the primary button (ink fill, square).

**Sub-nav**
- Section pages get a second 44px row under a hairline, like Aman's property sub-nav.
- The first item is the section name in tracked serif caps (e.g. `MARKET ›`), followed by tabs such as Rankings · Movers · Index · Population.
- It scrolls horizontally on mobile with a fade at the edge.

**Header (mobile, 56px)**
- Wordmark left, with search and menu icons (24px, 1.25px stroke) on the right.
- The menu is a full-screen drawer on `--bg`, with 24px sans links (after Aman) and a 64px **bottom tab bar**: Market · Charts · Search · Marketplace · Drops.
- Tab bar icons are 1.25px-stroke line icons with 11px labels. The active tab is ink with a 2px bronze top rule.
- There is no floating action button.

**Footer**
- `--bg-sunken` band with 64px top padding.
- Four columns of 13px lists (Market / Games / Marketplace / Company) under 11px tracked eyebrows.
- Then a rule, then the legal row:
  - © TCG Trade.
  - ABN placeholder.
  - "Market data is indicative, not financial advice."
  - Data-source credits.
  - The theme toggle (Light / Dark / System segmented) and AUD/USD.

### 2.2 Homepage — market-cap rankings

The page runs top to bottom in this order:

1. **Intro band (about 240px, calm)**
   - Eyebrow: `AUSTRALIAN GRADED CARD MARKET · AUD`.
   - H1 (serif 44/300): "The graded card market, measured."
   - One muted sentence below it, generated from the data in the tcgindex style: "Up 1.8% this week; 61% of tracked cards are rising."
2. **Stat strip**
   - Four stat tiles in one row, separated by **vertical hairlines rather than boxes**:
     - Total market cap.
     - 7d change.
     - Cards indexed.
     - PSA 10 population.
   - Each tile shows the big number and the exact figure or scope underneath, in the TCGCharts pattern.
   - Mobile: a 2×2 grid, **not** a carousel.
3. **Control bar**, on one line and wrapping on tablet:
   - Game segmented control: `All · Pokémon · One Piece`.
   - Grade segmented control: `PSA 10 · PSA 9 · Raw`.
   - Language: `EN · JP · All`.
   - Period for the % column: `24h · 7d · 30d · 90d`.
   - Search field on the right.
   - Filters (set, era, price band, "current evidence only") go in a "Filters" ghost button that opens a right sheet.
4. **Provenance line** (12px muted), e.g. "1,000 cards · PSA 10 · AUD · prices to 27 Sep 2026 · population counted Sep 2026 · Methodology".
5. **Rankings table.** See the component spec in §4.7. Columns:
   - `#`
   - Card: 28px-wide 63:88 thumbnail, name at 14/500, then set · number · EN/JP badge on a second 12px line.
   - Value.
   - 24h.
   - 7d.
   - 30d.
   - 7d sparkline (64×20).
   - Market cap.
   - Pop.
   - A hover-only watch ☆ and a "⋯" action.
   - Rows are **52px**. 50 rows per page, then a "Show next 50" text button plus page numbers.
   - There is no per-row buy button. Where listings exist, a small "3 listed" link replaces it.
6. **Two-up band below the table**
   - Left: "Movers this week", two short lists with 5 up and 5 down.
   - Right: "Latest retail drops", 4 rows with a link to the full feed.
7. **Set leaders**: a 6-row table of the most valuable sets (tcgindex directory) with a link to Sets.
8. A **Premium** quiet band: serif line, 3 bullet benefits and a secondary button. No gradients.

### 2.3 Card detail page

- **Breadcrumb** (12px): Pokémon › Sword & Shield › Evolving Skies › Umbreon VMAX #215.
- **Hero, two columns (5/7).**
  - Left column: the card image at 63:88 on a `--bg-sunken` panel with 48px padding. It is sticky on desktop. Front/back thumbnails sit underneath.
  - Right column, top to bottom:
    - Eyebrow: `EVOLVING SKIES · 215/203 · ALT ART`, with EN/JP badge.
    - H1 serif 40/400: the card name.
    - The **price block**:
      - The selected grade's value in Inter 44/300 tabular.
      - The change chip next to it (▲ 4.2% 30d).
      - Beneath, 12px muted: "Median of 14 sales, last 30 days · as of 27 Sep".
    - The **grade selector** segmented control: `Raw · PSA 7 · PSA 8 · PSA 9 · PSA 10`. It drives the price, the chart and the listings together.
    - A row of 3 stat tiles: Market cap (this card) · PSA 10 pop · Gem rate.
- **Chart band (full width)**
  - Range segmented control `1M 3M 6M 1Y 5Y All`, with a separate Log toggle and a "Compare grades" toggle that overlays PSA 9 and PSA 10.
  - Drag-to-measure, as on TCGCharts.
  - A chart spec is given in §4.11.
- **Grade table**
  - Columns: `Grade · Value · 30d · Population · % of pop · Implied cap · Last sale`.
  - The selected grade row gets `--bg-sunken` and a 2px bronze left rule.
- **Recent sales**
  - Columns: date, grade, price, source, and a "view" link.
  - 10 rows, then "Show all".
- **On the marketplace**: a horizontal row of 4 listing tiles (a 2-column grid on mobile).
- **Related**: other printings (EN/JP) and other cards from the set.
- **Methodology** footnote.

### 2.4 Game and set hubs (tcgindex-style browse)

**`/pokemon` and `/one-piece`**
- Intro band: game name in serif, with a one-sentence data summary.
- Stat strip: **Market cap · 7d · Breadth (% rising) · Volatility (30d)**. These are the tcgindex "brief" metrics, shown calmly as numbers without gauges.
- **Era tabs** (hairline sub-nav): All · Scarlet & Violet · Sword & Shield · Sun & Moon · XY · … For One Piece: by block or booster number.
- **Sets directory**
  - The default is a table: `Set (symbol placeholder + name) · Released · Cards · Tracked value · 7d · 30d · Top card (28px thumb + name)`.
  - A view toggle `Table | Grid` switches to set tiles: 3:2 panel with the set name in serif, release year, value and 7d chip.
- **Screener link** as a quiet text link: "Open card screener →".

**Set page**
- Header: set name in serif 40, with release date, card count and language.
- Stat strip.
- Set value chart.
- **Heatmap**: a grid of the set's cards as small 63:88 cells. Each cell is filled with a tonal step of the diverging up/down scale (§3.1). Hovering shows the card and its %. A table view toggle sits beside it.
- Top cards table, reusing the rankings component scoped to the set.

### 2.5 Charts page (tcgcharts-like)

- **Desktop layout**: a 240px left **section index** (no card, only hairline-separated groups) and the main column.
  - Market: Market cap · Pokémon vs One Piece · EN vs JP.
  - Indices: TCG Trade 100 · Grail 25. These are our own index names; confirm them before launch.
  - Grades: Grade mix · Population growth.
  - Sentiment: Breadth · Volatility.
- **Main column**:
  1. H1 serif + a one-sentence definition.
  2. A 3-tile stat strip: Now, with the exact figure · Change over the selected range · Range high/low, with dates.
  3. A **chart card 480px tall** with the range control, Log toggle, "Compare" menu and drag-to-measure.
  4. A "How this is calculated" note as a plain bordered-left paragraph (2px `--line-strong` left rule), not a blue box.
  5. FAQ accordion with hairline rows and a +/− glyph.
- **Mobile**:
  - The section index becomes a horizontally scrolling tab row under the header.
  - Stat tiles stack 1-up with the numbers fully visible.
  - The chart is 300px tall with 4 x-axis labels at most, formatted `MMM ’YY`.

### 2.6 Marketplace listing grid

- Heading: serif "Marketplace", with a count line such as "1,284 graded cards for sale in Australia".
- **Filters**
  - Desktop: a 264px left rail with accordion groups: Game, Set, Grade (checkbox chips), Language, Price (range), Seller state (NSW/VIC/QLD/…), Shipping/pickup.
  - Mobile: a "Filters (3)" button opens a bottom sheet.
  - Sort select on the right: "Best value vs market", Newest, Price ↑↓.
- **Grid**
  - 4 columns at ≥1280px, 3 at ≥1024px, 2 on mobile.
  - Column gap 24px. Row gap 40px, so the grid breathes like Aman's editorial grid.
- The tile itself is specified in §4.12.

### 2.7 Listing page

- Two columns (6/6).
- **Left**: a gallery on `--bg-sunken` with front and back, then a **slab close-up with the cert label**. Thumbnails sit below.
- **Right**, top to bottom:
  - Eyebrow: set · number.
  - H1 serif: the card name.
  - Badges: PSA 10 · EN.
  - **Asking price** in Inter 36/300.
  - A "vs market" row: "Market value $4,205 · this listing 6% below". Beneath it, a thin 1D bar shows where the ask sits in the 30-day sales range.
  - Primary "Contact seller" / "Buy", then a secondary "Watch".
  - A **Cert** block: PSA cert number, a "Verified against PSA" tick with a timestamp, and the population at that grade.
  - A seller block: name, state, member since, rating, and a response-time stat.
  - Shipping, returns and payment notes as a definition list with a hairline between rows.
- Below the columns: a condensed card price chart, and "Other listings of this card", sorted by price.

### 2.8 Drops feed

- Heading: serif "Retail drops", with the note "Australian retailers, times in AEST/AEDT".
- **Filters**: segmented `All · Pokémon · One Piece`, a retailer multi-select, `Status: Upcoming · Live · Sold out`, and "My alerts only".
- **Feed**
  - Grouped by day under serif date headings (20/400, e.g. "Tuesday 30 September") with a hairline above each.
  - Each **drop row** is 64px:
    - Time (tabular, 13px).
    - A 40px product image (sealed product, 1:1).
    - Product name and retailer on the next line.
    - Game badge.
    - RRP.
    - A status dot with text: `● Live` in up-teal, `○ Upcoming` in muted, `— Sold out` in subtle with a line-through on the RRP.
    - A ghost "Alert me" (bell) button.
- **Premium**: "Early alerts (5 min head start)" is shown inline as a Premium badge on alert buttons for free users. Content is never blurred.
- **Empty state**: "No drops announced for these filters." followed by "Set an alert and we'll tell you first."

### 2.9 Pricing page

- Intro: serif H1 "Plans" and one sentence.
- **Three plans in columns separated by vertical hairlines** (no boxed cards): Free · Collector · Premium.
  - Plan name in serif 26.
  - Price in Inter 40/300, "/month AUD" at 13 muted, with an annual toggle.
  - A 5–7 line feature list with 16px check glyphs in ink, not green.
  - One button per plan. Only the recommended plan gets the primary (ink) button and a small bronze "Recommended" badge above its name.
- **Comparison table** below, with features grouped under eyebrow rows.
- FAQ accordion.
- A GST note: "Prices include GST".

### 2.10 Mobile table treatment (the key decision)

PokeWealth's reflowed rows lose information to truncation, and TCGCharts' carousel hides numbers. We use **two modes**, remembered in `localStorage`:

**Compact (default)**
- A real `<table>` with **three visible columns**: `Card` (sticky first column, including rank) · `Value` · `Δ`.
  - The card cell shows a 24px thumbnail, a name that wraps to two lines (never ellipsis), and set · grade in 12px.
  - The period is chosen once by the segmented control above the table (24h/7d/30d/90d), so the Δ column never truncates.
  - Tapping a row opens the card page.
- A **metric switcher** above the table (`Value · Cap · Pop`) swaps what the second column shows.
- Rows are 60px.

**Full**
- The full desktop column set, scrolling horizontally.
- The first column (`#` + name, 164px) is `position: sticky; left: 0`, with `--bg` behind it and a 1px right rule. Once scrolled, a 12px fade shadow appears on its right edge.
- The header is `position: sticky; top: 56px` (below the header).
- Swiping horizontally never hides the card name.

In both modes, numbers stay whole: they are abbreviated with a rule ($1.2M, $96.5K), never cut.

---

## 3. Design tokens

### 3.1 Fonts — choice and justification

Aman pairs **Lyon** (a crisp, contemporary serif with moderate contrast and a light display cut) with **Whitney** (a humanist sans with open apertures and wide tracking). Neither is free. Our closest free Google Fonts are these:

| Role | Font | Why |
|---|---|---|
| Display / headings / editorial | **Newsreader** (variable: `opsz` 6–72, `wght` 200–800, italics) | It is the closest free match to Lyon's contemporary, unfussy serif. Its **optical-size axis** gives a refined, higher-contrast display cut at 40px+ and a sturdier text cut at 16–20px, as Lyon Display and Lyon Text do. Cormorant and Playfair were rejected: they are too calligraphic or fashion-high-contrast, and weak below 20px. Fraunces was rejected as too quirky ("wonk"). |
| UI / data / body | **Inter** (variable, `wght` 100–900) with `tnum`, `lnum`, `cv11`, `ss01`; `zero` in tables optionally | Tabular lining figures are essential for a price table. Inter's figures are the most legible free option at 12–14px and hold up in dense rows. To bring it closer to Whitney's airy UI feel, we set **positive tracking on small sizes** (+0.01em at 13–15px, +0.14–0.18em on uppercase eyebrows) and use weights 400–500 only. Source Sans 3 was the runner-up: more humanist and closer to Whitney, but its tabular figures are looser at 13px. |

Load them in Next.js as follows:
```ts
// app/fonts.ts
import { Newsreader, Inter } from "next/font/google";
export const serif = Newsreader({ subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap" });
export const sans  = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// <html className={`${serif.variable} ${sans.variable}`}>
```
Japanese card names are covered by a fallback to `"Noto Sans JP"`, loaded only on JP routes or via `unicode-range`, so the Latin pages stay light.

### 3.2 Tokens (paste into `app/globals.css`)

```css
@import "tailwindcss";

/* Colours are tokens, so components rarely need `dark:`. When they do, set data-theme on <html>
   (resolve "system" with a tiny inline script before paint) so this variant always matches. */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root {
  color-scheme: light;

  /* ---- Colour: neutrals (warm stone) ---- */
  --bg:            #F5F1EA;  /* page paper */
  --bg-sunken:     #ECE6DC;  /* footer, image wells, selected row */
  --surface:       #FBF9F5;  /* popovers, sheets, sticky header after scroll */
  --ink:           #2A2723;  /* primary text, primary button fill */
  --ink-muted:     #655F56;  /* secondary text, table meta */
  --ink-subtle:    #857E73;  /* large or non-essential text only (3.57:1) */
  --line:          #DCD4C7;  /* hairlines, row dividers (decorative) */
  --line-strong:   #B9AF9F;  /* section rules, chart axis */
  --line-control:  #8C8273;  /* input and toggle borders (≥3:1 non-text) */
  --grid:          #E6DFD3;  /* chart gridlines */
  --on-ink:        #F5F1EA;  /* text on ink-filled buttons */

  /* ---- Colour: accent (bronze), used sparingly ---- */
  --accent:        #7C5D34;
  --accent-soft:   #EFE5D6;

  /* ---- Colour: market movement (CVD-safe teal / sienna, always with ▲▼) ---- */
  --up:            #1D6A72;
  --up-soft:       #E2ECEC;
  --down:          #A5462A;
  --down-soft:     #F4E4DC;
  --flat:          var(--ink-muted);

  /* ---- Colour: status ---- */
  --warn:          #8A5A12;
  --warn-soft:     #F6EAD3;
  --live:          var(--up);
  --focus:         var(--accent);

  /* ---- Chart series (ink first, then bronze, teal, slate) ---- */
  --series-1: var(--ink);
  --series-2: #9A7443;
  --series-3: #2E7F87;
  --series-4: #6F7C8A;

  /* ---- Elevation (theme-dependent; mapped to shadow-* utilities below) ---- */
  --elev-overlay: 0 16px 40px -16px rgb(42 39 35 / 0.22), 0 0 0 1px var(--line);
  --elev-sticky-col: 8px 0 12px -8px rgb(42 39 35 / 0.12);

  /* ---- Numerals ---- */
  --num-features: "tnum" 1, "lnum" 1, "cv11" 1;

  /* ---- Layout ---- */
  --gutter: 16px;  /* 32px ≥768, 48px ≥1280 (see media queries below) */
  --container: 1320px;
  --measure: 680px;

  /* ---- Motion ---- */
  --dur-1: 120ms;  /* hover, press */
  --dur-2: 200ms;  /* toggles, menus */
  --dur-3: 320ms;  /* sheets, drawers, page fades */
  --dur-4: 600ms;  /* live-value highlight fade */

  --header-h: 64px;
}

@media (max-width: 767px) { :root { --header-h: 56px; } }
@media (min-width: 768px)  { :root { --gutter: 32px; } }
@media (min-width: 1280px) { :root { --gutter: 48px; } }

/* Dark: warm charcoal, not blue-black */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #161412; --bg-sunken: #110F0E; --surface: #1E1B18;
    --ink: #ECE6DC; --ink-muted: #A79F93; --ink-subtle: #877F74;
    --line: #322E29; --line-strong: #4D463E; --line-control: #6F675C; --grid: #262320;
    --on-ink: #161412;
    --accent: #C9A673; --accent-soft: #2B2419;
    --up: #6BBCC0; --up-soft: #16282A; --down: #E58E6A; --down-soft: #2E1C15;
    --warn: #D9A55A; --warn-soft: #2C2214;
    --series-2: #C9A673; --series-3: #6BBCC0; --series-4: #97A3B0;
    --elev-overlay: 0 16px 40px -16px rgb(0 0 0 / 0.6), 0 0 0 1px var(--line);
    --elev-sticky-col: 8px 0 12px -8px rgb(0 0 0 / 0.5);
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #161412; --bg-sunken: #110F0E; --surface: #1E1B18;
  --ink: #ECE6DC; --ink-muted: #A79F93; --ink-subtle: #877F74;
  --line: #322E29; --line-strong: #4D463E; --line-control: #6F675C; --grid: #262320;
  --on-ink: #161412;
  --accent: #C9A673; --accent-soft: #2B2419;
  --up: #6BBCC0; --up-soft: #16282A; --down: #E58E6A; --down-soft: #2E1C15;
  --warn: #D9A55A; --warn-soft: #2C2214;
  --series-2: #C9A673; --series-3: #6BBCC0; --series-4: #97A3B0;
  --elev-overlay: 0 16px 40px -16px rgb(0 0 0 / 0.6), 0 0 0 1px var(--line);
  --elev-sticky-col: 8px 0 12px -8px rgb(0 0 0 / 0.5);
}

/* Theme-dependent tokens → Tailwind v4 utilities (bg-bg, text-ink, border-line, text-up, shadow-overlay …).
   Names differ from the :root vars on purpose, so there are no self-references. */
@theme inline {
  --color-bg: var(--bg);
  --color-bg-sunken: var(--bg-sunken);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-ink-muted: var(--ink-muted);
  --color-ink-subtle: var(--ink-subtle);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-line-control: var(--line-control);
  --color-on-ink: var(--on-ink);
  --color-accent: var(--accent);
  --color-accent-soft: var(--accent-soft);
  --color-up: var(--up);
  --color-up-soft: var(--up-soft);
  --color-down: var(--down);
  --color-down-soft: var(--down-soft);
  --color-warn: var(--warn);
  --color-warn-soft: var(--warn-soft);

  --shadow-overlay: var(--elev-overlay);
  --shadow-sticky-col: var(--elev-sticky-col);
}

/* Static (theme-independent) tokens: fonts, type scale, spacing, radii, easing.
   `@theme static` always emits these CSS variables (the base styles below read them) and creates the utilities
   (font-serif, text-sm, rounded-xs, ease-out, p-6 …). */
@theme static {
  --font-serif: var(--font-newsreader), "Iowan Old Style", Georgia, serif;
  --font-sans:  var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-jp:    "Noto Sans JP", var(--font-inter), ui-sans-serif, sans-serif;

  /* type scale (px ≈ rem at 16) */
  --text-2xs: 0.6875rem;  /* 11 — eyebrows (uppercase, tracked), axis labels */
  --text-xs:  0.75rem;    /* 12 — meta, badges, provenance */
  --text-sm:  0.8125rem;  /* 13 — table cells, captions */
  --text-base:0.9375rem;  /* 15 — body, controls */
  --text-md:  1.0625rem;  /* 17 — lead paragraph */
  --text-lg:  1.25rem;    /* 20 — serif h3, date headings */
  --text-xl:  1.625rem;   /* 26 — serif h2 */
  --text-2xl: clamp(1.875rem, 1.4rem + 1.6vw, 2.5rem);   /* 30→40 — serif h1 */
  --text-3xl: clamp(2.25rem, 1.6rem + 2.4vw, 2.75rem);   /* 36→44 — hero h1, big price */
  --text-4xl: clamp(2.5rem, 1.8rem + 3vw, 3.5rem);       /* 40→56 — stat hero numbers */

  --leading-tight: 1.15;  /* serif display */
  --leading-snug:  1.3;   /* serif h2/h3 */
  --leading-normal:1.55;  /* body */
  --leading-table: 1.35;

  --tracking-display: -0.005em;  /* serif ≥ 30px */
  --tracking-body:     0.005em;
  --tracking-ui:       0.01em;   /* 13–15px sans */
  --tracking-eyebrow:  0.16em;   /* 11px uppercase */
  --tracking-wordmark: 0.28em;
  /* weights: 300 light (big numbers, h1), 400 regular, 500 medium (UI emphasis), 600 badges only. Never 700. */

  /* spacing: Tailwind v4 multiplies --spacing, so p-1 = 4px, p-6 = 24px, p-24 = 96px */
  --spacing: 4px;

  /* radii (nearly square) */
  --radius-xs: 2px;            /* badges, chips, inputs, segmented */
  --radius-sm: 3px;            /* tooltips, mobile sheet top corners */
  --radius-card: 4.5% / 3.2%;  /* card images: the real ~3.5mm corner on 63×88 */
  /* rounded-full stays Tailwind's default: status dots and switch thumbs only */

  --ease-out: cubic-bezier(0.22, 0.61, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}

/* Base */
html { background: var(--bg); color: var(--ink); font-family: var(--font-sans); font-size: 100%; }
body { font-size: var(--text-base); line-height: var(--leading-normal); letter-spacing: var(--tracking-body);
       -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
h1, h2, h3, .serif { font-family: var(--font-serif); font-weight: 400; font-optical-sizing: auto; }
h1 { font-size: var(--text-2xl); line-height: var(--leading-tight); letter-spacing: var(--tracking-display); font-weight: 300; }
h2 { font-size: var(--text-xl); line-height: var(--leading-snug); }
h3 { font-size: var(--text-lg); line-height: var(--leading-snug); }
.eyebrow { font: 500 var(--text-2xs)/1.4 var(--font-sans); letter-spacing: var(--tracking-eyebrow); text-transform: uppercase; color: var(--ink-muted); }
.num, td, th, [data-num] { font-feature-settings: var(--num-features); font-variant-numeric: tabular-nums lining-nums; }
a { text-underline-offset: 0.2em; text-decoration-thickness: 1px; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
::selection { background: var(--accent-soft); color: var(--ink); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; } }
```

### 3.3 Contrast check (WCAG 2.2; computed with the relative-luminance formula)

**Light**

| Foreground | on `--bg` #F5F1EA | on `--surface` #FBF9F5 | on `--bg-sunken` #ECE6DC | Use |
|---|---|---|---|---|
| `--ink` #2A2723 | **13.20** AAA | 14.13 | 11.97 | all text |
| `--ink-muted` #655F56 | **5.61** AA | 6.01 | 5.09 | secondary text, meta |
| `--ink-subtle` #857E73 | 3.57 (AA-large only) | 3.82 | 3.24 | ≥18px, disabled, decorative only |
| `--accent` #7C5D34 | **5.37** AA | — | 4.87 | links, active, focus ring |
| `--up` #1D6A72 | **5.56** AA | 5.95 | 5.04 | ▲ values, live status |
| `--down` #A5462A | **5.32** AA | 5.69 | 4.82 | ▼ values |
| `--warn` #8A5A12 | 5.25 | 5.62 | 4.76 | stale / estimate notices |
| `--on-ink` on `--ink` | **13.20** | | | primary button |
| `--up` on `--up-soft` #E2ECEC | 5.20 | | | change chip |
| `--down` on `--down-soft` #F4E4DC | 4.84 | | | change chip |
| `--accent` on `--accent-soft` #EFE5D6 | 4.85 | | | Premium badge |
| `--warn` on `--warn-soft` #F6EAD3 | 4.96 | | | notice |
| `--line-control` #8C8273 (non-text) | 3.36 ✓ ≥3 | 3.59 | 3.05 | input, toggle borders |

**Dark**

| Foreground | on `--bg` #161412 | on `--surface` #1E1B18 | on `--bg-sunken` #110F0E |
|---|---|---|---|
| `--ink` #ECE6DC | **14.80** | 13.81 | 15.40 |
| `--ink-muted` #A79F93 | **7.02** | 6.55 | 7.30 |
| `--ink-subtle` #877F74 | 4.65 | 4.34 (large only on surface) | 4.84 |
| `--accent` #C9A673 | **8.04** | 7.50 | 8.36 |
| `--up` #6BBCC0 | **8.38** | 7.82 | 8.72 |
| `--down` #E58E6A | **7.36** | 6.86 | 7.65 |
| `--warn` #D9A55A | 8.29 | 7.74 | 8.63 |
| `--up` on `--up-soft` #16282A | 6.99 | | |
| `--down` on `--down-soft` #2E1C15 | 6.50 | | |
| `--accent` on `--accent-soft` #2B2419 | 6.71 | | |
| `--line-control` #6F675C (non-text) | 3.30 ✓ | 3.08 ✓ | |

Notes:
- `--line`, `--grid` and `--line-strong` fall below 3:1 **by design**. They are decorative separators, not the only boundary of an interactive control. Controls use `--line-control`.
- Up and down are not distinguishable by lightness alone (luminance ratio 1.05). Hue (teal vs sienna) separates them for deuteranopes and protanopes, and **every change value carries ▲/▼ plus a +/− sign**. Colour is never the only signal (WCAG 1.4.1).

---

## 4. Component specs

These are Tailwind v4 class sketches that use the tokens above. Heights are desktop; mobile touch targets are ≥44px.

### 4.1 Nav (header)
- `header.sticky.top-0.z-40.h-[var(--header-h)].bg-bg.border-b.border-line`. After scroll, add `bg-surface` with a 200ms background transition.
- Nav link: `text-sm/none tracking-[.01em] text-ink-muted hover:text-ink`, padding-block 22px. The active link is `text-ink` with `::after` 1px `bg-accent` at bottom 16px.
- Search:
  - 36px tall.
  - `border border-line-control rounded-xs bg-surface`, 13px placeholder in `--ink-muted`.
  - A `⌘K` hint in a 2xs box.
  - On focus, the border changes to `--ink`.
- Sub-nav: 44px, `border-b border-line`, with items `text-sm` and gap 28px. The first item is `font-serif uppercase tracking-[.14em] text-xs`.
- Mobile tab bar:
  - `fixed bottom-0 h-16 pb-[env(safe-area-inset-bottom)] bg-surface border-t border-line`.
  - 5 equal cells, each a 22px icon over an 11px label.
  - The active cell is `text-ink` with a 2px accent top rule. Inactive cells are `text-ink-muted`.

### 4.2 Buttons
All buttons: `inline-flex items-center gap-2 h-10 px-5 text-sm font-medium tracking-[.02em] rounded-none transition-colors duration-[120ms]`. Small size is `h-8 px-3 text-xs`. On mobile they grow to `h-11`.

| Variant | Rest | Hover | Pressed | Disabled |
|---|---|---|---|---|
| **Primary** | `bg-ink text-on-ink border border-ink` | `bg-[color-mix(in_oklab,var(--ink)_88%,var(--bg))]` | translateY(0.5px) | `bg-line text-ink-subtle border-line` |
| **Secondary** | `bg-transparent text-ink border border-ink` | `bg-ink text-on-ink` | — | `border-line text-ink-subtle` |
| **Ghost** | `text-ink` with a 1px underline offset 4px (Aman "Discover more") | underline turns `--accent` | — | `text-ink-subtle no-underline` |
| **Icon** | 36×36, `text-ink-muted hover:text-ink hover:bg-bg-sunken` | | | |

Labels are sentence case. Uppercase is used only on eyebrows. At most one primary button per view region.

### 4.3 Segmented control / toggles
- Container: `inline-flex h-8 border border-line-control rounded-xs p-0.5 bg-transparent`.
- Segment: `px-3 text-xs font-medium tracking-[.02em] text-ink-muted`. The selected segment is `bg-ink text-on-ink` (square), so selection is shown by fill and does not rely on colour alone.
- Keyboard: `role="radiogroup"` with arrow-key navigation.
- A separate **toggle** (e.g. Log, "Current evidence only") is a 28×16 switch: `--line-control` track, `rounded-full` thumb. When on, the track is `--ink` and the label sits to its right.
- Filter chips (multi-select): `h-7 px-2.5 border border-line-control rounded-xs text-xs`. When selected: `bg-accent-soft border-accent text-ink` with a leading ✓.

### 4.4 Badges
Base: `inline-flex items-center h-5 px-1.5 rounded-xs text-2xs font-semibold tracking-[.08em] uppercase` (11px).

| Badge | Style |
|---|---|
| **EN / JP** | `border border-line-control text-ink-muted bg-transparent`. JP may add a small "日" glyph; keep it text-only. |
| **PSA 10 / PSA 9 / BGS 9.5 / Raw** | `bg-ink text-on-ink`, with tracking .04em and mixed case "PSA 10". Grades are the one filled badge because they are the key fact. Raw uses outline. |
| **Premium** | `bg-accent-soft text-accent border border-[color-mix(in_oklab,var(--accent)_35%,transparent)]` with a ◆ glyph. |
| **Alt art / Promo / 1st Ed.** | Plain text `text-2xs text-ink-muted uppercase tracking-[.12em]` separated by a middle dot, not pills (this avoids PokeWealth's pill clutter). |
| **Estimate / Stale** | `text-warn` 12px with a ◔ glyph and "as of 7 Sep". Text only. |

### 4.5 Price-change chip
- Markup: `<span class="chg" data-dir="up" aria-label="up 4.2 percent over 30 days">▲ 4.2%</span>`.
- Inline (in tables): no background. `text-up` or `text-down`, 13px tabular, with the glyph at 0.8em raised 0.05em. Flat values are `text-ink-muted` "— 0.0%".
- Chip (hero/stat): `h-6 px-2 rounded-xs bg-up-soft text-up`, or `bg-down-soft text-down`. The period suffix follows in `text-ink-muted` ("30d").
- Format: one decimal below 100%, none at or above 100% ("▲ 312%"). Use "+"/"−" (U+2212) in the text version for screen readers and copy/paste.

### 4.6 Stat tile
- No box. Tiles sit in a `grid grid-cols-2 md:grid-cols-4` with `divide-x divide-line` on desktop, and `gap-y-6` with top rules on mobile.
- Content, top to bottom:
  - Eyebrow label (11px tracked).
  - Value: `font-sans font-light text-4xl tracking-[-.01em] tabular-nums`. Abbreviated (A$10.94B).
  - Sub-line: `text-xs text-ink-muted` with the exact figure or scope ("A$10,940,694,046 · 90,593 cards").
  - Optionally a change chip.
- Padding `py-6 px-6`. The first tile has `pl-0`.

### 4.7 Data table (rankings, sets, grades, sales)
- Wrapper: `overflow-x-auto overscroll-x-contain`. `<table class="w-full border-collapse text-sm">`.
- **Header**:
  - `thead th` is `sticky top-[var(--header-h)] z-10 bg-bg`, with `border-b border-line-strong`, `h-10 px-3`.
  - Text is `text-2xs uppercase tracking-[.12em] font-medium text-ink-muted`, **consistent for every column**.
  - Sortable headers are buttons, with a ▴/▾ glyph shown only on the active column.
- **Rows**: `h-[52px]`, `border-b border-line`, `hover:bg-bg-sunken` with a 120ms transition. Selected rows get `bg-bg-sunken` plus `shadow-[inset_2px_0_0_var(--accent)]`.
- **Cells**: `px-3 py-2 align-middle`.
  - Numeric cells use `text-right tabular-nums whitespace-nowrap`, and the header aligns right to match.
  - Text cells align left.
  - Rank is `w-10 text-ink-muted text-xs`.
  - Currency symbols go in the header ("Value (A$)") so cells show bare numbers. This is easier to scan.
- **Card cell**: the 28px-wide thumbnail (`aspect-[63/88] rounded-[var(--radius-card)]`) with an 8px gap. The name is `text-sm font-medium text-ink` and underlines on row hover. The meta line is `text-xs text-ink-muted`: set · #215/203 · EN badge.
- **Sparkline**: a 64×20 SVG. The stroke is 1.25px `--ink-muted`, and the end dot uses `--up` or `--down`. There is no fill.
- **Mobile**: as §2.10.
  - The first column is `sticky left-0 z-[5] bg-bg` (or `bg-bg-sunken` on hover or selected).
  - `shadow-sticky-col` switches on through a `data-scrolled` attribute set from the scroll listener.
- **Loading**: skeleton rows at 52px with `bg-bg-sunken` bars and no shimmer (a static pulse at 1.6s is optional).
- **Density toggle** (optional, Premium): `Comfortable 52px | Compact 40px`.

### 4.8 Card tile (catalogue/browse)
- `figure`: a `bg-bg-sunken p-4` well, with the image inside at `aspect-[63/88] w-full object-contain rounded-[var(--radius-card)]`.
- Caption: `mt-3`, name in `font-serif text-base` (Newsreader at 16px, text optical size), meta `text-xs text-ink-muted`, and a value line `text-sm tabular-nums` with an inline change chip.
- Hover: the image scales 1.02 over 320ms with ease-out and the name underlines. There is no shadow.
- Image fallback: a sunken well with the card name in serif italic, centred, `text-ink-subtle`.

### 4.9 Listing tile (marketplace)
- Card tile image well plus a top-left overlay of **grade badge** and **EN/JP** (4px inset).
- Below the image:
  - Name (serif 16) and set · # (12 muted).
  - **Price** `text-base font-medium tabular-nums`, with "A$" prefix.
  - A "vs market" line: `text-xs`. It reads `text-up` "▼ 6% below market" when the ask is below market (good for the buyer, so teal), or `text-ink-muted` "4% above market" when above. It is **not** coloured sienna, because being above market is not an alarm.
  - A footer row in `text-xs text-ink-muted`: the seller's state (e.g. "NSW") · "Pickup or post" · listed "2d".
- The whole tile is a link. The watch ☆ is an icon button top-right that appears on hover and is always visible on touch.

### 4.10 Empty states
- Centred in a block with `py-20 max-w-[var(--measure)]`:
  - A thin-line illustration placeholder: an outline of a 63:88 card, 1px `--line-strong`, 48px wide.
  - A serif line, 20/400 (e.g. "Nothing matches these filters.").
  - A 14px muted sentence.
  - A ghost button ("Clear filters") or a secondary button ("Create an alert").
- Tone: calm and brief, no exclamation marks.

### 4.11 Chart style
- **Line**: 1.5px `--series-1` (ink), `stroke-linejoin: round`. No area fill by default. An optional "Area" setting uses a 6% ink tint, never a saturated gradient.
  - Colour carries meaning only in the **change chip** and the measure overlay, not in the line.
- **Grid**: horizontal lines only, 1px `--grid`, 4–5 ticks. No vertical grid.
  - The baseline (the start value of the range) is a 1px dashed `--line-strong`, labelled on the right in 11px muted text.
- **Axes**:
  - Labels are 11px `--ink-muted`, tabular.
  - The Y axis is on the **right** (a finance convention) and abbreviated (A$1.2M).
  - The X axis shows at most 6 labels on desktop and 4 on mobile, formatted `d MMM` under 3M and `MMM ’YY` above. Labels never overlap: compute ticks from the width.
- **Crosshair**: a vertical 1px `--ink` line at 40% opacity with a 5px dot on the line.
  - The tooltip is `bg-surface shadow-overlay rounded-sm px-3 py-2`, with the date in 11px muted, the value 15/500 tabular, and the change vs range start.
- **Drag-to-measure** (from TCGCharts): the selected span gets a `--up-soft` or `--down-soft` band, and a label shows "▲ 12.4% · A$+418K · 63 days".
- **Controls**: the range segmented control sits top right. The Log toggle and Compare menu sit beside it, separated by a hairline.
- **Multi-series**: series-1…4, with a legend as inline text chips above the chart (a 2px swatch line plus the name). Distinguish series by dash pattern too when there are more than 2.
- Heights: 480px on the charts page, 360px on card detail, 300px on mobile.
- Library: any SVG renderer (Recharts, visx or lightweight-charts) styled with these tokens. Read the colours from CSS variables at runtime so dark mode works without re-theming.

### 4.12 Alert / notice
- Inline notice: `border-l-2 border-warn bg-warn-soft px-4 py-3 text-sm text-ink`, with the title `font-medium`. The same pattern works for info (use `border-line-strong` and `bg-bg-sunken`) and for success/live (use up).
  - No icons in circles; a single 16px line glyph at most.
- Provenance / stale data: a text-only line under the table, as in §2.2 step 4. Do **not** use banners for routine caveats.
- Toast: `fixed bottom-6 left-1/2` (above the mobile tab bar), `bg-ink text-on-ink rounded-sm px-4 py-3 text-sm`. It shows for 4s and slides up 8px and fades in over 200ms. Use `aria-live="polite"`.
- Drop alert confirmation: a toast reading "Alert set for One Piece OP-12 at EB Games. We'll notify you by email."

### 4.13 Misc
- **Divider rhythm**: sections are separated by space alone. Rules are drawn only at data-block boundaries (`border-line-strong`) and between rows (`border-line`).
- **Links in prose**: `text-ink underline decoration-line-strong hover:decoration-accent`.
- **Live value update**: the background flashes `--up-soft` or `--down-soft` and fades to transparent over 600ms. There is no text colour flash and no bouncing numbers.
- **Icons**: Lucide (MIT) at `stroke-width: 1.25`, 16px in UI and 20px in the tab bar.
- **Imagery**: card scans are always shown whole (`object-contain`) on sunken wells and never cropped. Product photography for drops is 1:1 on a sunken background.

---

## 5. What makes it ours (vs the references)

| | PokeWealth | TCGCharts | TCGIndex | **TCG Trade** |
|---|---|---|---|---|
| Feel | fintech blue, pills | SaaS dashboard cards | content + signals | stone paper, serif voice, square |
| Up/down | green/red only | green/red + gradient | green/red | teal ▲ / sienna ▼ + sign, AA both themes |
| Table row | 81px, badge clutter | — | simple 3-col | 52px, two-line card cell, uniform headers |
| Mobile table | reflow + truncation | carousel hides data | — | compact 3-col with metric switcher, or full table with sticky name column |
| Stat tiles | — | boxed, bold | gauges/scores | unboxed, hairline-divided, light-weight numerals + exact figure |
| Charts | — | green area gradient | heatmap | ink line, no fill, right axis, drag-to-measure, calm diverging heatmap |
| Local | USD | $ € ¥ | USD | **AUD first**, GST-inclusive pricing, AU retailer drops, seller state |

Implementation order suggestion:
1. Tokens and fonts (§3.2).
2. Table, chip and badge.
3. Stat tile and segmented control.
4. Chart.
5. Card, listing tile and drops row.
6. Pages.

---

## 6. Update 2026-09-28: "Midnight Holo" (owner feedback)

Jamie liked the clean Aman layout and type but wanted the colours to feel more gamer/TCG. The layout, spacing, type (Newsreader + Inter) and component shapes above are unchanged. The colours are now:

- **Default theme is dark "Midnight Holo":**
  - bg `#0B0D14`, surface `#121521`, sunken `#07080D`, ink `#EEF0F7`, muted `#9AA1B5`, lines `#1C2130` / `#2C3347`.
  - A faint fixed radial glow (violet top-left, cyan top-right) sits behind the page.
- **Holo foil accent:** gradient `#6D5DF6 → #3EC6FF → #FF6AD5`. It appears on only four things:
  - the 1px rule at the very top of the page,
  - the active nav underline,
  - the "TCG" in the wordmark,
  - Premium badges and "holo" buttons.
- **Solid accent** for filled controls: `#6D5DF6`, with white text at 4.7:1. Link and focus accent: `#9D8CFF` / `#3EC6FF`.
- **Price moves:** up is mint `#3DDC97` and down is coral `#FF6B7A`. They always carry ▲/▼ and a sign, as before.
- **Light theme:** the original stone palette above, with a violet accent (`#5B4BD6`), offered as a footer toggle.
