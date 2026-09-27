import 'server-only'
import Stripe from 'stripe'
import { applyBillingEvent, type BillingEvent, type StoredSubscription } from '@/lib/domain/billing'
import { effectiveTier } from '@/lib/domain/tier'
import { supabaseService } from '@/lib/supabase/server'

/**
 * Stripe webhooks: the single source of truth for membership tier (brief 2).
 * Signature-verified, idempotent (stripe_events), order-safe (lastEventAt).
 * Subscribe in Stripe to: customer.subscription.created/updated/deleted,
 * invoice.paid, invoice.payment_failed.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const key = process.env.STRIPE_SECRET_KEY
  if (!secret || !key) return new Response('Stripe not configured', { status: 503 })
  const stripe = new Stripe(key)
  const payload = await req.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(payload, req.headers.get('stripe-signature') ?? '', secret)
  } catch {
    return new Response('Bad signature', { status: 400 })
  }

  const db = supabaseService()
  const { error: dupe } = await db.from('stripe_events').insert({ id: event.id, type: event.type, created_at: new Date(event.created * 1000).toISOString() })
  if (dupe) return new Response('Already processed', { status: 200 })

  const billingEvent = toBillingEvent(event)
  if (!billingEvent) return new Response('Ignored', { status: 200 })

  const customerId = 'subscription' in billingEvent ? billingEvent.subscription.customer : null
  const subId = 'subscriptionId' in billingEvent ? billingEvent.subscriptionId : billingEvent.subscription.id
  const { data: row } = await db
    .from('subscriptions')
    .select('*')
    .or(`stripe_subscription_id.eq.${subId}${customerId ? `,stripe_customer_id.eq.${customerId}` : ''}`)
    .maybeSingle()
  if (!row) {
    // Checkout must create the customer with metadata.user_id and we store it
    // on the row at checkout time; an unknown customer is logged, not guessed.
    await db.from('stripe_events').update({ error: 'no subscription row for customer' }).eq('id', event.id)
    return new Response('Unknown customer', { status: 200 })
  }
  const { data: graceSetting } = await db.from('site_settings').select('value').eq('key', 'billing.grace_period_days').single()
  const next = applyBillingEvent(fromRow(row), billingEvent, { gracePeriodDays: Number(graceSetting?.value ?? 7) })
  const tier = effectiveTier({ status: next.status, graceUntil: next.graceUntil })
  const { error } = await db
    .from('subscriptions')
    .update({
      tier,
      status: next.status,
      stripe_customer_id: next.stripeCustomerId,
      stripe_subscription_id: next.stripeSubscriptionId,
      stripe_price_id: next.stripePriceId,
      current_period_end: next.currentPeriodEnd?.toISOString() ?? null,
      cancel_at_period_end: next.cancelAtPeriodEnd,
      grace_until: next.graceUntil?.toISOString() ?? null,
      last_event_at: next.lastEventAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', row.user_id)
  if (error) return new Response('DB error', { status: 500 }) // Stripe retries
  await db.from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id)
  return new Response('ok', { status: 200 })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(r: any): StoredSubscription {
  const d = (v: string | null) => (v ? new Date(v) : null)
  return {
    userId: r.user_id,
    status: r.status,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripePriceId: r.stripe_price_id,
    currentPeriodEnd: d(r.current_period_end),
    cancelAtPeriodEnd: r.cancel_at_period_end,
    graceUntil: d(r.grace_until),
    lastEventAt: d(r.last_event_at),
  }
}

function toBillingEvent(e: Stripe.Event): BillingEvent | null {
  switch (e.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const s = e.data.object
      return {
        type: e.type,
        created: e.created,
        subscription: {
          id: s.id,
          customer: typeof s.customer === 'string' ? s.customer : s.customer.id,
          status: s.status,
          cancel_at_period_end: s.cancel_at_period_end,
          items: { data: s.items.data.map((i) => ({ price: { id: i.price.id }, current_period_end: i.current_period_end })) },
        },
      }
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = e.data.object
      const sub = inv.parent?.subscription_details?.subscription
      const subscriptionId = typeof sub === 'string' ? sub : sub?.id
      return subscriptionId ? { type: e.type, created: e.created, subscriptionId } : null
    }
    default:
      return null
  }
}
