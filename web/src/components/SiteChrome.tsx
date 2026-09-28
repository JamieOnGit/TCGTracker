import Link from 'next/link'
import { siteName } from '@/lib/seo/urls'
import { AccountArea, HeaderScroll, MobileMenu, NavLinks, TabBar, ThemeToggle } from './ChromeClient'

export const NAV = [
  { href: '/', label: 'Market', match: ['/', '/market-cap/'] },
  { href: '/cards/', label: 'Cards', match: ['/cards/', '/releases/'] },
  { href: '/marketplace/', label: 'Marketplace', match: ['/marketplace/', '/sellers/'] },
  { href: '/drops/', label: 'Drops', match: ['/drops/'] },
  { href: '/news/', label: 'News', match: ['/news/'] },
  { href: '/premium/', label: 'Premium', match: ['/premium/'] },
]

export function SiteHeader() {
  return (
    <header className="site-header" id="site-header">
      <HeaderScroll />
      <div className="container-x flex h-full items-center gap-6">
        <Link href="/" className="wordmark" aria-label={`${siteName()} home`}>
          <span className="holo-text">TCG</span> Trade
        </Link>
        <nav aria-label="Primary" className="hidden flex-1 justify-center gap-7 lg:flex">
          <NavLinks items={NAV} />
        </nav>
        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          <form action="/search/" role="search" className="hidden w-60 md:block">
            <label htmlFor="site-q" className="sr-only">Search cards</label>
            <input id="site-q" name="q" type="search" className="search-field" placeholder="Search cards, sets" autoComplete="off" />
          </form>
          <AccountArea />
          <MobileMenu items={NAV} />
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  const cols: { title: string; links: [string, string][] }[] = [
    { title: 'Market', links: [['Market cap', '/'], ['Pokémon', '/market-cap/pokemon/'], ['One Piece', '/market-cap/one-piece/'], ['Methodology', '/methodology/'], ['Data & API', '/data/']] },
    { title: 'Cards', links: [['Pokémon English', '/cards/pokemon/en/'], ['Pokémon Japanese', '/cards/pokemon/jp/'], ['One Piece English', '/cards/one-piece/en/'], ['One Piece Japanese', '/cards/one-piece/jp/'], ['Release calendar', '/releases/pokemon/']] },
    { title: 'Buy & sell', links: [['Marketplace', '/marketplace/'], ['Sell a card', '/account/listings/new/'], ['Retail drops', '/drops/'], ['JB Hi-Fi restocks', '/drops/jb-hi-fi/'], ['Premium', '/premium/']] },
    { title: 'TCG Trade', links: [['About', '/about/'], ['Contact', '/contact/'], ['News', '/news/'], ['Terms', '/terms/'], ['Privacy', '/privacy/']] },
  ]
  return (
    <footer className="site-footer">
      <div className="container-x">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="wordmark">TCG Trade</Link>
            <p className="muted mt-4 text-sm">Australia&apos;s graded Pokémon and One Piece card market, in AUD.</p>
          </div>
          {cols.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <p className="eyebrow">{c.title}</p>
              <ul>
                {c.links.map(([label, href]) => (
                  <li key={href}><Link href={href}>{label}</Link></li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="legal">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p>© {new Date().getFullYear()} TCG Trade · Australia · All prices in AUD, GST inclusive where applicable.</p>
            <ThemeToggle />
          </div>
          <p>
            Market data is indicative and not financial advice. Pokémon is a trademark of Nintendo, Creatures and GAME FREAK (The Pokémon Company); One
            Piece is a trademark of Eiichiro Oda, Shueisha and Toei Animation, and the One Piece Card Game is published by Bandai. TCG Trade is independent
            and not affiliated with, endorsed or sponsored by any of them.
          </p>
        </div>
      </div>
    </footer>
  )
}

export { TabBar }
