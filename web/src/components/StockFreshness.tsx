import Link from 'next/link'
import { durationLabel } from '@/lib/domain/drops'

/**
 * How fresh the stock on this page is. Signed-in members (Free or Premium)
 * see it live; visitors and search engines see each listing as it was
 * `delayMinutes` ago, with the free sign-up that unlocks live stock.
 */
export function StockFreshness({ live, delayMinutes, next }: { live: boolean; delayMinutes: number; next: string }) {
  if (live || delayMinutes <= 0)
    return (
      <p className="mt-4 text-sm" data-testid="stock-live">
        <span className="badge badge-live">Live</span> <span className="muted">Stock updates as stores change, for signed-in members.</span>
      </p>
    )
  return (
    <aside className="notice mt-4 text-sm" data-testid="stock-delayed" style={{ borderLeftColor: 'var(--accent)' }}>
      <p>
        <strong>You’re seeing stock as it was {durationLabel(delayMinutes)} ago.</strong> Members see every store’s stock live, free.
      </p>
      <p className="mt-3 flex flex-wrap gap-3">
        <Link href={`/login/?next=${encodeURIComponent(next)}`} className="btn btn-primary btn-sm" rel="nofollow">Sign up free for live stock</Link>
        <Link href="/premium/" className="btn btn-secondary btn-sm">Instant drop alerts with Premium</Link>
      </p>
    </aside>
  )
}
