'use server'
import { redirect } from 'next/navigation'
import Stripe from 'stripe'
import { supabaseForRequest, supabaseService } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/seo/urls'

function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PREMIUM_MONTHLY && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('Stripe is not configured')
  return new Stripe(key)
}

/** Starts Stripe Checkout for Premium (A$12.99/month incl. GST, from the price in Stripe). */
export async function startCheckout(): Promise<void> {
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) redirect('/login/?next=/account/billing/upgrade/')
  if (!billingConfigured()) redirect('/account/billing/?error=unavailable')
  const db = supabaseService()
  const { data: sub } = await db.from('subscriptions').select('stripe_customer_id,status').eq('user_id', auth.user.id).single()
  if (sub?.status === 'active' || sub?.status === 'trialing') redirect('/account/billing/')
  const s = stripe()
  let customer = sub?.stripe_customer_id as string | null
  if (!customer) {
    const c = await s.customers.create({ email: auth.user.email, metadata: { user_id: auth.user.id } })
    customer = c.id
    await db.from('subscriptions').update({ stripe_customer_id: customer }).eq('user_id', auth.user.id)
  }
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: process.env.STRIPE_PRICE_PREMIUM_MONTHLY!, quantity: 1 }],
    currency: 'aud',
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    customer_update: { address: 'auto' },
    success_url: `${siteUrl()}/account/billing/?welcome=1`,
    cancel_url: `${siteUrl()}/premium/`,
    subscription_data: { metadata: { user_id: auth.user.id } },
  })
  redirect(session.url!)
}

/** Stripe customer portal: update card, download invoices, cancel in two clicks (Australian Consumer Law). */
export async function openBillingPortal(): Promise<void> {
  const sb = await supabaseForRequest()
  const { data: auth } = await sb.auth.getUser()
  if (!auth.user) redirect('/login/?next=/account/billing/')
  const { data: sub } = await sb.from('subscriptions').select('stripe_customer_id').eq('user_id', auth.user.id).single()
  if (!sub?.stripe_customer_id) redirect('/account/billing/upgrade/')
  if (!process.env.STRIPE_SECRET_KEY) redirect('/account/billing/?error=unavailable')
  const portal = await stripe().billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: `${siteUrl()}/account/billing/` })
  redirect(portal.url)
}
