import Link from 'next/link'
import { StaticPage, staticMeta } from '@/lib/staticPage'

// The URL in our monitor's User-Agent: what it does and how a store can opt out.
export const metadata = staticMeta(
  '/about/bot/',
  'TCGTrackerBot: How Our Stock Monitor Works',
  'TCGTrackerBot checks public product listings of Australian stores for Pokémon and One Piece stock. It obeys robots.txt and is easy to block or slow down.',
)

export default function AboutBot() {
  return (
    <StaticPage path="/about/bot/" h1="TCGTrackerBot" eyebrow="For store owners" lead="Our stock monitor, what it reads, and how to control it.">
      <p>
        TCGTrackerBot identifies itself as <code>TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/)</code>. It checks
        whether Pokémon TCG and One Piece Card Game products are in stock at Australian stores, so collectors can be told
        when stock lands and sent straight to your product page to buy it at your price.
      </p>
      <h2>What it reads</h2>
      <ul>
        <li>Only what your store publishes openly: public product listings and catalogue feeds (for example a Shopify collection&apos;s <code>products.json</code>, or the WooCommerce Store API).</li>
        <li>Product title, price, availability and the product page link. It never adds to cart, checks out, logs in or creates accounts.</li>
        <li>It doesn&apos;t try to get past bot protection. If your site answers with a challenge or a 403, we stop and record the store as unavailable.</li>
      </ul>
      <h2>How often</h2>
      <p>About one request per collection every one to two minutes, never more than one request every few seconds to the same site, and it backs off on 429 and 403 responses. A <code>Crawl-delay</code> in your robots.txt is honoured.</p>
      <h2>Opting out or slowing it down</h2>
      <p>Add this to your robots.txt and the monitor stops on its next check:</p>
      <pre><code>{`User-agent: TCGTrackerBot
Disallow: /`}</code></pre>
      <p>Or slow it down with <code>Crawl-delay: 30</code> under the same user agent. You can also email <a href="mailto:hello@tcgtracker.com.au">hello@tcgtracker.com.au</a> and we&apos;ll change it by hand within a business day. We&apos;re also happy to use an official product feed or affiliate programme if you have one.</p>
      <p>See which stores we watch, and how, on the <Link href="/drops/stores/">store coverage page</Link>.</p>
    </StaticPage>
  )
}
