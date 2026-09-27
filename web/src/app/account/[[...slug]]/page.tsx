import { PendingUi, privateMeta, requireUser } from '@/lib/accountGate'

export const metadata = privateMeta
export const dynamic = 'force-dynamic'

const SCREENS: Record<string, { title: string; items: string[] }> = {
  '': { title: 'Dashboard', items: ['My listings with status', 'Quota meter ("3 of 5 listings used this month")', 'Saved searches and wishlist', 'Notification preferences', 'Subscription: Manage billing (Stripe portal)'] },
  listings: { title: 'My listings', items: ['Draft / pending review / active / sold / expired / rejected (with reason)', 'Renew, mark sold, withdraw'] },
  'listings/new': { title: 'Create listing', items: ['Card search with EN/JP clearly labelled, or sealed product', 'Graded: PSA cert lookup (autofill card + grade, flag mismatch)', 'Photos: front and back required (slab photos for graded)', 'Price, quantity, location, shipping, description', 'Quota indicator; upgrade prompt when used up'] },
  alerts: { title: 'Alerts', items: ['Wishlist / "notify me when listed"', 'Saved searches', 'Drop alert filters (games, retailers) — Premium'] },
  'alerts/new': { title: 'Set an alert', items: ['Notify me when this card is listed'] },
  settings: { title: 'Settings', items: ['Profile, username, state/postcode', 'Notification preferences centre (type × channel)', 'Marketing opt-in (off by default)', 'Blocked users'] },
  'billing/upgrade': { title: 'Upgrade to Premium', items: ['Stripe Checkout (AUD, GST-inclusive)', 'Cancel any time via the Stripe customer portal'] },
  drops: { title: 'Instant drop feed (Premium)', items: ['Live events as they happen, filtered to your games and retailers'] },
}

export default async function Account({ params }: { params: Promise<{ slug?: string[] }> }) {
  const key = ((await params).slug ?? []).join('/')
  await requireUser(`/account/${key ? `${key}/` : ''}`)
  const screen = SCREENS[key] ?? { title: 'Account', items: [] }
  return <PendingUi title={screen.title} items={screen.items} />
}
