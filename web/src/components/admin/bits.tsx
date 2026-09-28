import Link from 'next/link'
import type { Health } from '@/lib/admin/format'
import { HEALTH_LABEL } from '@/lib/admin/format'

/** EN/JP spelled out, never a bare flag: JP and EN are different cards with different prices. */
export function LangTag({ lang }: { lang: string | null | undefined }) {
  if (!lang) return <span className="muted">—</span>
  return (
    <span className={`lang-tag lang-${lang}`}>
      <span className="badge badge-lang">{lang.toUpperCase()}</span> {lang === 'jp' ? 'Japanese' : 'English'}
    </span>
  )
}

export function HealthDot({ health }: { health: Health }) {
  return (
    <span className="health" data-health={health}>
      <span className="health-dot" aria-hidden="true" />
      {HEALTH_LABEL[health]}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ['failed', 'rejected', 'banned', 'removed', 'past_due', 'unpaid'].includes(status)
    ? 'badge-warn'
    : ['succeeded', 'sent', 'active', 'actioned', 'approved', 'trialing'].includes(status)
      ? 'badge-live'
      : 'badge-lang'
  return <span className={`badge ${tone}`}>{status.replace(/_/g, ' ')}</span>
}

export function AdminHeader({ title, lead, children }: { title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="admin-page-head">
      <div className="min-w-0">
        <h1>{title}</h1>
        {lead && <p className="muted mt-2 text-sm">{lead}</p>}
      </div>
      {children && <div className="admin-page-tools">{children}</div>}
    </header>
  )
}

export function Pager({ page, pages, total, href }: { page: number; pages: number; total: number; href: (p: number) => string }) {
  return (
    <nav className="pager" aria-label="Pages">
      <span>Page {page} of {pages} · {total} rows</span>
      <span className="flex gap-4">
        {page > 1 && <Link href={href(page - 1)} rel="prev">Newer</Link>}
        {page < pages && <Link href={href(page + 1)} rel="next">Older</Link>}
      </span>
    </nav>
  )
}
