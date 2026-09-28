'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { supabaseForRequest } from '@/lib/supabase/server'
import { slugify } from '@/lib/seo/urls'
import { friendlyError, type ActionResult } from './result'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const

export const listingSchema = z
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
  return { ok: true, data: { id: data.id as number } }
}

/** Records an uploaded photo (the file itself goes straight to Storage from the browser, under {user_id}/). */
export async function addListingImage(listingId: number, img: { path: string; kind: string; mime: string; bytes: number; width?: number; height?: number }): Promise<ActionResult> {
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user || !img.path.startsWith(`${auth.user.id}/`)) return { ok: false, error: 'Not allowed.' }
  const { count } = await sb.from('listing_images').select('id', { count: 'exact', head: true }).eq('listing_id', listingId)
  const { error } = await sb.from('listing_images').insert({
    listing_id: listingId, storage_path: img.path, kind: img.kind, mime_type: img.mime, bytes: img.bytes, width: img.width ?? null, height: img.height ?? null, position: count ?? 0,
  })
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true }
}

/** Step 2: submit for review. Quota, photos, banned words and rate limits are enforced by the database. */
export async function submitListing(listingId: number): Promise<ActionResult> {
  const sb = await supabaseForRequest()
  const { error } = await sb.from('listings').update({ status: 'pending_review' }).eq('id', listingId)
  if (error) return { ok: false, error: friendlyError(error.message) }
  revalidatePath('/account/listings/')
  return { ok: true, message: "Submitted. We review every listing, usually within a few hours; we'll email you when it's live." }
}

export async function setListingStatus(listingId: number, status: 'sold' | 'removed'): Promise<ActionResult> {
  const sb = await supabaseForRequest()
  const { error } = await sb.from('listings').update({ status }).eq('id', listingId)
  if (error) return { ok: false, error: friendlyError(error.message) }
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
