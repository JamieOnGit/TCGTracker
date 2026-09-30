import type { Metadata } from 'next'
import Link from 'next/link'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { DealCard } from '@/components/DealCard'
import { JsonLd } from '@/components/JsonLd'
import { LiveDeals } from '@/components/LiveDeals'
import { PageIntro } from '@/components/ui'
import { getRepo } from '@/lib/data'
import { isLive } from '@/lib/domain/deals'
import { EBAY_DISCLOSURE } from '@/lib/domain/ebay'
import { buildMetadata } from '@/lib/seo/metadata'
import { faqPage } from '@/lib/seo/jsonld'

export const revalidate = 300

export const metadata: Metadata = buildMetadata({
  path: '/deals/',
  title: 'Pokémon Card Deals on eBay Australia (Under Market Value)',
  description:
    'Graded Pokémon and One Piece cards listed on eBay Australia well under their market value in AUD, plus auctions ending soon. Checked against TCG Trade’s price data through the day.',
})

const FAQS = [
  {
    q: 'How do you decide a listing is a deal?',
    a: 'We compare the eBay price with our market value for that exact card, language and grade — the same value shown on the card page, built from recent Australian sales and asking prices converted to AUD. Buy It Now listings at least 20% under value count as deals, as do auctions ending within two hours that are still under value.',
  },
  {
    q: 'Is postage included?',
    a: 'The headline price is the item price. Postage is shown next to it when the seller lists it, so check the total before you buy.',
  },
  {
    q: 'Do you buy or sell these cards?',
    a: 'No. We find listings through eBay’s official search API and link to them. The sale is between you and the eBay seller, covered by eBay’s Money Back Guarantee. Links may earn us a commission at no cost to you.',
  },
]

/** Public, delayed deals (RLS hides fresh ones) + the Premium live list. */
export default async function Deals() {
  const repo = getRepo()
  const rows = (await repo.deals({ limit: 60 })).filter((d) => isLive(d))
  return (
    <div className="container-x">
      <div className="pt-6"><Breadcrumbs items={[{ name: 'eBay deals', path: '/deals/' }]} /></div>
      <PageIntro
        eyebrow="eBay Australia · AUD"
        title="Card deals under market value"
        lead="Graded Pokémon and One Piece cards listed on eBay Australia well below what they usually sell for, and auctions ending soon that are still cheap. Premium members see them the moment we find them; everyone else a day later."
      />
      <LiveDeals />
      <div className="grid lg:grid-cols-[1fr_300px] lg:gap-12">
        <section className="section min-w-0" aria-labelledby="deals-h">
          <h2 id="deals-h">Recent deals</h2>
          <p className="muted mt-2 text-sm">
            Shown 24 hours after we find them, so many will have sold. Prices in AUD. <span title={EBAY_DISCLOSURE}>{EBAY_DISCLOSURE}</span>
          </p>
          {rows.length === 0 ? (
            <div className="notice mt-6">
              <strong>Deal finding is being switched on.</strong> We&apos;re connecting to eBay&apos;s official search to check the most-wanted cards through the day.
              In the meantime, <Link className="prose-link" href="/account/alerts/">add cards to your wishlist</Link> and we&apos;ll tell you when one is listed here or turns up on eBay under value.
            </div>
          ) : (
            <div className="mt-4">{rows.map((d) => <DealCard key={d.id} deal={d} />)}</div>
          )}
          {repo.isDemo && <p className="provenance">Preview data.</p>}
        </section>
        <aside className="grid content-start gap-10 pb-16 lg:py-24">
          <section aria-labelledby="how-h">
            <h2 id="how-h" className="text-xl">How value is calculated</h2>
            <dl className="mt-3 grid gap-3 text-sm">
              {FAQS.map((f) => (
                <div key={f.q}><dt className="font-medium">{f.q}</dt><dd className="muted">{f.a}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-sm"><Link href="/methodology/" className="prose-link">Our methodology</Link></p>
          </section>
          <section aria-labelledby="alert-h">
            <h2 id="alert-h" className="text-xl">Get alerted</h2>
            <p className="muted mt-3 text-sm">
              Add a card to your wishlist (use <strong>Alert me</strong> on any card page) and we&apos;ll email you when it&apos;s listed on TCG Trade or found on eBay under value — instantly on Premium.
            </p>
            <p className="mt-3 text-sm"><Link href="/account/alerts/" className="prose-link">Your wishlist</Link> · <Link href="/premium/" className="prose-link">Compare Free and Premium</Link></p>
          </section>
        </aside>
      </div>
      <JsonLd data={faqPage(FAQS)} />
    </div>
  )
}
