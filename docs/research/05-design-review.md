# 05 — Design review: cardscentral.com (aesthetic reference)

Brief refs: Section 14.5 / 3.3 · Reviewed 2026-09-27 · Status: **BLOCKED, partial**. Tokens below are a proposal; they are not measured from the reference site.

> Purpose: capture the *feel* of cardscentral.com so our Australian TCG market-cap/marketplace site can land in the same genre with **our own brand**. We copy no code, images, logos or trademarks. Screenshots are internal reference only (`design-review/screens/` is gitignored).

---

## 1. What happened (access log)

| # | Time (UTC) | Method | Result |
|---|---|---|---|
| 1 | earlier | `curl` (by orchestrator) | HTTP 429 |
| 2 | 2026-09-27 | Playwright + Chromium (`/opt/pw-browsers/chromium`), desktop Chrome UA, 1440×900, 6 s wait | HTTP 429, **Vercel Security Checkpoint**: "Failed to verify your browser — Code 21" |
| 3 | +30 s | Same, 20 s wait so the JS challenge could run normally | Same checkpoint, Code 21 |
| 4 | — | Anthropic WebFetch | HTTP 429 |
| 5 | — | Public Wayback snapshot (2025-07-11, the only one listed) | Archive returned 502 / connection resets; WebFetch not permitted for web.archive.org |

We stopped there: **we did not try to get around the checkpoint** (no stealth plugins, no header or fingerprint spoofing beyond a normal UA, no CAPTCHA solving). The site sits behind Vercel's bot mitigation, and it rejects headless/datacentre traffic outright.

Only screenshot captured:
- `design-review/screens/blocked-checkpoint-desktop.png` shows the checkpoint page. It gives no design information.

Not captured, because we were blocked: homepage, card detail, listing/price table and market chart pages, at desktop, mobile and in dark mode. We also have no computed-style data: colours, fonts, `:root` custom properties, grid columns, radii.

### Request for Jamie
Please supply screenshots from your own browser. There are two ways to do it:

**A. Manual (simplest).** Use full-page screenshots (Chrome DevTools → ⌘⇧P → "Capture full size screenshot"). Capture each page at desktop width (~1440) and in DevTools device mode at 390×844:
1. Homepage
2. A single card/product detail page (with the price chart visible)
3. A listing, marketplace or "top cards by market cap" table page
4. A market index or chart page, if one exists
5. Any of the above in dark mode, if the site has a toggle or follows the OS setting
6. Hover state on a card tile and a table row (a normal screenshot is fine)

Drop them into `docs/research/design-review/screens/` using the names `home-desktop.png`, `home-mobile.png`, `card-desktop.png` and so on.

**B. Assisted.** Run `node docs/research/design-review/capture-manual.mjs` on your machine. It opens a visible Chromium window. You browse normally and pass any checkpoint yourself as a human. Then press Enter for each page. The script saves desktop, mobile and dark screenshots plus a `<name>-styles.json` of computed colours, fonts, radii, spacing and `:root` variables. That JSON is what we need to fill in §2 with real values.

Once those arrive, re-run this review and replace §2 with measured values. §3 onwards is written so it stays valid either way.

---

## 2. Observed palette, typography and spacing (PENDING)

| Role | Reference hex | Notes |
|---|---|---|
| Page background | *pending* | |
| Surface / card | *pending* | |
| Text | *pending* | |
| Muted text | *pending* | |
| Border / divider | *pending* | |
| Accent / brand | *pending* | |
| Price up (green) | *pending* | |
| Price down (red) | *pending* | |

Typography, spacing scale, radii, grid columns per breakpoint, card image aspect, hover states, nav structure and iconography are all *pending* and will come from the screenshots and `*-styles.json`.

The only verifiable fact is the host: Vercel. The site is probably a Next.js/React app, which suggests a Tailwind-style utility scale is plausible, but this is not confirmed.

---

## 3. Component patterns to emulate (genre conventions for market-cap/price sites)

Until we can see the reference, these are the patterns that define the "market cap for collectibles" feel. They are common to the genre (crypto market-cap sites, card price trackers) and belong to no one brand. When screenshots arrive, check each against the reference and adjust.

**Market table (the hero component)**
- Columns: rank #, card thumbnail + name + set/number (two-line cell), price, 24h % / 7d % chips, market cap or volume, 7-day sparkline, and an action (watch ☆ / buy).
- Dense rows: 48–56 px desktop, 13–14 px body, tabular numerals, right-aligned numbers, sticky header, zebra striping *or* hairline dividers (never both), and a row hover tint.
- Mobile: collapse to rank · thumb · name/set · price + chip. Hide market cap and sparkline behind a "more" toggle or horizontal scroll inside the table card only, never the whole page.

**Card tile (grid)**
- The image keeps the trading-card aspect ratio **63:88 (≈ 5:7)**, object-fit contain on a subtle surface-2 backdrop so holo art isn't cropped.
- Below the image: name (1–2 lines, clamp), set · number · rarity (muted, 12 px), price (bold, tabular) + change chip on the same line.
- Hover (pointer only): lift of 2 px, shadow step-up, image scale 1.02. The focus-visible ring must match the hover state.
- Grid: 2 cols < 480, 3 at ≥ 640, 4 at ≥ 960, 5–6 at ≥ 1280, 12–16 px gap.

**Price-change chip**
- Pill with a tinted background, coloured text and an arrow glyph (▲ / ▼ or a chevron icon) **plus the sign** (+4.2% / −3.1%), so direction is never colour-only. Neutral/flat is grey with "0.0%".

**Badge** (rarity, grade, condition, language): small caps or 11–12 px medium, low-saturation tint, radius-sm. Grading badges (PSA 10, BGS 9.5) use an outlined style to tell them apart from rarity.

**Buttons:** primary is a solid accent. Secondary is a surface with a border. Ghost buttons are for table actions. 36 px default height, 44 px on touch for primary CTAs.

**Price chart:** line/area with a gradient fill in the accent colour, a range switcher (7D · 1M · 3M · 1Y · All) as a segmented control, a crosshair tooltip with date + AUD price, and a small "Last sold" marker set.

**Nav:** logo left, then game switcher (Pokémon · One Piece · MTG · Lorcana · Yu-Gi-Oh!), search, a prominent search box (cards are found by name/number), right side: currency (AUD fixed), theme toggle, sign in. On mobile: logo + search icon + hamburger, and a bottom-sheet game switcher.

**Iconography:** a single outline icon set at 1.5–2 px stroke (e.g. Lucide, ISC licence), 16/20 px.

---

## 4. What to do differently / improve (our angle)

1. **AUD-first, honest pricing.** Show `A$` explicitly (`A$1,249.00`) and use `Intl.NumberFormat('en-AU', {style:'currency', currency:'AUD'})`. Give a clear source/timestamp line ("Based on 14 AU sales · updated 2 h ago"). Where prices are converted from USD/JPY, label them as converted.
2. **Direction not by colour alone.** Every change pairs an arrow, a sign and colour (WCAG 1.4.1). Offer a "colour-blind friendly" preference that swaps green/red for blue/orange.
3. **Contrast.** Green-on-white and red-on-white text in price tables commonly fail 4.5:1 at 13 px. Our tokens below are all ≥ 4.5:1 for text, both themes.
4. **Tabular numerals everywhere prices appear** (`font-variant-numeric: tabular-nums`) so columns don't jitter on live updates.
5. **Dark mode as a first-class theme**, following `prefers-color-scheme` with a manual override (`data-theme`), and no pure black. Collectors browse at night.
6. **Mobile table** that doesn't force page-level horizontal scroll (see §3).
7. **Performance:** card images as responsive AVIF/WebP with explicit width/height (63:88) to avoid layout shift. Sparklines as inline SVG, not a chart library per row.
8. **Trust cues for the marketplace:** seller rating, AU postage estimate and "ships from <state>" on listing tiles.

---

## 5. PROPOSED design tokens (our brand, similar feel)

Working brand direction: **"graded-slab" clean**. The base is a cool neutral grey. The accent is a deep violet, which reads as collectible/holo and is distinct from the usual crypto blue. A warm gold marks premium/graded items, and the green/red for price movement are tuned for contrast.

**Fonts (Google Fonts, free, OFL):**
- UI/headings: **Plus Jakarta Sans** (600/700). It's friendly-geometric and reads as "modern marketplace".
- Body and data: **Inter** (400/500/600), with `tnum` for prices.
- Optional mono for set numbers and IDs: **JetBrains Mono** 500.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700&display=swap" rel="stylesheet">
```

```css
:root {
  /* Type */
  --font-display: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --fs-xs: 0.75rem;   /* 12 badges, meta */
  --fs-sm: 0.8125rem; /* 13 table cells */
  --fs-md: 0.9375rem; /* 15 body */
  --fs-lg: 1.125rem;  /* 18 card price / h4 */
  --fs-xl: 1.5rem;    /* 24 h2 */
  --fs-2xl: 2rem;     /* 32 h1 / detail price */
  --fs-3xl: 2.75rem;  /* 44 hero */
  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700;
  --lh-tight: 1.2; --lh-body: 1.55;

  /* Spacing (4px base) */
  --space-0: 0; --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px; --space-16: 64px;
  --gutter: 16px;           /* mobile side gutter */
  --container: 1280px;
  --row-h: 52px;            /* market table row */
  --row-h-compact: 44px;

  /* Radii */
  --radius-xs: 4px;   /* chips inside tables */
  --radius-sm: 6px;   /* badges, inputs */
  --radius-md: 10px;  /* buttons */
  --radius-lg: 14px;  /* cards, table container */
  --radius-xl: 20px;  /* hero panels, sheets */
  --radius-pill: 999px;

  /* Elevation */
  --shadow-1: 0 1px 2px rgb(14 23 38 / .06), 0 1px 1px rgb(14 23 38 / .04);
  --shadow-2: 0 6px 16px rgb(14 23 38 / .10), 0 2px 4px rgb(14 23 38 / .06);
  --ring: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);

  /* Motion */
  --ease: cubic-bezier(.2,.7,.2,1); --dur-fast: 120ms; --dur: 200ms;

  /* Card art */
  --card-aspect: 63 / 88;

  /* ---------- Light theme ---------- */
  --bg: #F7F8FA;
  --surface: #FFFFFF;
  --surface-2: #F1F3F6;       /* table header, image backdrop */
  --text: #0E1726;
  --text-muted: #556274;
  --border: #DDE2EA;
  --border-strong: #C5CCD8;
  --accent: #5B3FD9;          /* violet */
  --accent-hover: #4B30C4;
  --accent-contrast: #FFFFFF; /* text on accent */
  --accent-soft: #EEEBFD;
  --gold: #8A5E00;            /* graded / premium text */
  --gold-soft: #FFF6DE;
  --up: #0F7B4A;
  --up-soft: #E3F5EC;
  --down: #C0322B;
  --down-soft: #FCE8E6;
  --flat: #556274;
  --flat-soft: #EEF1F5;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0B0F17; --surface: #131A26; --surface-2: #1A2231;
    --text: #E8ECF2; --text-muted: #95A1B3;
    --border: #263042; --border-strong: #34405A;
    --accent: #9C8BFF; --accent-hover: #B2A5FF; --accent-contrast: #0B0F17; --accent-soft: #1E1A3A;
    --gold: #F2C14E; --gold-soft: #2A220E;
    --up: #34D28A; --up-soft: #0F2A1E;
    --down: #FF6B63; --down-soft: #33161A;
    --flat: #95A1B3; --flat-soft: #1A2231;
    --shadow-1: 0 1px 2px rgb(0 0 0 / .4);
    --shadow-2: 0 8px 24px rgb(0 0 0 / .5);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0B0F17; --surface: #131A26; --surface-2: #1A2231;
  --text: #E8ECF2; --text-muted: #95A1B3;
  --border: #263042; --border-strong: #34405A;
  --accent: #9C8BFF; --accent-hover: #B2A5FF; --accent-contrast: #0B0F17; --accent-soft: #1E1A3A;
  --gold: #F2C14E; --gold-soft: #2A220E;
  --up: #34D28A; --up-soft: #0F2A1E;
  --down: #FF6B63; --down-soft: #33161A;
  --flat: #95A1B3; --flat-soft: #1A2231;
  --shadow-1: 0 1px 2px rgb(0 0 0 / .4);
  --shadow-2: 0 8px 24px rgb(0 0 0 / .5);
  color-scheme: dark;
}

body { background: var(--bg); color: var(--text); font: var(--fw-regular) var(--fs-md)/var(--lh-body) var(--font-body); }
.num, .price, td.num { font-variant-numeric: tabular-nums; }

/* Example component recipes */
.chip-change { display:inline-flex; gap:2px; align-items:center; padding:2px 6px; border-radius:var(--radius-xs);
  font-size:var(--fs-xs); font-weight:var(--fw-semibold); font-variant-numeric:tabular-nums; }
.chip-change[data-dir="up"]   { color:var(--up);   background:var(--up-soft); }   /* "▲ +4.2%" */
.chip-change[data-dir="down"] { color:var(--down); background:var(--down-soft); } /* "▼ −3.1%" */
.chip-change[data-dir="flat"] { color:var(--flat); background:var(--flat-soft); } /* "0.0%" */
.card-tile { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg);
  box-shadow:var(--shadow-1); transition:transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
.card-tile img { aspect-ratio:var(--card-aspect); object-fit:contain; background:var(--surface-2); }
@media (hover:hover) { .card-tile:hover { transform:translateY(-2px); box-shadow:var(--shadow-2); } }
.card-tile:focus-visible { outline:none; box-shadow:var(--ring), var(--shadow-2); }
```

### Contrast check of proposed tokens (WCAG 2.x, computed)

| Pair | Light | Dark |
|---|---|---|
| text / bg | 16.9 | 16.2 |
| muted / surface | 6.2 | 6.7 |
| accent / surface | 6.7 | 6.3 |
| accent-contrast on accent (button) | 6.7 (white) | 6.9 (bg colour) |
| up / surface | 5.3 | 8.9 |
| down / surface | 5.6 | 6.3 |
| up on up-soft chip | 4.7 | 7.8 |
| down on down-soft chip | 4.8 | 5.9 |
| gold / bg | 5.4 | 11.4 |
| accent on accent-soft | 5.7 | 6.0 |
| border / surface | 1.3 (decorative only) | 1.3 (decorative only) |

Notes:
- In dark mode the accent is light, so **button text must use `--accent-contrast` (dark)**. White on `#9C8BFF` is only 2.8:1.
- The chip pairs sit just above 4.5:1 in light mode. Don't lighten `--up`/`--down` there, and keep chip text at ≥ 12 px semibold.
- Borders are decorative. Form inputs should use `--border-strong` (≈ 1.6:1 on surface) plus a visible focus ring to meet the 3:1 non-text contrast requirement through the ring/label.
- Accessibility issues on the reference site itself: **not assessed** (blocked). Check against the screenshots once supplied.

---

## 6. Next steps
1. Jamie supplies screenshots and ideally the `*-styles.json` from `capture-manual.mjs`.
2. Fill in §2 with the measured values. Compare them with §5 and nudge the tokens (accent hue, radius and density) so the feel matches, while the palette stays clearly distinct from the reference brand.
3. Build a one-page token playground (table, tile, chips, chart) in both themes for sign-off.
