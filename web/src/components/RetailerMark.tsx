import { RETAILER_LOGOS } from '@/content/retailer-logos'
import { monogram } from '@/lib/domain/stock'

/**
 * A store's logo (its own site icon, from public/retailers/), or its
 * monogram when we don't have one. Decorative: the store name is always
 * shown next to it, so it is hidden from screen readers.
 */
export function RetailerMark({ slug, name, size = 20 }: { slug: string; name: string; size?: 20 | 28 | 40 }) {
  const src = RETAILER_LOGOS[slug]
  if (!src) {
    return (
      <span className="mono" aria-hidden="true" style={size === 20 ? undefined : { width: size, height: size, fontSize: Math.round(size * 0.4) }}>
        {monogram(name)}
      </span>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element -- a 96px static icon from public/, already sized; no optimisation needed
  return <img src={src} alt="" aria-hidden="true" width={size} height={size} loading="lazy" decoding="async" className="retailer-logo" style={{ width: size, height: size }} />
}
