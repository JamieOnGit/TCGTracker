/** The store's one-tap checkout link: it puts the item in the cart and opens
 * the store's checkout, where the member enters their own address and
 * payment. nofollow: an action link, not a page for search engines. */
export function CheckoutButton({ href, store, title, compact = false }: { href: string; store: string; title: string; compact?: boolean }) {
  return (
    <a href={href} rel="nofollow noopener" target="_blank" className="btn btn-primary btn-sm" data-checkout style={{ whiteSpace: 'nowrap' }}>
      {compact ? 'Add to cart' : 'Add to cart & check out'}
      <span className="sr-only"> {title} at {store} (opens the store’s checkout in a new tab)</span>
    </a>
  )
}
