import Link from 'next/link'
import { siteName } from '@/lib/seo/urls'

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/marketplace/', label: 'Marketplace' },
  { href: '/drops/', label: 'Drops' },
  { href: '/news/', label: 'News' },
  { href: '/cards/', label: 'Cards' },
  { href: '/premium/', label: 'Premium' },
]

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="logo">{siteName()}</Link>
      <nav aria-label="Primary">
        <ul>
          {NAV.map((n) => (
            <li key={n.href}><Link href={n.href}>{n.label}</Link></li>
          ))}
        </ul>
      </nav>
      <form action="/search/" role="search">
        <label htmlFor="site-q" className="sr-only">Search cards</label>
        <input id="site-q" name="q" type="search" placeholder="Search cards" />
      </form>
      <nav aria-label="Account">
        <ul>
          <li><Link href="/account/">Dashboard</Link></li>
          <li><Link href="/account/listings/">My Listings</Link></li>
          <li><Link href="/messages/">Messages</Link></li>
          <li><Link href="/account/alerts/">Alerts</Link></li>
          <li><Link href="/account/settings/">Settings</Link></li>
        </ul>
      </nav>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Footer">
        <ul>
          {['methodology', 'data', 'api', 'about', 'contact', 'terms', 'privacy'].map((p) => (
            <li key={p}><Link href={`/${p}/`}>{p === 'api' ? 'API' : p[0]!.toUpperCase() + p.slice(1)}</Link></li>
          ))}
        </ul>
      </nav>
      <p>
        Pokémon and One Piece are trademarks of their respective owners (Nintendo, Creatures, GAME FREAK, The Pokémon
        Company; Eiichiro Oda, Shueisha, Toei Animation, Bandai). {siteName()} is an independent Australian site and is not
        affiliated with, endorsed or sponsored by any of them. Names are used descriptively.
      </p>
    </footer>
  )
}
