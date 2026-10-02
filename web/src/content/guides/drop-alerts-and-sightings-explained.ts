import type { Guide } from './types'

export const guide: Guide = {
  slug: 'drop-alerts-and-sightings-explained',
  title: 'How TCGTracker drop alerts, member sightings and deal alerts work',
  seoTitle: 'How Drop Alerts, Member Sightings & Deal Alerts Work',
  description: 'How TCGTracker finds Pokémon and One Piece restocks in Australia: retailer monitors, member sightings, alert filters, push alerts and eBay deal alerts.',
  dek: 'Monitors, member sightings, confirmations, filters, delivery channels and deal alerts, explained.',
  published: '2026-09-30',
  updated: '2026-09-30',
  topic: 'alerts',
  related: [
    { label: 'Drops feed', href: '/drops/' },
    { label: 'Top scouts', href: '/drops/scouts/' },
    { label: 'eBay deals', href: '/deals/' },
    { label: 'Premium', href: '/premium/' },
    { label: 'Methodology', href: '/methodology/' },
  ],
  faqs: [
    {
      q: 'How fast are Premium alerts?',
      a: 'Premium alerts are sent as soon as an event is detected by a monitor or a sighting is confirmed. Delivery time then depends on the channel: push and on-site notifications are usually quickest, email can take a little longer.',
    },
    {
      q: 'Do free members get alerts?',
      a: 'Yes, after a delay. Free members get the same events later, and everyone can browse the public drop history on the drops pages.',
    },
    {
      q: 'Do you use bots to buy stock?',
      a: 'No. We only check publicly available retailer pages at a respectful rate and never buy, queue or check out on anyone’s behalf. We don’t bypass retailer bot protection.',
    },
    {
      q: 'How do I become a trusted scout?',
      a: 'Report stock you genuinely see in store. Once you have a strong record of confirmed reports and very few rejected ones, your reports are confirmed straight away. Every 10 confirmed sightings also earns 30 days of Premium.',
    },
  ],
  body: `
TCGTracker tells Australian collectors when Pokémon TCG and One Piece Card Game products become available at Australian retailers, and when graded cards are listed below their market value. This guide explains where alerts come from, how member sightings are checked, and how to set up alerts that fit you.

## Where alerts come from

**Retailer monitors.** We check product pages at Australian retailers around the clock for Pokémon and One Piece sealed products. When something changes, such as a new listing, pre-orders opening, stock coming back or a price change, we record a drop event and tag the price against the Australian RRP where it's known.

We do this respectfully: we read public pages at a sensible rate, we don't bypass bot protection, and we never add to cart or check out for anyone.

**Member sightings.** Some of the most useful information comes from collectors in stores. Kmart, BIG W and Target stock, for example, often appears on shelves before or without appearing online. Members can report what they see, and once a report is confirmed it becomes a normal alert.

## How a sighting becomes an alert

1. **A member reports it.** In-store reports include the retailer, state, suburb, product and roughly how much is left (few, some or plenty), plus optional store name, price, purchase limit, photo and note. Online reports need the product link.
2. **It's checked.** A report is confirmed when enough other members confirm it (fewer are needed when there's a photo), when it comes from a trusted scout with a strong record, or when our team confirms it. Pending reports are visible to Premium members, staff and the reporter.
3. **Duplicates merge.** A second report of the same store and game within a few hours counts as a confirmation rather than a new alert.
4. **It goes out.** A confirmed sighting is sent through the same alert pipeline as the monitors.
5. **It's marked gone.** Members can vote "sold out", and the sighting is marked gone once enough agree. Reports that aren't confirmed within a few hours expire.

Moderators can reject a false report, which withdraws its alert. Members have a daily reporting limit to keep things fair.

## Scouts and rewards

The [scouts leaderboard](/drops/scouts/) shows members with the most confirmed sightings. Members with a strong track record become **trusted scouts**, whose reports are confirmed immediately. Every 10 confirmed sightings earns **30 days of Premium**.

## Who gets what, and when

- **Premium** members get alerts instantly and can see pending sightings.
- **Free** members get the same alerts after a short delay (currently 5 minutes).
- **Everyone** can browse the public history on the [drops page](/drops/), each retailer's page and each state's page, after a delay.

See [Premium](/premium/) for current pricing and features.

## Filters: getting only the alerts you want

In [your drop alert settings](/account/alerts/drops/) you can choose:

- **Games**: Pokémon, One Piece or both.
- **Retailers**: only the stores you actually use.
- **Event types**: new listings, pre-orders opening, back in stock, price changes and queues.
- **States**: for in-store sightings (online restocks apply Australia-wide).
- **Keywords**: for example a set name or "booster box". Only titles containing one of them alert you.
- **Maximum price**, or **at or below RRP only**.
- **Include member sightings**, or monitors only.

## Delivery channels

Alerts can arrive by **email**, **on-site notification**, **web push** (to your phone or desktop browser, once you allow notifications) and **Discord**. Choose channels in your notification settings. Times are shown in Australian Eastern time (AEST/AEDT).

## eBay deal alerts

Separately from retail drops, the [deals page](/deals/) lists graded cards on eBay priced below our market value for that card and grade. Listings come from eBay's official API, and "market value" follows our published [methodology](/methodology/): the same floor-price rules behind the [market cap rankings](/).

To be alerted about deals, add cards to your wishlist. Premium members get deal alerts live; the public deals page shows a selection for everyone. A deal is a price signal, not a guarantee. Always check the listing, photos, seller feedback and certification number before you buy, and read our guide to [spotting fakes](/guides/how-to-spot-fake-pokemon-cards/).

## Release reminders

The [release calendar](/releases/) lists Australian release dates. On any upcoming release you can set a reminder, and we'll notify you the day before once the exact date is confirmed. Pair it with pre-order alerts for the best chance of buying at RRP.

## Good practice for everyone

- Only report stock you've seen yourself, and only confirm reports you can verify.
- Respect retailers and staff: no pressure, no hoarding, follow purchase limits.
- If an alert is wrong, vote on it or report it so we can fix it quickly.
`,
}
