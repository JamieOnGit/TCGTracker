// Manual-assist capture for the design review (docs/research/05-design-review.md).
// Run on YOUR OWN machine: it opens a visible (headed) Chromium window. You browse
// normally (and pass any "checking your browser" page yourself, as a human). When
// the page you want is showing, press Enter in the terminal and the script saves
// desktop + mobile full-page screenshots plus a JSON dump of computed styles.
// It does NOT automate around bot protection.
//
//   node docs/research/design-review/capture-manual.mjs
//
// Output: docs/research/design-review/screens/<name>-{desktop,mobile}[-dark].png
//         docs/research/design-review/screens/<name>-styles.json
import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('./screens/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('https://cardscentral.com/');

function extract() {
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const pick = (sel) => {
    const el = document.querySelector(sel);
    const s = cs(el);
    return s && { sel, color: s.color, bg: s.backgroundColor, font: s.fontFamily, size: s.fontSize,
      weight: s.fontWeight, lh: s.lineHeight, radius: s.borderRadius, border: s.border, padding: s.padding };
  };
  const rootVars = {};
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) if (r.selectorText && /(:root|html|\.dark|\[data-theme)/.test(r.selectorText))
      for (const p of r.style) if (p.startsWith('--')) rootVars[`${r.selectorText} ${p}`] = r.style.getPropertyValue(p).trim();
  }
  const tally = (prop) => {
    const m = {};
    for (const el of document.querySelectorAll('body *')) { const v = getComputedStyle(el)[prop]; if (v && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') m[v] = (m[v] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 20);
  };
  return {
    url: location.href, title: document.title,
    googleFonts: [...document.querySelectorAll('link[href*="fonts.googleapis"],link[href*="fonts.gstatic"]')].map(l => l.href),
    body: pick('body'), h1: pick('h1'), h2: pick('h2'), h3: pick('h3'), nav: pick('nav, header'),
    th: pick('th'), td: pick('td'), button: pick('button'), a: pick('a'),
    rootVars, colors: tally('color'), backgrounds: tally('backgroundColor'), radii: tally('borderRadius'),
    fontSizes: tally('fontSize'), gaps: tally('gap'), paddings: tally('padding'),
    gridCols: [...document.querySelectorAll('*')].map(e => getComputedStyle(e).gridTemplateColumns).filter(v => v && v !== 'none').slice(0, 10),
  };
}

for (;;) {
  const name = (await rl.question('\nBrowse to a page, then type a short name (home/card/market/chart) + Enter, or "q" to quit: ')).trim();
  if (!name || name === 'q') break;
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    const sfx = dark ? '-dark' : '';
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}${name}-desktop${sfx}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}${name}-mobile${sfx}.png`, fullPage: true });
    if (!dark) await writeFile(`${OUT}${name}-styles.json`, JSON.stringify(await page.evaluate(extract), null, 2));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  console.log(`saved ${name}-*`);
}
rl.close();
await browser.close();
