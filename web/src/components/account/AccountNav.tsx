'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS = [
  { href: '/account/', label: 'Overview', exact: true },
  { href: '/account/listings/', label: 'Listings' },
  { href: '/messages/', label: 'Messages' },
  { href: '/account/alerts/', label: 'Alerts' },
  { href: '/account/sightings/', label: 'Sightings' },
  { href: '/account/notifications/', label: 'Notifications' },
  { href: '/account/settings/', label: 'Settings' },
  { href: '/account/billing/', label: 'Billing' },
]

export function AccountNav() {
  const pathname = usePathname()
  return (
    <div className="acct-nav">
      <nav className="container-x subnav" aria-label="Account">
        {ITEMS.map((i) => {
          const current = i.exact ? pathname === i.href : pathname.startsWith(i.href)
          return (
            <Link key={i.href} href={i.href} aria-current={current ? 'page' : undefined}>
              {i.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
