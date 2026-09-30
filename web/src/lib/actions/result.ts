export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; field?: string }

/** Turn a Postgres/PostgREST error into a message a member can act on. */
export function friendlyError(message: string | undefined): string {
  const m = message ?? ''
  if (m.includes('QUOTA_EXCEEDED')) return "You've used this month's listing quota. Upgrade to Premium for 30 listings a month, or wait for the reset on the 1st."
  if (m.includes('RATE_LIMITED')) return "You're going a bit fast. Please wait a minute and try again."
  if (m.includes('photos')) return 'Add at least two photos: the front and the back (slab photos for graded cards).'
  if (m.includes('not allowed') && m.includes('proxies')) return 'Listings for proxies, replicas or fakes are not allowed.'
  if (m.includes('blocked')) return "You can't message this member."
  if (m.includes('not available')) return 'This listing is no longer available.'
  if (m.includes('account is not active')) return 'Your account is suspended. Contact support if you think this is a mistake.'
  if (m.includes('item details are locked')) return 'Card, grade and cert details are locked once submitted. Withdraw the listing and create a new one to change them.'
  if (m.includes('duplicate key')) return 'That already exists.'
  return 'Something went wrong. Please try again.'
}
