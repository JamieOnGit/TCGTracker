import Link from 'next/link'
import { getRepo } from '@/lib/data'
import { formatAud } from '@/lib/domain/rules'
import { StaticPage, staticMeta } from '@/lib/staticPage'

export const revalidate = 3600
export const metadata = staticMeta('/premium/', 'Premium Membership – Instant TCG Drop Alerts & 30 Listings a Month', 'Premium: instant Pokémon and One Piece retail drop alerts, 30 marketplace listings a month and a Premium badge. Cancel any time.')

export default async function Premium() {
  const rules = await getRepo().getRules()
  const price = formatAud(rules.premiumMonthlyCents)
  return (
    <StaticPage path="/premium/" h1="Premium">
      <table>
        <caption>Free vs Premium</caption>
        <thead><tr><th scope="col">Feature</th><th scope="col">Free</th><th scope="col">Premium ({price}/month)</th></tr></thead>
        <tbody>
          <tr><th scope="row">Browse market cap, cards, marketplace, news</th><td>Yes</td><td>Yes</td></tr>
          <tr><th scope="row">Marketplace listings</th><td>{rules.freeQuota} per calendar month</td><td>Up to {rules.premiumQuota} per calendar month</td></tr>
          <tr><th scope="row">Message sellers on-site</th><td>Yes</td><td>Yes</td></tr>
          <tr><th scope="row">Email alerts: messages, listing status, saved searches, wishlist</th><td>Yes</td><td>Yes</td></tr>
          <tr><th scope="row">Retail drop alerts (email + on-site; Discord optional)</th><td>Public history, {rules.dropsPublicDelayMinutes}+ min delay</td><td>Instant</td></tr>
          <tr><th scope="row">Premium badge on profile and listings</th><td>No</td><td>Yes</td></tr>
        </tbody>
      </table>
      <p>{price} per month in Australian dollars, GST included. Cancel any time from your account; Premium stays on until the end of the period you&apos;ve paid for.</p>
      <p><Link href="/account/billing/upgrade/" rel="nofollow">Upgrade to Premium</Link></p>
    </StaticPage>
  )
}
