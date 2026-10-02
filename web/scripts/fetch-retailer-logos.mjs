#!/usr/bin/env node
/**
 * Fetch each retailer's own site icon (apple-touch-icon / favicon) and save
 * a 96×96 PNG tile to public/retailers/<slug>.png, plus the index the site
 * reads (src/content/retailer-logos.ts). Stores without a usable icon keep
 * the monogram badge.
 *
 * Usage: node scripts/fetch-retailer-logos.mjs <retailers.json>
 *   retailers.json: { "<slug>": { "name": "...", "base_url": "https://..." } }
 *
 * One polite request at a time with an honest User-Agent; only the homepage,
 * its declared icons and /apple-touch-icon.png are fetched. Re-run when a
 * store is added (missing logos fall back to the monogram, nothing breaks).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const UA = 'TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/; contact: hello@tcgtracker.com.au)'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = `${ROOT}public/retailers/`
const INDEX = `${ROOT}src/content/retailer-logos.ts`
const SIZE = 96
const MIN_SOURCE = 32 // smaller icons look blurry: keep the monogram instead
const SKIP = new Set(['local-game-store']) // a placeholder, not a store

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, accept) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'follow', signal: ctl.signal })
    if (!res.ok) return null
    return res
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const attr = (tag, name) => new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]

/** Icon candidates from the homepage, best first. */
function candidates(html, base) {
  const out = []
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]
    const rel = (attr(tag, 'rel') ?? '').toLowerCase()
    const href = attr(tag, 'href')
    if (!href || !rel.includes('icon') || rel.includes('mask')) continue
    const sizes = (attr(tag, 'sizes') ?? '').split(/\s+/).map((s) => Number(s.split('x')[0]) || 0)
    const size = Math.max(0, ...sizes)
    const svg = /\.svg(\?|$)/i.test(href) || (attr(tag, 'type') ?? '').includes('svg')
    const score = (rel.includes('apple-touch') ? 1000 : 0) + (svg ? 900 : 0) + size
    try {
      out.push({ url: larger(new URL(href.replace(/&amp;/g, '&'), base).href), score })
    } catch {
      /* bad href */
    }
  }
  out.push({ url: new URL('/apple-touch-icon.png', base).href, score: 1 })
  out.push({ url: new URL('/favicon.ico', base).href, score: 0 })
  return out.sort((a, b) => b.score - a.score).filter((c, i, all) => all.findIndex((x) => x.url === c.url) === i)
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The largest image in an .ico: an embedded PNG, or a 32-bit BMP decoded to raw RGBA. */
function imageFromIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null
  let best = null
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const o = 6 + i * 16
    if (o + 16 > buf.length) break
    const w = buf[o] || 256
    const data = buf.subarray(buf.readUInt32LE(o + 12), buf.readUInt32LE(o + 12) + buf.readUInt32LE(o + 8))
    if (!best || w > best.w) best = { w, data }
  }
  if (!best) return null
  if (best.data.subarray(0, 8).equals(PNG_SIG)) return sharp(best.data)
  // BITMAPINFOHEADER: 32 bits per pixel, bottom-up rows, height doubled (image + AND mask).
  const d = best.data
  if (d.length < 40 || d.readUInt32LE(0) !== 40 || d.readUInt16LE(14) !== 32) return null
  const w = d.readInt32LE(4)
  const h = Math.abs(d.readInt32LE(8)) / 2
  const px = d.subarray(40, 40 + w * h * 4)
  if (px.length < w * h * 4) return null
  const rgba = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4
      const t = (y * w + x) * 4
      rgba[t] = px[s + 2]
      rgba[t + 1] = px[s + 1]
      rgba[t + 2] = px[s]
      rgba[t + 3] = px[s + 3]
    }
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
}

/** Shopify's image CDN serves any size: ask for 180px instead of the 32px favicon crop. */
function larger(url) {
  if (!/\/cdn\/shop\//.test(url)) return url
  const u = new URL(url)
  if (u.searchParams.has('width') || u.searchParams.has('height')) {
    u.searchParams.set('width', '180')
    u.searchParams.set('height', '180')
  }
  u.pathname = u.pathname.replace(/_(\d+)x(\d+)(\.\w+)$/, '_180x180$3')
  return u.href
}

async function tile(buf) {
  const img = imageFromIco(buf) ?? sharp(buf, { density: 300 })
  const meta = await img.metadata()
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_SOURCE) return null
  // White tile so dark and transparent icons read on both themes.
  return img
    .resize(SIZE - 12, SIZE - 12, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .extend({ top: 6, bottom: 6, left: 6, right: 6, background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer()
}

async function logoFor(baseUrl) {
  const home = await get(baseUrl, 'text/html')
  const html = home ? await home.text() : ''
  const list = candidates(html, home?.url ?? baseUrl)
  // Stores that refuse automated requests: their icon via Google's public favicon service.
  list.push({ url: `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(baseUrl)}`, score: -1 })
  for (const c of list) {
    await sleep(400)
    const res = await get(c.url, 'image/*')
    if (!res) continue
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('html')) continue
    try {
      const png = await tile(Buffer.from(await res.arrayBuffer()))
      if (png) return { png, from: c.url }
    } catch {
      /* not an image sharp can read */
    }
  }
  return null
}

const retailers = JSON.parse(await readFile(process.argv[2] ?? 'retailers.json', 'utf8'))
await mkdir(OUT_DIR, { recursive: true })
const found = {}
for (const [slug, r] of Object.entries(retailers)) {
  if (SKIP.has(slug) || !r.base_url) continue
  const logo = await logoFor(r.base_url)
  if (logo) {
    await writeFile(`${OUT_DIR}${slug}.png`, logo.png)
    found[slug] = `/retailers/${slug}.png`
    console.log(`ok   ${slug}  <- ${logo.from}`)
  } else {
    console.log(`miss ${slug}  (${r.base_url}): monogram stays`)
  }
  await sleep(600)
}

const body = Object.entries(found)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([slug, src]) => `  '${slug}': '${src}',`)
  .join('\n')
await writeFile(
  INDEX,
  `/**
 * Retailer logos: each store's own site icon, saved as a ${SIZE}×${SIZE} tile in
 * public/retailers/. Generated by scripts/fetch-retailer-logos.mjs; re-run it
 * when stores are added. A store missing here shows its monogram.
 */
export const RETAILER_LOGOS: Record<string, string> = {
${body}
}
`,
)
console.log(`\n${Object.keys(found).length} of ${Object.keys(retailers).length} stores have a logo`)
