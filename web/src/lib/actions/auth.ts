'use server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { supabaseForRequest } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/seo/urls'
import type { ActionResult } from './result'

const emailSchema = z.object({ email: z.email().max(254), next: z.string().startsWith('/').max(300).optional() })

/** Passwordless sign-in: emails a magic link (Supabase Auth). */
export async function sendMagicLink(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse({ email: form.get('email'), next: form.get('next') || undefined })
  if (!parsed.success) return { ok: false, error: 'Enter a valid email address.', field: 'email' }
  const origin = (await headers()).get('origin') ?? siteUrl()
  const sb = await supabaseForRequest()
  const { error } = await sb.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${origin}/auth/callback/?next=${encodeURIComponent(parsed.data.next ?? '/account/')}` },
  })
  if (error) return { ok: false, error: error.status === 429 ? 'Too many attempts. Try again in a minute.' : 'Could not send the link. Try again.' }
  return { ok: true, message: `Check ${parsed.data.email} for a sign-in link.` }
}

export async function signOut(): Promise<void> {
  const sb = await supabaseForRequest()
  await sb.auth.signOut()
  redirect('/')
}
