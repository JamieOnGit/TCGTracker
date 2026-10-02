'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Bell, Home, LayoutGrid, Menu, Search, ShoppingBag, Store, X } from 'lucide-react'
import { loadSupabaseBrowser, supabaseAvailable } from '@/lib/supabase/browser-lazy'
import { BrandMark } from './ui'

type Item = { href: string; label: string; match: string[] }

function isActive(pathname: string, item: Item) {
  return item.match.some((m) => (m === '/' ? pathname === '/' : pathname.startsWith(m)))
}

export function NavLinks({ items }: { items: Item[] }) {
  const pathname = usePathname()
  return (
    <>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="nav-link" aria-current={isActive(pathname, i) ? 'page' : undefined}>
          {i.label}
        </Link>
      ))}
    </>
  )
}

export function HeaderScroll() {
  useEffect(() => {
    const el = document.getElementById('site-header')
    const on = () => el?.setAttribute('data-scrolled', String(window.scrollY > 8))
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return null
}

/** Sign in link, or bell + account menu when signed in. Client-side so pages stay cacheable. */
export function AccountArea() {
  const [state, setState] = useState<{ signedIn: boolean; unread: number; loaded: boolean }>(() => ({ signedIn: false, unread: 0, loaded: !supabaseAvailable() }))
  useEffect(() => {
    if (!supabaseAvailable()) return
    let cancelled = false
    let cleanup = () => {}
    ;(async () => {
    const sb = (await loadSupabaseBrowser())!
    if (cancelled) return
    const load = async () => {
      const { data } = await sb.auth.getUser()
      if (!data.user) return !cancelled && setState({ signedIn: false, unread: 0, loaded: true })
      const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      if (!cancelled) setState({ signedIn: true, unread: count ?? 0, loaded: true })
    }
    load()
    const channel = sb
      .channel('bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => load())
      .subscribe()
    cleanup = () => sb.removeChannel(channel)
    })()
    return () => {
      cancelled = true
      cleanup()
    }
  }, [])
  if (!state.loaded) return <span className="inline-block w-16" aria-hidden="true" />
  if (!state.signedIn)
    return (
      <>
        <Link href="/login/" className="nav-link hidden sm:inline">Sign in</Link>
        <Link href="/premium/" className="btn btn-primary btn-sm hidden sm:inline-flex">Get alerts</Link>
      </>
    )
  return (
    <>
      <Link href="/account/notifications/" className="icon-btn relative" aria-label={`Notifications${state.unread ? `, ${state.unread} unread` : ''}`}>
        <Bell size={18} strokeWidth={1.75} />
        {state.unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />}
      </Link>
      <Link href="/account/" className="nav-link hidden sm:inline">Account</Link>
    </>
  )
}

export function MobileMenu({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const [lastPath, setLastPath] = useState(pathname)
  if (pathname !== lastPath) {
    // Close the menu after navigating (state update during render, per React docs).
    setLastPath(pathname)
    setOpen(false)
  }
  return (
    <div className="lg:hidden">
      <button className="icon-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <Menu size={20} strokeWidth={1.75} />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'var(--bg)' }}>
          <div className="container-x flex h-[var(--header-h)] items-center justify-between border-b" style={{ borderColor: 'var(--line)' }}>
            <span className="wordmark"><BrandMark /><span><span className="holo-text">TCG</span>Tracker</span></span>
            <button className="icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}><X size={20} strokeWidth={1.75} /></button>
          </div>
          <nav className="container-x grid gap-2 py-6" aria-label="Mobile">
            <form action="/search/" role="search" className="search-wrap mb-3">
              <Search size={16} strokeWidth={2} aria-hidden="true" className="search-icon" />
              <label htmlFor="m-q" className="sr-only">Search cards</label>
              <input id="m-q" name="q" type="search" className="search-field" placeholder="Search cards, sets" />
            </form>
            {items.map((i) => (
              <Link key={i.href} href={i.href} className="menu-link" aria-current={isActive(pathname, i) ? 'page' : undefined}>{i.label}</Link>
            ))}
            <hr className="hairline my-2" />
            <Link href="/account/" className="menu-link menu-link-sm">Account</Link>
            <Link href="/messages/" className="menu-link menu-link-sm">Messages</Link>
            <Link href="/account/alerts/" className="menu-link menu-link-sm">Alerts</Link>
            <Link href="/account/listings/new/" className="btn btn-primary mt-4">Sell a card</Link>
          </nav>
        </div>
      )}
    </div>
  )
}

export function TabBar() {
  const pathname = usePathname()
  const tabs = [
    { href: '/', label: 'Market', icon: Home, match: ['/', '/market-cap/'] },
    { href: '/cards/', label: 'Cards', icon: LayoutGrid, match: ['/cards/'] },
    { href: '/search/', label: 'Search', icon: Search, match: ['/search/'] },
    { href: '/marketplace/', label: 'Buy & sell', icon: Store, match: ['/marketplace/'] },
    { href: '/stock/', label: 'Stock', icon: ShoppingBag, match: ['/stock/', '/drops/'] },
  ]
  return (
    <nav className="tabbar" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={isActive(pathname, t) ? 'page' : undefined}>
          <t.icon size={20} strokeWidth={1.75} aria-hidden="true" />
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

const themeListeners = new Set<() => void>()
function readTheme(): string {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/** Light (Daylight) is the default; a dark choice is saved and re-applied before paint by layout.tsx. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(
    (cb) => {
      themeListeners.add(cb)
      return () => themeListeners.delete(cb)
    },
    readTheme,
    () => 'light',
  )
  const apply = (t: string) => {
    try {
      localStorage.setItem('theme', t)
    } catch {}
    document.documentElement.setAttribute('data-theme', t)
    themeListeners.forEach((l) => l())
  }
  return (
    <div className="seg" role="radiogroup" aria-label="Theme">
      {['light', 'dark'].map((t) => (
        <button key={t} role="radio" aria-checked={theme === t} onClick={() => apply(t)} type="button">
          {t[0]!.toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  )
}
