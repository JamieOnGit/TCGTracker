/**
 * Membership tiers and feature gating (brief 2). Mirrors
 * public.effective_tier() in the database; both are tested.
 */
import type { Rules } from './rules'

export type Tier = 'free' | 'premium'
export type StripeStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused'

export interface SubscriptionState {
  status: StripeStatus
  graceUntil: Date | null
  tierOverride?: Tier | null
  /** Premium earned without a subscription (scout rewards): profile_private.premium_until. */
  premiumUntil?: Date | null
}

export function effectiveTier(sub: SubscriptionState | null | undefined, now: Date = new Date()): Tier {
  if (!sub) return 'free'
  if (sub.tierOverride) return sub.tierOverride
  if (sub.status === 'active' || sub.status === 'trialing') return 'premium'
  if (sub.status === 'past_due' && sub.graceUntil && sub.graceUntil > now) return 'premium'
  if (sub.premiumUntil && sub.premiumUntil > now) return 'premium'
  return 'free'
}

export type Feature =
  | 'browse'
  | 'message_sellers'
  | 'email_alerts'
  | 'instant_drop_alerts'
  | 'delayed_drop_history'
  | 'premium_badge'
  | 'discord_drop_alerts'

const FEATURES: Record<Feature, Tier[]> = {
  browse: ['free', 'premium'],
  message_sellers: ['free', 'premium'],
  email_alerts: ['free', 'premium'],
  delayed_drop_history: ['free', 'premium'],
  instant_drop_alerts: ['premium'],
  premium_badge: ['premium'],
  discord_drop_alerts: ['premium'],
}

export function can(tier: Tier, feature: Feature): boolean {
  return FEATURES[feature].includes(tier)
}

export function quotaLimit(tier: Tier, rules: Rules, override?: number | null): number {
  if (override !== null && override !== undefined) return override
  return tier === 'premium' ? rules.premiumQuota : rules.freeQuota
}
