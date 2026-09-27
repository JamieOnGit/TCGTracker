// Full-page screenshots of every wireframe page at mobile (390px @2x) and desktop (1440px).
// Usage (from wireframes/):  node scripts/screenshot.mjs [page.html ...]
// Uses the preinstalled Chromium at /opt/pw-browsers/chromium (do NOT run `playwright install`).
// Override with CHROMIUM_PATH=/path/to/chrome if needed.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);
const pages = (only.length ? only : fs.readdirSync(root).filter((f) => f.endsWith('.html'))).sort();

const viewports = [
  { suffix: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { suffix: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const problems = [];
try {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor,
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
    });
    const page = await context.newPage();
    for (const file of pages) {
      const name = file.replace(/\.html$/, '');
      await page.goto(pathToFileURL(path.join(root, file)).href, { waitUntil: 'load' });
      // Detect unintended horizontal page scroll (intentional scroll areas live inside .scroll-x containers).
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${file} @${vp.width}px: page is ${overflow}px wider than viewport`);
      // Full-page captures would paint the fixed mobile tab bar mid-page; pin it to the end of the page instead (same for the sticky message composer).
      await page.addStyleTag({ content: 'body{position:relative} nav[aria-label="Mobile tab bar"]{position:absolute!important;bottom:0} form.sticky{position:static!important}' });
      const out = path.join(outDir, `${name}-${vp.suffix}.png`);
      await page.screenshot({ path: out, fullPage: true });
      console.log('saved', path.relative(root, out));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
if (problems.length) {
  console.warn('\nHorizontal overflow detected:\n' + problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log('\nNo horizontal page overflow at any width.');
}
