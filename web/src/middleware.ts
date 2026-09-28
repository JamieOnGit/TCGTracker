import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { demoRepository } from '@/lib/data/demo'
import { DEFAULT_RULES } from '@/lib/domain/rules'
import { listingPageOutcome, type ListingStatus } from '@/lib/domain/listing'
import { listingPath, parseListingSegment } from '@/lib/seo/urls'

/**
 * Runs before every page:
 * 1. One URL per page (brief 7.1): lowercase and trailing slash, via 301.
 * 2. The redirects table: renamed card/set slugs 301 to their new URL.
 * 3. Listing URLs (brief 7.4): wrong slug -> 301, sold/expired past the
 *    visible window -> 301 to the card's marketplace page, rejected/removed -> 410.
 * 4. Refreshes the Supabase session cookie on private routes.
 */
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const REDIRECT_PREFIXES = ['/cards/', '/marketplace/', '/market-cap/']
const PRIVATE_PREFIXES = ['/account/', '/messages/', '/admin/', '/report/']

// Small per-instance cache of redirect lookups (positive and negative).
const cache = new Map<string, { value: { to: string; code: number } | null; at: number }>()
const TTL_MS = 5 * 60_000

async function lookupRedirect(path: string): Promise<{ to: string; code: number } | null> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  let value: { to: string; code: number } | null = null
  if (SB_URL && SB_KEY) {
    const res = await fetch(`${SB_URL}/rest/v1/redirects?select=to_path,code&from_path=eq.${encodeURIComponent(path)}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    })
    const rows = res.ok ? ((await res.json()) as { to_path: string; code: number }[]) : []
    value = rows[0] ? { to: rows[0].to_path, code: rows[0].code } : null
  } else {
    value = await demoRepository.redirectFor(path)
  }
  if (cache.size > 5000) cache.clear()
  cache.set(path, { value, at: Date.now() })
  return value
}

type UrlStatus = { status: ListingStatus; title: string | null; closedAt: string | null; cardMarketPath: string }

async function listingUrlStatus(id: number): Promise<UrlStatus | null> {
  if (SB_URL && SB_KEY) {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/listing_url_status`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_listing: id }),
    })
    const rows = res.ok ? ((await res.json()) as { status: ListingStatus; title: string | null; closed_at: string | null; card_market_path: string }[]) : []
    const r = rows[0]
    return r ? { status: r.status, title: r.title, closedAt: r.closed_at, cardMarketPath: r.card_market_path } : null
  }
  const l = await demoRepository.getListing(id)
  if (!l) return null
  const card = l.cardId ? (await demoRepository.getCardsByIds([l.cardId]))[0] : undefined
  return { status: l.status, title: l.title, closedAt: l.closedAt, cardMarketPath: card ? `/marketplace/${card.game}/${card.lang}/${card.setSlug}/${card.slug}/` : '/marketplace/' }
}

function permanent(req: NextRequest, pathname: string) {
  // A plain URL, not req.nextUrl: NextURL re-applies its own trailing-slash
  // formatting and would strip the slash we're adding.
  const url = new URL(pathname, req.url)
  url.search = pathname.includes('?') ? url.search : req.nextUrl.search
  return NextResponse.redirect(url, 301)
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const last = pathname.split('/').pop() ?? ''
  const isFile = last.includes('.')

  // 1. Canonical form: lowercase + trailing slash.
  if (!isFile) {
    let fixed = pathname.toLowerCase()
    if (!fixed.endsWith('/')) fixed += '/'
    if (fixed !== pathname) return permanent(req, fixed)
  }

  // 3. Listing lifecycle URLs.
  const m = /^\/marketplace\/listing\/([^/]+)\/$/.exec(pathname)
  if (m) {
    const parsed = parseListingSegment(m[1]!)
    if (parsed) {
      const s = await listingUrlStatus(parsed.id)
      if (s) {
        const outcome = listingPageOutcome({
          status: s.status,
          closedAt: s.closedAt ? new Date(s.closedAt) : null,
          now: new Date(),
          soldVisibleDays: DEFAULT_RULES.soldVisibleDays,
          cardMarketplacePath: s.cardMarketPath,
          viewerIsOwner: false,
        })
        if (outcome.kind === 'gone') {
          return new NextResponse('<!doctype html><title>Listing removed</title><h1>This listing has been removed</h1><p><a href="/marketplace/">Browse the marketplace</a></p>', {
            status: 410,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' },
          })
        }
        if (outcome.kind === 'redirect') return permanent(req, outcome.to)
        if (outcome.kind === 'render' && s.title) {
          const canonical = listingPath(parsed.id, s.title)
          if (canonical !== pathname) return permanent(req, canonical)
        }
      }
    }
  }

  // 2. Renamed slugs.
  if (REDIRECT_PREFIXES.some((p) => pathname.startsWith(p))) {
    const r = await lookupRedirect(pathname)
    if (r) {
      if (r.code === 410) return new NextResponse('Gone', { status: 410, headers: { 'X-Robots-Tag': 'noindex' } })
      return permanent(req, r.to)
    }
  }

  // 4. Keep the Supabase session fresh on private routes.
  if (SB_URL && SB_KEY && PRIVATE_PREFIXES.some((p) => pathname.startsWith(p))) {
    let res = NextResponse.next({ request: req })
    const sb = createServerClient(SB_URL, SB_KEY, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) req.cookies.set(name, value)
          res = NextResponse.next({ request: req })
          for (const { name, value, options } of list) res.cookies.set(name, value, options)
        },
      },
    })
    await sb.auth.getUser()
    res.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return res
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|webhooks/).*)'],
}
