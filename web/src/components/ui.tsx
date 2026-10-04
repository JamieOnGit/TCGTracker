import Link from 'next/link'

/** The logo mark: a brand-filled tile with a card and a rising line. Decorative; the wordmark text names the site. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect width="28" height="28" rx="8" className="brand-mark-bg" />
      <rect x="6.5" y="7" width="10" height="14" rx="2" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" transform="rotate(-12 11.5 14)" />
      <rect x="10.5" y="6.5" width="10.5" height="15" rx="2.25" fill="#fff" />
      <path d="M12.75 17.5l2.25-2.25 1.75 1.25 2.25-3" fill="none" className="brand-mark-line" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow eyebrow-accent">{children}</p>
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

/**
 * The TCGTracker default image, for a product we have no picture of yet:
 * the logo mark and wordmark on a soft tile in the site's colours (light and
 * dark). Never a "coming soon" message.
 */
export function ProductPlaceholder({ label, ratio = '63 / 88', compact = false }: { label: string; ratio?: string; compact?: boolean }) {
  return (
    <div className="product-placeholder" style={{ aspectRatio: ratio }} role="img" aria-label={label} data-placeholder="">
      <BrandMark size={compact ? 14 : 44} />
      {!compact && (
        <span className="product-placeholder-word" aria-hidden="true">
          <span className="holo-text">TCG</span>Tracker
        </span>
      )}
    </div>
  )
}

/** Card image in its 63:88 frame, or the TCGTracker default image. */
export function CardImage({ src, alt, width }: { src: string | null | undefined; alt: string; name?: string; width?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- remote catalogue images; next/image is used where hosts are known
    return <img src={src} alt={alt} width={width} className="thumb w-full" loading="lazy" decoding="async" />
  }
  return <ProductPlaceholder label={alt} />
}

export function Thumb({ name, src, size = 28 }: { name: string; src?: string | null; size?: 28 | 40 }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- catalogue images from Scrydex's CDN, a few KB each
    return <img src={src} alt="" className={`thumb thumb-${size}`} width={size} height={Math.round((size * 88) / 63)} loading="lazy" decoding="async" />
  }
  return (
    <span className={`thumb thumb-${size} product-placeholder`} role="img" aria-label={name}>
      <BrandMark size={size === 40 ? 18 : 14} />
    </span>
  )
}
