import Link from 'next/link'
import { siteName } from '@/lib/seo/urls'
import { Search } from 'lucide-react'
import { AccountArea, HeaderScroll, MobileMenu, NavLinks, TabBar, ThemeToggle } from './ChromeClient'
import { BrandMark } from './ui'

export const NAV = [
  { href: '/', label: 'Market', match: ['/', '/market-cap/'] },
  { href: '/cards/', label: 'Cards', match: ['/cards/', '/releases/'] },
  { href: '/marketplace/', label: 'Marketplace', match: ['/marketplace/', '/sellers/'] },
  { href: '/stock/', label: 'Stock', match: ['/stock/'] },
  { href: '/drops/', label: 'Drops', match: ['/drops/', '/deals/'] },
  { href: '/news/', label: 'News', match: ['/news/', '/guides/'] },
  { href: '/premium/', label: 'Premium', match: ['/premium/'] },
]

export function SiteHeader() {
  return (
    <header className="site-header" id="site-header">
      <HeaderScroll />
      <div className="container-x flex h-full items-center gap-4 xl:gap-6">
        <Link href="/" className="wordmark" aria-label={`${siteName()} home`}>
          <BrandMark />
          <span><span className="holo-text">TCG</span>Tracker</span>
        </Link>
        <nav aria-label="Primary" className="hidden flex-1 justify-center gap-1 lg:flex">
          <NavLinks items={NAV} />
        </nav>
        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          <form action="/search/" role="search" className="search-wrap hidden w-52 md:block xl:w-64">
            <Search size={16} strokeWidth={2} aria-hidden="true" className="search-icon" />
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
    { title: 'Cards', links: [['Pokémon English', '/cards/pokemon/en/'], ['Pokémon Japanese', '/cards/pokemon/jp/'], ['One Piece English', '/cards/one-piece/en/'], ['One Piece Japanese', '/cards/one-piece/jp/'], ['Release calendar', '/releases/']] },
    { title: 'Buy & sell', links: [['Marketplace', '/marketplace/'], ['Sell a card', '/account/listings/new/'], ['Retail drops', '/drops/'], ['eBay deals', '/deals/'], ['Premium', '/premium/']] },
    { title: 'TCGTracker', links: [['About', '/about/'], ['Contact', '/contact/'], ['News', '/news/'], ['Guides', '/guides/'], ['Terms', '/terms/'], ['Privacy', '/privacy/']] },
  ]
  return (
    <footer className="site-footer">
      <div className="container-x">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="wordmark"><BrandMark /><span><span className="holo-text">TCG</span>Tracker</span></Link>
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
            <p>© {new Date().getFullYear()} TCGTracker · Australia · All prices in AUD, GST inclusive where applicable.</p>
            <ThemeToggle />
          </div>
          <p>
            Market data is indicative and not financial advice. Pokémon is a trademark of Nintendo, Creatures and GAME FREAK (The Pokémon Company); One
            Piece is a trademark of Eiichiro Oda, Shueisha and Toei Animation, and the One Piece Card Game is published by Bandai. TCGTracker is independent
            and not affiliated with, endorsed or sponsored by any of them.
          </p>
        </div>
      </div>
    </footer>
  )
}

export { TabBar }
