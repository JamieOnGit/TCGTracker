/**
 * Listing lifecycle (brief 5.2) and what each state means for SEO (brief 7.4).
 * The database trigger listings_enforce_lifecycle() is the enforcement; this
 * mirror drives the UI (which buttons to show) and the listing page response.
 */
export type ListingStatus = 'draft' | 'pending_review' | 'active' | 'rejected' | 'sold' | 'expired' | 'removed'
export type Actor = 'owner' | 'moderator' | 'system'

const TRANSITIONS: Record<ListingStatus, Partial<Record<ListingStatus, Actor[]>>> = {
  draft: { pending_review: ['owner', 'system'], removed: ['owner', 'moderator', 'system'] },
  pending_review: {
    active: ['moderator', 'system'],
    rejected: ['moderator', 'system'],
    draft: ['moderator', 'system'], // request changes
    removed: ['owner', 'moderator', 'system'],
  },
  active: {
    sold: ['owner', 'moderator', 'system'],
    expired: ['moderator', 'system'],
    removed: ['owner', 'moderator', 'system'],
  },
  expired: { active: ['owner', 'moderator', 'system'] }, // renewal
  rejected: {},
  sold: {},
  removed: {},
}

export function canTransition(from: ListingStatus, to: ListingStatus, actor: Actor): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false
}

export type ListingPageOutcome =
  | { kind: 'render'; indexable: boolean; state: 'active' | 'sold' | 'expired' | 'owner-preview' }
  | { kind: 'redirect'; status: 301; to: string }
  | { kind: 'gone'; status: 410 }
  | { kind: 'not-found'; status: 404 }

/**
 * What the public listing URL returns:
 * - active: indexable page
 * - sold/expired: live (noindex is NOT used; the sold price is a useful data
 *   point) for soldVisibleDays, then 301 to the card's marketplace page
 * - rejected/removed: 410, never indexed
 * - draft/pending: 404 to the public (the owner sees a noindex preview)
 */
export function listingPageOutcome(input: {
  status: ListingStatus
  closedAt: Date | null
  now: Date
  soldVisibleDays: number
  cardMarketplacePath: string | null
  viewerIsOwner: boolean
}): ListingPageOutcome {
  const { status, closedAt, now, soldVisibleDays, cardMarketplacePath, viewerIsOwner } = input
  switch (status) {
    case 'active':
      return { kind: 'render', indexable: true, state: 'active' }
    case 'sold':
    case 'expired': {
      const ageDays = closedAt ? (now.getTime() - closedAt.getTime()) / 86_400_000 : 0
      if (ageDays > soldVisibleDays && cardMarketplacePath) {
        return { kind: 'redirect', status: 301, to: cardMarketplacePath }
      }
      return { kind: 'render', indexable: true, state: status }
    }
    case 'rejected':
    case 'removed':
      return { kind: 'gone', status: 410 }
    case 'draft':
    case 'pending_review':
      return viewerIsOwner ? { kind: 'render', indexable: false, state: 'owner-preview' } : { kind: 'not-found', status: 404 }
  }
}
