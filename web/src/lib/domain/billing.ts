/**
 * Stripe webhook -> subscription state (brief 2). Webhooks are the single
 * source of truth for tier status. This reducer is pure so it can be unit
 * tested; src/app/webhooks/stripe/route.ts verifies signatures and persists.
 *
 * Failed payments: Stripe marks the subscription past_due; we keep Premium
 * until `graceUntil` (billing.grace_period_days), then it lapses to Free.
 * Out-of-order events are ignored using the event timestamp.
 */
import type { StripeStatus } from './tier'

export interface StoredSubscription {
  userId: string
  status: StripeStatus
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  graceUntil: Date | null
  lastEventAt: Date | null
}

export interface StripeSubscriptionLike {
  id: string
  customer: string
  status: string
  cancel_at_period_end: boolean
  items: { data: { price: { id: string }; current_period_end?: number }[] }
  current_period_end?: number
}

export type BillingEvent =
  | { type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted'; created: number; subscription: StripeSubscriptionLike }
  | { type: 'invoice.payment_failed'; created: number; subscriptionId: string }
  | { type: 'invoice.paid'; created: number; subscriptionId: string }

const KNOWN: StripeStatus[] = ['trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused']

function toStatus(s: string): StripeStatus {
  return (KNOWN as string[]).includes(s) ? (s as StripeStatus) : 'none'
}

export function applyBillingEvent(
  current: StoredSubscription,
  event: BillingEvent,
  opts: { gracePeriodDays: number },
): StoredSubscription {
  const at = new Date(event.created * 1000)
  if (current.lastEventAt && at < current.lastEventAt) return current // stale / out of order

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.subscription
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : toStatus(sub.status)
      const periodEnd = sub.items.data[0]?.current_period_end ?? sub.current_period_end
      return {
        ...current,
        status,
        stripeCustomerId: sub.customer,
        stripeSubscriptionId: sub.id,
        stripePriceId: sub.items.data[0]?.price.id ?? current.stripePriceId,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : current.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        graceUntil:
          status === 'past_due'
            ? (current.graceUntil ?? new Date(at.getTime() + opts.gracePeriodDays * 86_400_000))
            : null,
        lastEventAt: at,
      }
    }
    case 'invoice.payment_failed':
      if (event.subscriptionId !== current.stripeSubscriptionId) return current
      return {
        ...current,
        status: current.status === 'active' || current.status === 'trialing' ? 'past_due' : current.status,
        graceUntil: current.graceUntil ?? new Date(at.getTime() + opts.gracePeriodDays * 86_400_000),
        lastEventAt: at,
      }
    case 'invoice.paid':
      if (event.subscriptionId !== current.stripeSubscriptionId) return current
      return { ...current, status: 'active', graceUntil: null, lastEventAt: at }
  }
}
