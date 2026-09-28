'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { supabaseForRequest } from '@/lib/supabase/server'
import { friendlyError, type ActionResult } from './result'

const body = z.string().trim().min(1, 'Write a message').max(4000)

/** Buyer contacts a seller about a listing: opens (or reuses) the thread and sends the first message. */
export async function contactSeller(listingId: number, text: string): Promise<ActionResult<{ conversationId: string }>> {
  const parsed = body.safeParse(text)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message }
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in to message the seller.' }
  let { data: conv } = await sb.from('conversations').select('id').eq('listing_id', listingId).eq('buyer_id', auth.user.id).maybeSingle()
  if (!conv) {
    const res = await sb.from('conversations').insert({ listing_id: listingId, buyer_id: auth.user.id, seller_id: auth.user.id }).select('id').single()
    if (res.error) return { ok: false, error: friendlyError(res.error.message) }
    conv = res.data
  }
  const { error } = await sb.from('messages').insert({ conversation_id: conv!.id, sender_id: auth.user.id, body: parsed.data })
  if (error) return { ok: false, error: friendlyError(error.message) }
  return { ok: true, data: { conversationId: conv!.id as string } }
}

export async function sendMessage(conversationId: string, text: string, attachment?: { path: string; bytes: number }): Promise<ActionResult> {
  const parsed = body.safeParse(text)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message }
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in again.' }
  if (attachment && !attachment.path.startsWith(`${auth.user.id}/`)) return { ok: false, error: 'Not allowed.' }
  const { error } = await sb.from('messages').insert({
    conversation_id: conversationId, sender_id: auth.user.id, body: parsed.data,
    attachment_path: attachment?.path ?? null, attachment_bytes: attachment?.bytes ?? null,
  })
  if (error) return { ok: false, error: friendlyError(error.message) }
  revalidatePath(`/messages/${conversationId}/`)
  return { ok: true }
}

export async function markRead(conversationId: string): Promise<void> {
  const sb = await supabaseForRequest()
  await sb.rpc('mark_conversation_read', { p_conversation: conversationId })
}

export async function blockUser(userId: string): Promise<ActionResult> {
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in again.' }
  const { error } = await sb.from('blocks').insert({ blocker_id: auth.user.id, blocked_id: userId })
  return error && !error.message.includes('duplicate') ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Blocked. They can no longer message you.' }
}

const reportSchema = z.object({
  targetType: z.enum(['listing', 'user', 'conversation', 'message']),
  targetId: z.string().min(1).max(64),
  reason: z.enum(['scam', 'counterfeit', 'misrepresented', 'offensive', 'spam', 'off_platform_payment', 'other']),
  details: z.string().max(2000).optional(),
})

export async function report(input: unknown): Promise<ActionResult> {
  const parsed = reportSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Choose a reason.' }
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in to report.' }
  const { error } = await sb.from('reports').insert({
    reporter_id: auth.user.id, target_type: parsed.data.targetType, target_id: parsed.data.targetId, reason: parsed.data.reason, details: parsed.data.details ?? null,
  })
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true, message: 'Thanks — our moderators will review it.' }
}
