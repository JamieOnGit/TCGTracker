import Link from 'next/link'

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>
}

export function PageIntro({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="pb-8 pt-10 md:pt-16">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 className="mt-3">{title}</h1>
      {lead && <p className="lead mt-4">{lead}</p>}
      {children}
    </div>
  )
}

export function Stat({ label, value, sub, small }: { label: string; value: React.ReactNode; sub?: React.ReactNode; small?: boolean }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`stat-value${small ? ' sm' : ''}`}>{value}</p>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function StatStrip({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  return <div className="stats" style={{ ['--cols' as string]: cols }}>{children}</div>
}

/** Link-based segmented control: every option is a real, crawlable URL. */
export function SegLinks({ label, options }: { label: string; options: { href: string; label: string; current: boolean; rel?: string }[] }) {
  return (
    <nav className="seg" aria-label={label}>
      {options.map((o) => (
        <Link key={o.href + o.label} href={o.href} aria-current={o.current ? 'page' : undefined} rel={o.rel} scroll={false}>
          {o.label}
        </Link>
      ))}
    </nav>
  )
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="glyph" aria-hidden="true" />
      <p className="serif">{title}</p>
      {body && <p className="muted mt-2 text-sm">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'up'; title?: string; children: React.ReactNode }) {
  return (
    <div className={`notice${tone === 'warn' ? ' notice-warn' : tone === 'up' ? ' notice-up' : ''}`} role={tone === 'warn' ? 'note' : undefined}>
      {title && <strong>{title} </strong>}
      {children}
    </div>
  )
}

/** Card image in its 63:88 frame, or a typographic placeholder (no stock scans until image rights are cleared). */
export function CardImage({ src, alt, name, width }: { src: string | null | undefined; alt: string; name: string; width?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- remote catalogue images; next/image is used where hosts are known
    return <img src={src} alt={alt} width={width} className="thumb w-full" loading="lazy" decoding="async" />
  }
  return (
    <div className="card-placeholder" role="img" aria-label={alt}>
      {name}
    </div>
  )
}

export function Thumb({ name, size = 28 }: { name: string; size?: 28 | 40 }) {
  return <span className={`thumb thumb-${size}`} role="img" aria-label={`${name} (image coming soon)`} />
}
