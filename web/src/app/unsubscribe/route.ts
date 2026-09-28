import { NextResponse, type NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/server'

// One-click unsubscribe (Spam Act 2003; RFC 8058 List-Unsubscribe-Post).
// GET shows a confirmation page with a button; POST (from the button or a
// mail client's one-click) turns that alert type's email off.
const page = (title: string, body: string) =>
  new NextResponse(
    `<!doctype html><html lang="en-AU"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · TCG Trade</title><body style="font-family:Inter,Arial,sans-serif;background:#F7F5F0;color:#1C1B19;max-width:520px;margin:80px auto;padding:0 16px"><h1 style="font-family:'Cormorant Garamond',Georgia,serif;font-weight:400">${title}</h1>${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )

async function apply(token: string) {
  const db = supabaseService()
  const { data: t } = await db.from('unsubscribe_tokens').select('user_id,alert_type,used_at').eq('token', token).maybeSingle()
  if (!t) return null
  await db.from('notification_preferences').upsert({ user_id: t.user_id, alert_type: t.alert_type, channel: 'email', enabled: false, updated_at: new Date().toISOString() })
  if (t.alert_type === 'marketing') await db.from('profile_private').update({ marketing_opt_in: false }).eq('user_id', t.user_id)
  await db.from('unsubscribe_tokens').update({ used_at: new Date().toISOString() }).eq('token', token)
  return t.alert_type as string
}

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') ?? ''
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(t)) return page('Link not valid', '<p>This unsubscribe link is not valid. You can manage every alert at <a href="/account/settings/">your settings</a>.</p>')
  return page('Unsubscribe', `<form method="post"><input type="hidden" name="t" value="${t}"><p>Stop these emails?</p><button style="padding:12px 20px;background:#1C1B19;color:#F7F5F0;border:0;cursor:pointer">Unsubscribe</button></form>`)
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const t = String(form?.get('t') ?? req.nextUrl.searchParams.get('t') ?? '')
  const type = /^[A-Za-z0-9_-]{16,128}$/.test(t) ? await apply(t) : null
  if (!type) return page('Link not valid', '<p>This link has expired. Manage alerts at <a href="/account/settings/">your settings</a>.</p>')
  return page('Unsubscribed', `<p>You won't get <strong>${type.replace('_', ' ')}</strong> emails any more. Change this any time in <a href="/account/settings/">your settings</a>.</p>`)
}
