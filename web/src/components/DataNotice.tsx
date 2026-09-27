import Link from 'next/link'

/** "Last updated · Sources · Methodology" line required on every data page (brief 8). */
export function DataNotice({ asOf, sources, demo }: { asOf: string | null; sources: string; demo: boolean }) {
  return (
    <p className="data-notice">
      {demo && <strong>Demo data — not real prices or populations. </strong>}
      Last updated {asOf ?? '—'} · All prices AUD (FX: RBA daily rate) · Sources: {sources} ·{' '}
      <Link href="/methodology/">Methodology</Link>
    </p>
  )
}
