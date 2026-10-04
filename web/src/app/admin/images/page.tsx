import Link from 'next/link'
import { AdminHeader, LangTag } from '@/components/admin/bits'
import { ImageFix } from '@/components/admin/ImageFix'
import { EmptyState } from '@/components/ui'
import { imageCoverage, latestPipelineRuns, missingImages, type CoverageRow } from '@/lib/admin/data'
import { fmtAgo } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Images' }

const GAME: Record<string, string> = { pokemon: 'Pokémon', 'one-piece': 'One Piece' }
const pct = (done: number, total: number) => (total ? Math.round((1000 * done) / total) / 10 : null)

function CoverageTable({ title, rows }: { title: string; rows: CoverageRow[] }) {
  const total = rows.reduce((s, r) => s + r.total, 0)
  const done = rows.reduce((s, r) => s + r.withImage, 0)
  const all = pct(done, total)
  return (
    <section className="mt-6" aria-label={`${title} coverage`}>
      <h2 className="text-lg">
        {title}: <span className="num" data-coverage={title.toLowerCase()}>{all === null ? '—' : `${all}%`}</span>
        <span className="muted text-sm"> ({done.toLocaleString('en-AU')} of {total.toLocaleString('en-AU')} have an image)</span>
      </h2>
      {rows.length > 0 && (
        <div className="table-wrap mt-2">
          <table className="dt">
            <thead><tr><th scope="col">Game</th><th scope="col">Language</th><th scope="col" className="n">With image</th><th scope="col" className="n">Missing</th><th scope="col" className="n">Coverage</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.game}-${r.lang}`}>
                  <td>{GAME[r.game] ?? r.game}</td>
                  <td><LangTag lang={r.lang as 'en' | 'jp'} /></td>
                  <td className="n">{r.withImage.toLocaleString('en-AU')}</td>
                  <td className="n">{(r.total - r.withImage).toLocaleString('en-AU')}</td>
                  <td className="n">{pct(r.withImage, r.total)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default async function AdminImages() {
  const { sb } = await requireSection('images')
  const [coverage, cards, sealed, runs] = await Promise.all([imageCoverage(sb), missingImages(sb, 'cards'), missingImages(sb, 'sealed'), latestPipelineRuns(sb)])
  const run = runs.find((r) => r.job === 'images')
  return (
    <>
      <AdminHeader
        title="Images"
        lead="Card and sealed-product images. The daily import fills them from Scrydex, then TCGdex (Pokémon cards) and each product’s own store listing. Anything still missing shows the TCGTracker default image; paste an image address below to fix it by hand. Hand-set images are never replaced."
      />
      <p className="muted text-sm">{run ? <>Last import {fmtAgo(run.started_at)} ({run.status}).</> : 'The import hasn’t run yet.'} Run it now: <code>fly ssh console -C &quot;python -m tcgworkers.main --once images&quot;</code></p>
      <CoverageTable title="Cards" rows={coverage.cards} />
      <CoverageTable title="Sealed products" rows={coverage.sealed} />
      {[['Sealed products without an image', sealed, 'sealed'] as const, ['Cards without an image', cards, 'card'] as const].map(([title, items, kind]) => (
        <section key={kind} className="mt-10" aria-label={title}>
          <h2 className="text-lg">{title}{items.length === 100 ? ' (first 100)' : ''}</h2>
          {items.length === 0 ? (
            <EmptyState title="All done." body="Every one has an image." />
          ) : (
            <ul className="mt-3 grid gap-3">
              {items.map((m) => (
                <li key={m.id} className="image-fix-item grid gap-2 md:grid-cols-[1fr_1.4fr] md:items-center" data-missing={kind}>
                  <div>
                    <Link href={m.href} className="prose-link font-medium">{m.name}</Link> <LangTag lang={m.lang as 'en' | 'jp'} />
                    <p className="muted text-xs">{GAME[m.game] ?? m.game} · {m.detail}</p>
                  </div>
                  <ImageFix kind={kind} id={m.id} name={m.name} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  )
}
