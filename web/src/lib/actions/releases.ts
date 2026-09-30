'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { currentUserWithRole, supabaseForRequest } from '@/lib/supabase/server'
import { parseProductLines, releaseSchema } from '@/lib/admin/releases'
import { releasePath, releasesHubPath, releasesPath, slugify } from '@/lib/seo/urls'
import { friendlyError, type ActionResult } from './result'

// Release calendar editing. Runs as the signed-in editor/admin so RLS
// ("release_events: editors write") and the audit trigger apply.
async function editor() {
  const me = await currentUserWithRole()
  if (!me || !(me.role === 'admin' || me.role === 'editor')) return null
  return { me, sb: await supabaseForRequest() }
}

const text = (form: FormData, k: string) => String(form.get(k) ?? '').trim()

export async function saveRelease(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const s = await editor()
  if (!s) return { ok: false, error: 'Editors and admins only.' }
  const { products, errors } = parseProductLines(text(form, 'products'))
  if (errors.length) return { ok: false, error: errors[0]!, field: 'products' }
  const title = text(form, 'title')
  const parsed = releaseSchema.safeParse({
    id: text(form, 'id') || null,
    game: text(form, 'game'),
    lang: text(form, 'lang'),
    title,
    slug: text(form, 'slug') || slugify(title),
    kind: text(form, 'kind'),
    releaseDate: text(form, 'release_date') || null,
    datePrecision: text(form, 'date_precision'),
    confidence: text(form, 'confidence'),
    setId: text(form, 'set_id') || null,
    products,
    retailerSlugs: form.getAll('retailer').map(String),
    summary: text(form, 'summary') || null,
    bodyMd: text(form, 'body_md') || null,
    sourceName: text(form, 'source_name') || null,
    sourceUrl: text(form, 'source_url') || null,
    published: form.get('published') === 'on',
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: issue?.message ?? 'Check the form.', field: issue?.path[0]?.toString() }
  }
  const v = parsed.data
  const row = {
    game: v.game,
    lang: v.lang,
    slug: v.slug,
    title: v.title,
    kind: v.kind,
    release_date: v.releaseDate,
    date_precision: v.datePrecision,
    confidence: v.confidence,
    set_id: v.setId,
    products: v.products,
    retailer_slugs: v.retailerSlugs.length ? v.retailerSlugs : null,
    summary: v.summary,
    body_md: v.bodyMd,
    source_name: v.sourceName,
    source_url: v.sourceUrl,
    published: v.published,
  }
  const res = v.id
    ? await s.sb.from('release_events').update(row).eq('id', v.id).select('id').maybeSingle()
    : await s.sb.from('release_events').insert(row).select('id').single()
  if (res.error) {
    if (res.error.code === '23505') return { ok: false, error: 'Another release for this game already uses that slug.', field: 'slug' }
    return { ok: false, error: friendlyError(res.error.message) }
  }
  if (!res.data) return { ok: false, error: 'Not found (or you can’t edit it).' }
  revalidatePath('/admin/releases/')
  revalidatePath(releasesHubPath())
  revalidatePath(releasesPath(v.game))
  revalidatePath(releasePath(v.game, v.slug))
  if (!v.id) redirect(`/admin/releases/?edit=${res.data.id}&saved=1`)
  return { ok: true, message: 'Saved.' }
}

export async function setReleasePublished(id: string, published: boolean): Promise<ActionResult> {
  const s = await editor()
  if (!s) return { ok: false, error: 'Editors and admins only.' }
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'Not found.' }
  const { error } = await s.sb.from('release_events').update({ published }).eq('id', id)
  revalidatePath('/admin/releases/')
  revalidatePath(releasesHubPath())
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

export async function deleteRelease(id: string): Promise<ActionResult> {
  const s = await editor()
  if (!s) return { ok: false, error: 'Editors and admins only.' }
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'Not found.' }
  const { error } = await s.sb.from('release_events').delete().eq('id', id)
  revalidatePath('/admin/releases/')
  revalidatePath(releasesHubPath())
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Deleted.' }
}
