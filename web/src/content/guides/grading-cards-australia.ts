import type { Guide } from './types'

export const guide: Guide = {
  slug: 'grading-cards-australia',
  title: 'Grading Pokémon and One Piece cards in Australia: PSA, BGS and CGC',
  seoTitle: 'Grading Pokémon & One Piece Cards in Australia: PSA, BGS, CGC',
  description: 'How to get Pokémon and One Piece cards graded from Australia: choosing PSA, BGS or CGC, group submissions, shipping, insurance, customs and costs.',
  dek: 'Choosing a grader, submitting from Australia, shipping and insurance, and deciding whether a card is worth grading.',
  published: '2026-09-30',
  updated: '2026-09-30',
  topic: 'collecting',
  related: [
    { label: 'Market cap rankings (PSA 10, AUD)', href: '/' },
    { label: 'How we calculate market cap', href: '/methodology/' },
    { label: 'Spotting fakes and fake slabs', href: '/guides/how-to-spot-fake-pokemon-cards/' },
    { label: 'Graded cards for sale in Australia', href: '/marketplace/' },
  ],
  faqs: [
    {
      q: 'How much does it cost to grade a Pokémon card from Australia?',
      a: 'It depends on the grading company, the service level you choose (usually tied to the card’s declared value and turnaround), plus shipping and insurance both ways and any submission-service fee. Fees change, so check the grader’s current price list before you submit.',
    },
    {
      q: 'How long does grading take?',
      a: 'Turnaround depends on the service level and the grader’s current workload, plus international shipping time each way. Graders publish estimated turnaround times on their websites; treat them as estimates.',
    },
    {
      q: 'Should I submit directly or through an Australian group submission?',
      a: 'Group submissions can share the cost of international shipping and handle paperwork for you, which helps with small batches. Submitting directly gives you more control. Either way, check the service’s reputation, insurance and fees first.',
    },
    {
      q: 'Does TCG Trade track grades other than PSA 10?',
      a: 'Yes. Our rankings default to PSA 10, and card pages show market cap, population and prices by grade where data is available, all in AUD.',
    },
  ],
  body: `
Grading means sending a card to an independent company that authenticates it, assesses its condition, gives it a grade (usually on a 1–10 scale) and seals it in a tamper-evident case, or "slab". Graded cards are easier to value and trade, which is why our [market cap rankings](/) are built on graded population and prices in AUD.

The major grading companies are based overseas, so grading from Australia involves international shipping, insurance and some patience. Here's how to approach it.

## The main grading companies

- **PSA** (Professional Sports Authenticator) is the most widely used grader for Pokémon cards, and PSA 10 is the benchmark most collectors quote. Official information: [psacard.com](https://www.psacard.com/).
- **BGS** (Beckett Grading Services) is known for subgrades (centring, corners, edges, surface) on its labels.
- **CGC** grades trading cards too, and has become a common choice for Pokémon and One Piece cards.

Other graders exist, including some newer and regional services. Whichever you choose, check how its slabs are valued in the market you plan to sell into. Grades from different companies aren't directly interchangeable, which is why we show grades separately on each card's page.

## What drives the cost

We deliberately don't quote fees here because they change often. The total cost of grading from Australia usually includes:

1. **The grading fee.** Graders offer service levels, generally priced by the card's declared value and how fast you want it back. Check the grader's current price list.
2. **Outbound shipping** from Australia, ideally tracked and insured.
3. **Return shipping and insurance**, usually charged by the grader or submission service.
4. **Submission-service fees** if you use a group submission.
5. **Possible import charges** on the way back (see below).

Declare values honestly. The declared value typically determines your service level and insurance cover, and under-declaring can leave you uninsured.

## Direct submission vs group submission

**Direct.** You create an account with the grader, fill in the submission online, pack the cards and ship them yourself. You keep control, but you pay international shipping for a single parcel.

**Group submission.** An Australian business or organiser collects cards from many people, ships them in bulk and handles returns. This can make small submissions cheaper and simpler. Before using one, check its reputation, how it insures cards in transit and in storage, how long it holds cards before shipping, and the fees on top of the grader's.

## Shipping cards overseas safely

- **Protect every card**: penny sleeve, then a semi-rigid card holder or top loader as the grader instructs, then pack cards snugly so they can't move.
- **Use tracked, insured postage.** [Australia Post](https://auspost.com.au/) offers international parcel services with tracking and optional Extra Cover; courier services are another option. Check coverage limits for high-value parcels.
- **Customs paperwork.** International parcels need a customs declaration describing the contents and value. Describe them accurately.
- **Record everything.** Photograph each card front and back before sending, and keep the submission form and tracking numbers.

## When your cards come back

Returned graded cards are an import into Australia. Low-value parcels usually pass through without charges, but high-value shipments can require a formal import declaration and attract GST and possibly duty. How this applies to cards returning from grading depends on your circumstances. Check the [Australian Border Force](https://www.abf.gov.au/) website or ask your submission service before you send high-value cards.

When the slab arrives, look up the certification number on the grader's website and check the details match.

## Is a card worth grading?

A simple way to decide:

1. **Condition first.** Check centring, corners, edges and surface under good light. Whitening, scratches and print lines rarely get past a grader.
2. **Compare prices.** Look at the card's page in our [catalogue](/cards/) to compare raw and graded prices in AUD, and at population counts. A card that is common in top grades may not be worth grading.
3. **Add up the full cost** (grading, shipping both ways, insurance and fees) and compare it with the realistic value difference.
4. **Think about your goal.** Grading for your own collection is a different decision from grading to sell.

## Japanese and English cards

Both Japanese and English cards can be graded by the major companies. They are different printings, so we track them as separate cards with separate populations and prices. See [Japanese vs English Pokémon cards](/guides/japanese-vs-english-pokemon-cards/) for more.
`,
}
