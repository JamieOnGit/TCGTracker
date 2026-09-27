# BRAND — low-fidelity wireframes

Clickable, greyscale, static HTML/Tailwind wireframes for the Pokémon TCG & One Piece Card Game
collector site (en-AU, AUD). The brand name is a placeholder: every page uses the literal "BRAND"
and a plain box logo.

Each page contains:

- a dashed, monospace **SEO annotation** panel at the top (production URL path, H1, `<title>`
  pattern, meta description pattern, JSON-LD types, index/noindex, canonical rule, key internal links).
  It is a `<details>` element, so you can collapse it.
- inline **✎ NOTE** callouts that explain behaviour, such as the two Buy-button states, quota rules
  and the cert-mismatch flow.

The files use simple names (`card.html`, `listing.html`, …). The real production paths are
listed in each page's SEO panel and in `index.html`.

## View

Open `index.html` directly in a browser. It works over `file://` with no build step and no network,
because the compiled CSS is committed. You can also serve the folder:

```sh
npx serve .
```

Resize the window to about 390px wide to see the mobile layouts. On mobile you get a bottom tab bar
and a hamburger menu, filter bottom sheets, stacked lists, and tables that scroll sideways with a
sticky first column.

## Rebuild CSS

Tailwind CSS v3 runs through its CLI. The palette in `tailwind.config.js` is limited to greyscale.

```sh
npm install
npx tailwindcss -i src.css -o assets/wireframe.css --minify   # or: npm run build:css
```

Run it again after you add Tailwind classes to any HTML file. Commit `assets/wireframe.css` so the
wireframes keep working offline.

## Screenshots

```sh
node scripts/screenshot.mjs              # all pages
node scripts/screenshot.mjs card.html    # one page
```

The script uses the `playwright` package with the preinstalled Chromium at
`/opt/pw-browsers/chromium`. Do not run `playwright install`. To point at another Chromium, set
`CHROMIUM_PATH`. For every page it saves full-page PNGs to `screenshots/{page}-mobile.png`
(390px, deviceScaleFactor 2) and `screenshots/{page}-desktop.png` (1440px). It also reports any page
that is wider than the viewport, which means unintended horizontal scroll. Scroll areas inside
`.scroll-x` containers are intentional. `screenshots/` is git-ignored because it is regenerated.

## Files

- `index.html`: wireframe index listing every page, its production path and whether it is indexed
- `assets/wireframe.css`: compiled Tailwind output (committed)
- `assets/ph.svg`: grey placeholder with an X, used for every image
- `assets/wf.js`: closes the open dropdown `<details>` menus on an outside click or Esc
- `src.css`: Tailwind entry point plus the wireframe components (`.btn`, `.chip`, `.annot`, `.seo`, …)

The shared header and footer markup is copied into each HTML file. If you change it, change it in
every file.
