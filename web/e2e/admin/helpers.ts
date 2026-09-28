import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { BrowserContext } from '@playwright/test'

/** Loads web/.env.local so the tests talk to the same local Supabase as the dev server. */
function loadEnv() {
  try {
    const file = readFileSync(fileURLToPath(new URL('../../.env.local', import.meta.url)), 'utf8')
    for (const line of file.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
    }
  } catch {
    // no .env.local: rely on the environment
  }
}
loadEnv()

export const live = process.env.E2E_SUPABASE === '1'
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export function service(): SupabaseClient {
  return createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
}

export const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export interface TestUser {
  id: string
  email: string
  password: string
  username: string
}

export async function createUser(label: string, role: 'user' | 'moderator' | 'admin' | 'editor' = 'user'): Promise<TestUser> {
  const svc = service()
  const username = `e2e-${label}-${runId}`.slice(0, 30)
  const email = `${username}@example.test`
  const password = `pw-${runId}-${label}-Aa1!`
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } })
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`)
  if (role !== 'user') {
    const { error: e2 } = await svc.from('profile_private').update({ role }).eq('user_id', data.user.id)
    if (e2) throw new Error(e2.message)
  }
  return { id: data.user.id, email, password, username }
}

/** Staff references without ON DELETE actions would block deleting a moderator or admin, so clear them first. */
export async function deleteUsers(users: (TestUser | undefined)[]) {
  const svc = service()
  for (const u of users) {
    if (!u) continue
    await svc.from('listings').update({ approved_by: null }).eq('approved_by', u.id)
    await svc.from('reports').update({ resolved_by: null }).eq('resolved_by', u.id)
    await svc.from('mapping_queue').update({ reviewed_by: null }).eq('reviewed_by', u.id)
    await svc.from('card_external_ids').update({ verified_by: null }).eq('verified_by', u.id)
    await svc.from('drop_events').update({ created_by: null }).eq('created_by', u.id)
    const { error } = await svc.auth.admin.deleteUser(u.id)
    if (error) console.warn(`could not delete test user ${u.username}: ${error.message}`)
  }
}

/** Signs in with @supabase/ssr in Node and copies its session cookies into the browser context. */
export async function signIn(context: BrowserContext, user: TestUser, baseURL = 'http://localhost:3402') {
  const jar = new Map<string, string>()
  const sb = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) {
          if (c.value) jar.set(c.name, c.value)
          else jar.delete(c.name)
        }
      },
    },
  })
  const { error } = await sb.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error) throw new Error(`signIn: ${error.message}`)
  const host = new URL(baseURL).hostname
  await context.clearCookies()
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: host, path: '/', httpOnly: false, secure: false, sameSite: 'Lax' as const })))
}

/** A small solid-colour PNG (63×88) so listing photos render as card-shaped images. */
export function cardPng(r: number, g: number, b: number): Buffer {
  const w = 63
  const h = 88
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const border = x < 3 || y < 3 || x >= w - 3 || y >= h - 3
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = border ? 240 : r
      raw[o + 1] = border ? 200 : g
      raw[o + 2] = border ? 60 : b
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export async function pickCard(lang: 'en' | 'jp' = 'en') {
  const { data, error } = await service().from('cards').select('id,name,number,game,lang,set_id').eq('lang', lang).limit(1).single()
  if (error || !data) throw new Error(`no ${lang} card in the catalogue: ${error?.message}`)
  return data as { id: string; name: string; number: string; game: string; lang: string; set_id: string }
}

/**
 * A graded listing submitted for review, with front/back photos in the
 * listing-images bucket. Created as the system (service role), then moved to
 * pending_review, exactly as a seller's submission would be.
 */
export async function pendingListing(seller: TestUser, opts: { title?: string; price?: number; cert?: string; mismatch?: boolean; lang?: 'en' | 'jp'; description?: string } = {}) {
  const svc = service()
  const card = await pickCard(opts.lang ?? 'en')
  const title = opts.title ?? `${card.name} PSA 10 ${runId}`
  const { data: l, error } = await svc
    .from('listings')
    .insert({
      seller_id: seller.id, listing_type: 'graded_single', card_id: card.id, lang: card.lang, grader: 'PSA', grade: 10,
      cert_number: opts.cert ?? '12345678', cert_mismatch: opts.mismatch ?? false, title, slug: 'e2e-listing',
      description: opts.description ?? 'Clean slab, posted tracked.', price_aud: opts.price ?? 450, location_state: 'VIC', status: 'draft',
    })
    .select('id')
    .single()
  if (error || !l) throw new Error(`listing: ${error?.message}`)
  const colours: [number, number, number][] = [[109, 93, 246], [62, 198, 255]]
  const kinds = ['slab-front', 'slab-back']
  for (let i = 0; i < 2; i++) {
    const path = `${seller.id}/${l.id}-${i}.png`
    const up = await svc.storage.from('listing-images').upload(path, cardPng(...colours[i]!), { contentType: 'image/png', upsert: true })
    if (up.error) throw new Error(`upload: ${up.error.message}`)
    const { error: ie } = await svc.from('listing_images').insert({ listing_id: l.id, storage_path: path, kind: kinds[i], position: i, mime_type: 'image/png', bytes: 500 })
    if (ie) throw new Error(`image row: ${ie.message}`)
  }
  const { error: se } = await svc.from('listings').update({ status: 'pending_review' }).eq('id', l.id)
  if (se) throw new Error(`submit: ${se.message}`)
  return { id: l.id as number, title, card }
}

export async function testRetailer(enabled = true) {
  const slug = `e2e-shop-${runId}`
  const { data, error } = await service()
    .from('retailers')
    .insert({ slug, name: `E2E Shop ${runId}`, base_url: 'https://example.test', adapter: 'e2e_shop', enabled, last_success_at: new Date().toISOString() })
    .select('id,slug,name')
    .single()
  if (error || !data) throw new Error(`retailer: ${error?.message}`)
  return data as { id: string; slug: string; name: string }
}

export async function deleteRetailer(slug: string) {
  await service().from('retailers').delete().eq('slug', slug)
}

export async function getSettings(keys: string[]) {
  const { data } = await service().from('site_settings').select('key,value').in('key', keys)
  return (data ?? []) as { key: string; value: unknown }[]
}

/**
 * Puts settings back exactly (including jsonb null, which PostgREST can't
 * write: it turns JSON null into SQL NULL), so this goes through psql.
 */
export function restoreSettings(rows: { key: string; value: unknown }[]) {
  const db = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  for (const r of rows) {
    // Variables are only interpolated in SQL read from stdin, not in -c.
    execFileSync('psql', [db, '-q', '-v', 'ON_ERROR_STOP=1', '-v', `v=${JSON.stringify(r.value)}`, '-v', `k=${r.key}`], {
      input: `update public.site_settings set value = :'v'::jsonb where key = :'k';`,
    })
  }
}
