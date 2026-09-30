'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface NavItem {
  href: string
  label: string
  badge?: number | null
}

/** Side nav on desktop, a horizontally scrolling strip on phones. */
export function AdminNav({ items }: { items: NavItem[] }) {
  const path = usePathname() ?? '/admin/'
  const active = (href: string) => (href === '/admin/' ? path === '/admin/' || path === '/admin' : path.startsWith(href))
  return (
    <nav className="admin-nav" aria-label="Admin sections">
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={active(i.href) ? 'page' : undefined}>
              <span>{i.label}</span>
              {i.badge ? <span className="admin-count" aria-label={`${i.badge} waiting`}>{i.badge}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
