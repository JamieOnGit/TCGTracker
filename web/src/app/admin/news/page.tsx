import { AdminHeader, StatusBadge } from '@/components/admin/bits'
import { fmtDate } from '@/components/Format'
import { articles } from '@/lib/admin/data'
import { requireSection } from '@/lib/admin/guard'

export const metadata = { title: 'News' }

export default async function AdminNews() {
  const { sb } = await requireSection('news')
  const rows = await articles(sb)
  return (
    <>
      <AdminHeader title="News" lead="Articles in the database. The editor (drafts, scheduling, tags and SEO fields) is coming in Phase 4." />
      <p className="notice mb-6"><strong>Coming in Phase 4.</strong> Until then, articles are added directly in the database by an admin.</p>
      {rows.length === 0 ? <p className="muted text-sm">No articles yet.</p> : (
        <div className="table-wrap">
          <table className="dt">
            <caption className="sr-only">Articles</caption>
            <thead><tr><th scope="col">Title</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Published</th><th scope="col">Updated</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="wrap font-medium">{a.title}<p className="muted text-xs">/{a.slug}/</p></td>
                  <td>{a.category}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td className="nowrap">{fmtDate(a.published_at)}</td>
                  <td className="nowrap">{fmtDate(a.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
