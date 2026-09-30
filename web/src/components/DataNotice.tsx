import Link from 'next/link'
import { fmtDate } from './Format'

/** Provenance line on every data view (brief 8): as-of date, currency, sources, methodology. */
export function DataNotice({ asOf, sources, demo, scope }: { asOf: string | null; sources: string; demo: boolean; scope?: string }) {
  return (
    <p className="provenance">
      {demo && <><strong style={{ color: 'var(--warn)' }}>Preview data, not live prices.</strong> · </>}
      {scope && <>{scope} · </>}AUD · prices to {fmtDate(asOf)} · converted at the RBA daily rate · Sources: {sources} ·{' '}
      <Link href="/methodology/">Methodology</Link>
    </p>
  )
}
