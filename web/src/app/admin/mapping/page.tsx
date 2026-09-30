import { AdminHeader, LangTag } from '@/components/admin/bits'
import { MappingActions } from '@/components/admin/MappingActions'
import { EmptyState } from '@/components/ui'
import { mappingQueue } from '@/lib/admin/data'
import { fmtAgo } from '@/lib/admin/format'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'Card mapping' }

const GAME: Record<string, string> = { pokemon: 'Pokémon', 'one-piece': 'One Piece' }
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null)

function reasonsList(r: unknown): string[] {
  if (Array.isArray(r)) return r.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
  if (r && typeof r === 'object') return Object.entries(r).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  return []
}

export default async function AdminMapping() {
  const { sb } = await requireSection('mapping')
  const items = await mappingQueue(sb)
  return (
    <>
      <AdminHeader title="Card mapping" lead="Price records the auto-matcher couldn’t link with confidence. Japanese and English printings are separate cards: a record can only map to a card in its own language." />
      {items.length === 0 ? (
        <EmptyState title="Nothing to map." body="Unmatched or low-confidence records from the price sources land here." />
      ) : (
        <ol className="mapping-list">
          {items.map((m) => {
            const p = m.payload ?? {}
            const pct = m.confidence === null ? null : Math.round(m.confidence * 100)
            return (
              <li key={m.id} className="mapping-item" data-mapping-id={m.id}>
                <div className="mapping-side">
                  <p className="eyebrow">Source record</p>
                  <p className="mt-1 font-medium">{str(p.name) ?? '(no name)'}</p>
                  <dl className="kv mt-2">
                    <dt>Source</dt><dd>{m.source} · <span className="num">{m.external_id}</span></dd>
                    <dt>Game</dt><dd>{m.game ? GAME[m.game] : 'unknown'}</dd>
                    <dt>Language</dt><dd><LangTag lang={m.lang} /></dd>
                    <dt>Set</dt><dd>{str(p.set) ?? str(p.set_name) ?? '—'}</dd>
                    <dt>Number</dt><dd>{str(p.number) ?? '—'}</dd>
                    <dt>Variant</dt><dd>{str(p.variant) ?? '—'}</dd>
                    <dt>Queued</dt><dd>{fmtAgo(m.created_at)}</dd>
                  </dl>
                </div>
                <div className="mapping-side">
                  <p className="eyebrow">Suggested card</p>
                  {m.suggested ? (
                    <>
                      <p className="mt-1 font-medium">{m.suggested.name} <span className="muted text-sm">#{m.suggested.number}{m.suggested.variant !== 'standard' ? ` · ${m.suggested.variant}` : ''}</span></p>
                      <p className="muted text-sm">{m.suggested.set?.name} ({m.suggested.set?.code}) · {GAME[m.suggested.game]}</p>
                      <p className="mt-1"><LangTag lang={m.suggested.lang} />{m.lang && m.suggested.lang !== m.lang && <span className="badge badge-warn ml-2">Language differs</span>}</p>
                    </>
                  ) : (
                    <p className="muted mt-1 text-sm">No suggestion. Pick a card below.</p>
                  )}
                  {pct !== null && (
                    <p className="confidence mt-3">
                      <span className="confidence-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                      {pct}% confidence
                    </p>
                  )}
                  {reasonsList(m.reasons).length > 0 && (
                    <ul className="reasons">{reasonsList(m.reasons).map((r) => <li key={r}>{r}</li>)}</ul>
                  )}
                </div>
                <MappingActions id={m.id} game={m.game} lang={m.lang} hasSuggestion={Boolean(m.suggested) && (!m.lang || m.suggested?.lang === m.lang)} />
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}
