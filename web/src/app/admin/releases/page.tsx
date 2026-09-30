import Link from 'next/link'
import { ActionButton, ActionSwitch } from '@/components/admin/ActionButton'
import { AdminHeader } from '@/components/admin/bits'
import { ReleaseForm, type ReleaseFormValues } from '@/components/admin/ReleaseForm'
import { fmtDate } from '@/components/Format'
import { deleteRelease, setReleasePublished } from '@/lib/actions/releases'
import { RELEASE_KINDS, productsToLines } from '@/lib/admin/releases'
import { requireSection } from '@/lib/admin/guard'
import { toRelease, RELEASE_SELECT } from '@/lib/data/drops'
import type { ReleaseRow } from '@/lib/data/types'
import { isGame, releasePath } from '@/lib/seo/urls'

export const metadata = { title: 'Releases' }

const BLANK: ReleaseFormValues = {
  id: null, game: 'pokemon', lang: 'en', title: '', slug: '', kind: 'set_release', releaseDate: '', datePrecision: 'day', confidence: 'official',
  setId: '', productLines: '', retailerSlugs: [], summary: '', bodyMd: '', sourceName: '', sourceUrl: '', published: true,
}

function toForm(r: ReleaseRow, setId: string | null, published: boolean): ReleaseFormValues {
  return {
    id: r.id, game: r.game, lang: r.lang, title: r.title, slug: r.slug, kind: r.kind, releaseDate: r.releaseDate ?? '', datePrecision: r.datePrecision,
    confidence: r.confidence, setId: setId ?? '', productLines: productsToLines(r.products), retailerSlugs: r.retailerSlugs, summary: r.summary ?? '',
    bodyMd: r.bodyMd ?? '', sourceName: r.sourceName ?? '', sourceUrl: r.sourceUrl ?? '', published,
  }
}

const dateLabel = (r: ReleaseRow) =>
  !r.releaseDate || r.datePrecision === 'tbc'
    ? 'TBC'
    : r.datePrecision === 'day'
      ? fmtDate(r.releaseDate)
      : r.datePrecision === 'month'
        ? new Date(`${r.releaseDate}T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        : `Q${Math.ceil(Number(r.releaseDate.slice(5, 7)) / 3)} ${r.releaseDate.slice(0, 4)}`

export default async function AdminReleases({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sb } = await requireSection('releases')
  const sp = await searchParams
  const edit = typeof sp.edit === 'string' ? sp.edit : null
  const [rows, sets, rets] = await Promise.all([
    sb.from('release_events').select(RELEASE_SELECT).order('release_date', { ascending: false, nullsFirst: true }).limit(300),
    sb.from('sets').select('id,name,code,game,lang,release_date').order('release_date', { ascending: false, nullsFirst: false }).limit(500),
    sb.from('retailers').select('slug,name').order('name'),
  ])
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST rows */
  const raw = (rows.data ?? []) as any[]
  const list = raw.map((r) => ({ r: toRelease(r), setId: r.set_id as string | null, published: Boolean(r.published) }))
  const editing = edit ? list.find((x) => x.r.id === edit) : null
  const setOptions = ((sets.data ?? []) as { id: string; name: string; code: string; game: string; lang: string }[]).map((s) => ({ id: s.id, game: s.game, label: `${s.name} (${s.code}, ${s.lang.toUpperCase()})` }))
  const retailers = (rets.data ?? []) as { slug: string; name: string }[]

  return (
    <>
      <AdminHeader title="Releases" lead="The public release calendar (/releases/) and its .ics feed. Unpublished entries are only visible here. Members with a reminder are told the day before (exact dates only).">
        {editing && <Link className="btn btn-secondary btn-sm" href="/admin/releases/">New release</Link>}
      </AdminHeader>

      <section className="admin-section admin-panel" aria-labelledby="form-h">
        <h2 id="form-h" className="admin-h2">{editing ? `Edit: ${editing.r.title}` : 'New release'}</h2>
        {sp.saved && editing && <p className="admin-ok mt-2 text-sm" role="status">Created.</p>}
        {editing && isGame(editing.r.game) && (
          <p className="muted text-sm">
            Public page: <Link className="prose-link" href={releasePath(editing.r.game, editing.r.slug)} target="_blank">{releasePath(editing.r.game, editing.r.slug)}</Link>
            {!editing.published && ' (not published yet — only staff can see it)'}
          </p>
        )}
        {/* Keyed so switching entries remounts the form with fresh defaults. */}
        <ReleaseForm key={editing?.r.id ?? 'new'} initial={editing ? toForm(editing.r, editing.setId, editing.published) : BLANK} sets={setOptions} retailers={retailers} />
      </section>

      <section className="admin-section" aria-labelledby="list-h">
        <h2 id="list-h" className="admin-h2">All releases <span className="muted text-sm">({list.length})</span></h2>
        {list.length === 0 ? <p className="muted mt-2 text-sm">No releases yet.</p> : (
          <div className="table-wrap mt-3">
            <table className="dt">
              <caption className="sr-only">Release calendar entries</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Release</th><th scope="col">Kind</th><th scope="col">Confidence</th><th scope="col">Published</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.map(({ r, published }) => (
                  <tr key={r.id} aria-current={edit === r.id ? 'true' : undefined}>
                    <td className="nowrap">{dateLabel(r)}</td>
                    <td className="wrap">
                      <Link className="font-medium prose-link" href={`/admin/releases/?edit=${r.id}`}>{r.title}</Link>
                      <p className="muted text-xs">{r.game === 'one-piece' ? 'One Piece' : 'Pokémon'} · {r.lang.toUpperCase()} · {r.products.length} {r.products.length === 1 ? 'product' : 'products'} · /{r.slug}/</p>
                    </td>
                    <td className="nowrap">{RELEASE_KINDS.find((k) => k.key === r.kind)?.label ?? r.kind}</td>
                    <td className="nowrap">{r.confidence}</td>
                    <td><ActionSwitch action={setReleasePublished.bind(null, r.id)} checked={published} label={`${r.title} published`} /></td>
                    <td className="nowrap">
                      <span className="inline-flex gap-2">
                        {isGame(r.game) && <Link className="btn btn-ghost btn-sm" href={releasePath(r.game, r.slug)} target="_blank" aria-label={`Preview ${r.title}`}>Preview</Link>}
                        <ActionButton action={deleteRelease.bind(null, r.id)} label="Delete" variant="ghost" confirm={`Delete “${r.title}”? Reminders for it are deleted too.`} ariaLabel={`Delete ${r.title}`} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
