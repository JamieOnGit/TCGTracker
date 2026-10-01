'use server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { supabaseForRequest } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/seo/urls'
import type { ActionResult } from './result'

const emailSchema = z.object({ email: z.email().max(254), next: z.string().startsWith('/').max(300).optional() })

/** Passwordless sign-in: emails a magic link (Supabase Auth). */
export async function sendMagicLink(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse({ email: form.get('email'), next: form.get('next') || undefined })
  if (!parsed.success) return { ok: false, error: 'Enter a valid email address.', field: 'email' }
  const origin = (await headers()).get('origin') ?? siteUrl()
  // Implicit flow, not PKCE: a PKCE link only works in the browser that asked
  // for it, so tapping it in the Gmail app (its own in-app browser) or on
  // another device failed. /auth/confirm/ finishes the sign-in in any browser.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await sb.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${origin}/auth/confirm/?next=${encodeURIComponent(parsed.data.next ?? '/account/')}` },
  })
  if (error) {
    // 429 covers both the per-address wait (60 s) and the project-wide email cap,
    // which with Supabase's built-in sender is only 2 emails an hour.
    return { ok: false, error: error.status === 429 ? 'We’ve sent a lot of sign-in emails just now. Please wait a few minutes and try again.' : 'Could not send the link. Try again.' }
  }
  return { ok: true, message: `Check ${parsed.data.email} for a sign-in link.` }
}

export async function signOut(): Promise<void> {
  const sb = await supabaseForRequest()
  await sb.auth.signOut()
  redirect('/')
}

const profileSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{2,29}$/, 'Usernames are 3–30 characters: letters, numbers, - and _, starting with a letter or number.'),
  displayName: z.string().trim().max(60, 'Keep it under 60 characters.'),
  locationState: z.enum(['', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']),
  postcode: z.string().trim().regex(/^(\d{4})?$/, 'Postcodes are 4 digits.'),
})

/** Profile (public: username, display name, state) and private postcode. */
export async function updateProfile(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = profileSchema.safeParse({
    username: form.get('username') ?? '',
    displayName: form.get('displayName') ?? '',
    locationState: form.get('locationState') ?? '',
    postcode: form.get('postcode') ?? '',
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: issue?.message ?? 'Check the form.', field: String(issue?.path[0] ?? '') }
  }
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Sign in again.' }
  const v = parsed.data
  const { error } = await sb
    .from('profiles')
    .update({ username: v.username, display_name: v.displayName || null, location_state: v.locationState || null })
    .eq('id', auth.user.id)
  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') return { ok: false, error: 'That username is taken.', field: 'username' }
    return { ok: false, error: 'Could not save your profile. Try again.' }
  }
  const priv = await sb.from('profile_private').update({ postcode: v.postcode || null }).eq('user_id', auth.user.id)
  if (priv.error) return { ok: false, error: 'Could not save your postcode. Try again.', field: 'postcode' }
  revalidatePath('/account/', 'layout')
  return { ok: true, message: 'Profile saved.' }
}
