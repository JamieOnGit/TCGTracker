import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

export const live = process.env.E2E_SUPABASE === '1'
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

function env(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of readFileSync(fileURLToPath(new URL('../../.env.local', import.meta.url)), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m) out[m[1]!] = m[2]!.replace(/^"|"$/g, '')
    }
  } catch {
    // fall back to process.env
  }
  return { ...out, ...(process.env as Record<string, string>) }
}

const E = env()
export const SUPABASE_URL = E.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = E.SUPABASE_SERVICE_ROLE_KEY ?? ''

export function uniq(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Service-role REST call (bypasses RLS; auth.uid() is null, so DB triggers treat it as "system"). */
export async function rest<T = unknown>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${pathAndQuery} -> ${res.status} ${text}`)
  return (text ? JSON.parse(text) : null) as T
}

/** Auth user id for an email (service-role Admin API). */
export async function authUserId(email: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
  const body = (await res.json()) as { users?: { id: string; email?: string }[] }
  const u = body.users?.find((x) => x.email === email)
  if (!u) throw new Error(`No auth user for ${email}`)
  return u.id
}

async function waitForMagicLink(email: string, after: number): Promise<string> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`)
    if (res.ok) {
      const data = (await res.json()) as { messages: { ID: string; Created: string }[] }
      const msg = data.messages.find((m) => new Date(m.Created).getTime() >= after - 2000)
      if (msg) {
        const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { HTML: string; Text: string }
        const m = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(`${full.Text}\n${full.HTML}`)
        if (m) return m[0].replace(/&amp;/g, '&')
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No magic link email for ${email}`)
}

/**
 * Real passwordless sign-in: request a magic link through /login/, fetch the
 * email from Mailpit and follow the link. The local Auth server only allows
 * redirects to its site_url, so we read the one-time `code` from its redirect
 * and hand it to our /auth/callback/ in the same browser (PKCE verifier cookie).
 */
export async function signIn(page: Page, email: string, next = '/account/'): Promise<void> {
  const started = Date.now()
  await page.goto(`/login/?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByTestId('login-sent')).toBeVisible()
  const link = await waitForMagicLink(email, started)
  const res = await fetch(link, { redirect: 'manual' })
  const location = res.headers.get('location') ?? ''
  const base = new URL(page.url()).origin
  if (location.startsWith(base)) {
    await page.goto(location)
  } else {
    const code = new URL(location).searchParams.get('code')
    if (!code) throw new Error(`Magic link did not return a code: ${location}`)
    await page.goto(`/auth/callback/?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`)
  }
  await page.waitForURL((u) => u.pathname.startsWith(next.split('?')[0]!), { timeout: 30_000 })
}

// ------------------------------------------------------------------ PNGs

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** A small solid-colour RGB PNG with a stripe, so front/back photos differ. */
export function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) {
      const stripe = Math.floor(y / 8) % 2 === 0
      row[1 + x * 3] = stripe ? rgb[0] : 255 - rgb[0]
      row[2 + x * 3] = rgb[1]
      row[3 + x * 3] = rgb[2]
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
