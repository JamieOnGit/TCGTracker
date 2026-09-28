'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { supabaseForRequest } from '@/lib/supabase/server'
import { slugify } from '@/lib/seo/urls'
import { friendlyError, type ActionResult } from './result'
import { CARD_OPTION_COLS, toCardOption, toSealedOption, type CardOption, type SealedOption } from '@/lib/account/data'
import { scoreCard, searchTokens } from '@/lib/account/format'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const

const listingSchema = z
  .object({
    listingType: z.enum(['graded_single', 'raw_single', 'sealed']),
    cardId: z.uuid().optional(),
    sealedProductId: z.uuid().optional(),
    lang: z.enum(['en', 'jp']),
    grader: z.enum(['PSA', 'BGS', 'CGC', 'SGC', 'TAG']).optional(),
    grade: z.coerce.number().min(1).max(10).multipleOf(0.5).optional(),
    certNumber: z.string().regex(/^\d{6,12}$/, 'Cert numbers are 6–12 digits').optional(),
    condition: z.enum(['NM', 'LP', 'MP', 'HP', 'DMG']).optional(),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(4000).default(''),
    priceAud: z.coerce.number().positive().max(9_999_999),
    qty: z.coerce.number().int().min(1).max(999).default(1),
    locationState: z.enum(STATES),
    postcode: z.string().regex(/^\d{4}$/).optional(),
    pickup: z.coerce.boolean().default(false),
    shippingOptions: z.array(z.object({ name: z.string().max(60), priceAud: z.number().min(0).max(1000) })).max(5).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.listingType === 'sealed' && !v.sealedProductId) ctx.addIssue({ code: 'custom', path: ['sealedProductId'], message: 'Choose the sealed product' })
    if (v.listingType !== 'sealed' && !v.cardId) ctx.addIssue({ code: 'custom', path: ['cardId'], message: 'Choose the card' })
    if (v.listingType === 'graded_single' && (!v.grader || v.grade === undefined)) ctx.addIssue({ code: 'custom', path: ['grade'], message: 'Grader and grade are required' })
    if (v.listingType === 'raw_single' && !v.condition) ctx.addIssue({ code: 'custom', path: ['condition'], message: 'Choose a condition' })
  })

export type ListingInput = z.infer<typeof listingSchema>

function toRow(v: ListingInput, sellerId: string) {
  return {
    seller_id: sellerId,
    listing_type: v.listingType,
    card_id: v.listingType === 'sealed' ? null : v.cardId,
    sealed_product_id: v.listingType === 'sealed' ? v.sealedProductId : null,
    lang: v.lang,
    grader: v.listingType === 'graded_single' ? v.grader : null,
    grade: v.listingType === 'graded_single' ? v.grade : null,
    cert_number: v.listingType === 'graded_single' ? (v.certNumber ?? null) : null,
    condition: v.listingType === 'raw_single' ? v.condition : null,
    title: v.title,
    slug: slugify(v.title).split('-').slice(0, 8).join('-') || 'listing',
    description: v.description,
    price_aud: v.priceAud,
    qty: v.qty,
    location_state: v.locationState,
    postcode: v.postcode ?? null,
    shipping: { pickup: v.pickup, options: v.shippingOptions },
  }
}

/** Step 1: save a draft (photos are uploaded against the draft's id). */
export async function saveDraft(input: unknown, listingId?: number): Promise<ActionResult<{ id: number }>> {
  const parsed = listingSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: issue?.message ?? 'Check the form', field: issue?.path.join('.') }
  }
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in to list a card.' }
  const row = toRow(parsed.data, auth.user.id)
  const q = listingId
    ? sb.from('listings').update(row).eq('id', listingId).eq('seller_id', auth.user.id).select('id').single()
    : sb.from('listings').insert(row).select('id').single()
  const { data, error } = await q
  if (error || !data) return { ok: false, error: friendlyError(error?.message) }
  revalidatePath('/account/listings/')
  return { ok: true, data: { id: data.id as number } }
}

/** Records an uploaded photo (the file itself goes straight to Storage from the browser, under {user_id}/{listing_id}/). */
export async function addListingImage(listingId: number, img: { path: string; kind: string; mime: string; bytes: number; width?: number; height?: number }): Promise<ActionResult<{ id: number }>> {
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user || !img.path.startsWith(`${auth.user.id}/${listingId}/`)) return { ok: false, error: 'Not allowed.' }
  if (!['front', 'back', 'slab-front', 'slab-back', 'other'].includes(img.kind)) return { ok: false, error: 'Unknown photo type.' }
  const { data: last } = await sb.from('listing_images').select('position').eq('listing_id', listingId).order('position', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await sb
    .from('listing_images')
    .insert({
      listing_id: listingId, storage_path: img.path, kind: img.kind, mime_type: img.mime, bytes: img.bytes, width: img.width ?? null, height: img.height ?? null,
      position: last ? Number(last.position) + 1 : 0,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: error?.message.includes('row-level security') ? 'Photos can only be changed while the listing is a draft.' : friendlyError(error?.message) }
  return { ok: true, data: { id: data.id as number } }
}

/** Removes a photo from a draft (row under RLS, then the file from Storage). */
export async function removeListingImage(imageId: number): Promise<ActionResult> {
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in again.' }
  const { data, error } = await sb.from('listing_images').delete().eq('id', imageId).select('storage_path')
  if (error) return { ok: false, error: friendlyError(error.message) }
  const path = (data?.[0]?.storage_path as string | undefined) ?? null
  if (!path) return { ok: false, error: 'Photos can only be changed while the listing is a draft.' }
  if (path.startsWith(`${auth.user.id}/`)) await sb.storage.from('listing-images').remove([path])
  return { ok: true }
}

/** Step 2: submit for review. Quota, photos, banned words and rate limits are enforced by the database. */
export async function submitListing(listingId: number): Promise<ActionResult> {
  const sb = await supabaseForRequest()
  const { data, error } = await sb.from('listings').update({ status: 'pending_review' }).eq('id', listingId).select('status')
  if (error) return { ok: false, error: friendlyError(error.message), field: error.message.includes('QUOTA_EXCEEDED') ? 'quota' : error.message.includes('photos') ? 'photos' : undefined }
  if (!data || data.length === 0) return { ok: false, error: 'Listing not found.' }
  revalidatePath('/account/listings/')
  revalidatePath('/account/')
  return data[0]?.status === 'active'
    ? { ok: true, message: 'Your listing is live.' }
    : { ok: true, message: "Submitted. We review every listing, usually within a few hours; we'll email you when it's live." }
}

export async function setListingStatus(listingId: number, status: 'sold' | 'removed'): Promise<ActionResult> {
  if (status !== 'sold' && status !== 'removed') return { ok: false, error: 'Not allowed.' }
  const sb = await supabaseForRequest()
  const { data, error } = await sb.from('listings').update({ status }).eq('id', listingId).select('id')
  if (error) return { ok: false, error: friendlyError(error.message) }
  if (!data || data.length === 0) return { ok: false, error: 'Listing not found.' }
  revalidatePath('/account/listings/')
  return { ok: true }
}

export async function renewListing(listingId: number): Promise<ActionResult> {
  const sb = await supabaseForRequest()
  const { data: l } = await sb.from('listings').select('status').eq('id', listingId).single()
  const { error } = l?.status === 'expired'
    ? await sb.from('listings').update({ status: 'active' }).eq('id', listingId)
    : await sb.rpc('renew_listing', { p_listing: listingId })
  if (error) return { ok: false, error: friendlyError(error.message) }
  revalidatePath('/account/listings/')
  return { ok: true, message: 'Renewed.' }
}

export async function myQuota(): Promise<{ used: number; limit: number; tier: string } | null> {
  const sb = await supabaseForRequest()
  const { data } = await sb.rpc('my_quota')
  return (data as { used: number; limit: number; tier: string } | null) ?? null
}

/**
 * Catalogue search for the create-listing flow: every word must match the card
 * name, number, variant or the set's name/code (full-text over cards + sets).
 * EN and JP printings are separate cards and are returned separately.
 */
export async function searchCatalogue(q: string, kind: 'card' | 'sealed', lang?: 'en' | 'jp'): Promise<{ cards: CardOption[]; sealed: SealedOption[] }> {
  const tokens = searchTokens(String(q ?? ''))
  if (tokens.length === 0) return { cards: [], sealed: [] }
  const sb = await supabaseForRequest()
  if (kind === 'sealed') {
    let query = sb.from('sealed_products').select('id,name,type,game,lang,rrp_aud').limit(40)
    for (const t of tokens) query = query.ilike('name', `%${t}%`)
    if (lang) query = query.eq('lang', lang)
    const { data } = await query
    return { cards: [], sealed: (data ?? []).map(toSealedOption) }
  }
  const setFilter = tokens.flatMap((t) => [`name.ilike.%${t}%`, `code.ilike.%${t}%`]).join(',')
  const { data: sets } = await sb.from('sets').select('id').or(setFilter).limit(100)
  const setIds = (sets ?? []).map((s) => s.id as string)
  const ors = tokens.flatMap((t) => [`name.ilike.%${t}%`, `number.ilike.%${t}%`])
  if (setIds.length) ors.push(`set_id.in.(${setIds.join(',')})`)
  let query = sb.from('cards').select(CARD_OPTION_COLS).or(ors.join(',')).limit(300)
  if (lang) query = query.eq('lang', lang)
  const { data } = await query
  const cards = (data ?? [])
    .map(toCardOption)
    .map((c) => ({ c, s: scoreCard({ name: c.name, number: c.number, variant: c.variant, setName: c.setName, setCode: c.setCode }, tokens) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name) || a.c.lang.localeCompare(b.c.lang))
    .slice(0, 20)
    .map((x) => x.c)
  return { cards, sealed: [] }
}
