import Link from 'next/link'
import { breadcrumbs, type Crumb } from '@/lib/seo/jsonld'
import { JsonLd } from './JsonLd'

/** Visible breadcrumbs + BreadcrumbList JSON-LD (brief 7.3: on every page). */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const all = [{ name: 'Home', path: '/' }, ...items]
  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs">
        <ol>
          {all.map((c, i) => (
            <li key={c.path}>
              {i < all.length - 1 ? <Link href={c.path}>{c.name}</Link> : <span aria-current="page">{c.name}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <JsonLd data={breadcrumbs(all)} />
    </>
  )
}
