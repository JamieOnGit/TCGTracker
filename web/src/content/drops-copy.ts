/**
 * Evergreen copy for the drops pages (/drops/<retailer>/ and /drops/<state>/),
 * so each page has unique, useful text around the live feed. Written by hand;
 * keep claims general and verifiable (no invented restock days or allocations).
 */
export interface PageCopy {
  /** 1–3 short paragraphs shown under the page intro. Plain text. */
  intro: string[]
  /** Rendered as a visible FAQ section and as FAQPage JSON-LD. */
  faqs: { q: string; a: string }[]
}

/**
 * Keyed by retailer slug. Monitored: jb-hi-fi, kmart, big-w, target-au, eb-games,
 * premium-bandai-au. Sightings only: toymate, myer, local-game-store.
 */
export const RETAILER_COPY: Record<string, PageCopy> = {
  'jb-hi-fi': {
    intro: [
      'JB Hi-Fi sells Pokémon TCG and One Piece Card Game products in its stores and on its website, often including larger sealed items such as Elite Trainer Boxes, collection boxes and booster bundles. Product pages frequently go up before stock arrives, so a new JB Hi-Fi listing is often an early sign that a release is close.',
      'This page combines our website monitor, which records new listings, pre-orders, back-in-stock events and price changes, with in-store sightings confirmed by members. Every price is compared with the Australian RRP where one is known.',
    ],
    faqs: [
      {
        q: 'Does JB Hi-Fi take pre-orders for Pokémon cards?',
        a: 'Sometimes. Whether a product can be pre-ordered depends on the product and the timing. When a pre-order opens on the JB Hi-Fi website it shows here as "Pre-order open".',
      },
      {
        q: 'Is JB Hi-Fi online stock the same as in-store stock?',
        a: 'Not necessarily. Online orders and store shelves can draw on different stock, so a product may be sold out online but available in a store, or the other way round. Member sightings cover the in-store side.',
      },
      {
        q: 'Are there purchase limits at JB Hi-Fi?',
        a: 'Purchase limits are often applied to popular trading card products, but they vary by product and over time. Check the product page or ask staff.',
      },
      {
        q: 'Does this page show JB Hi-Fi prices against RRP?',
        a: 'Yes. Where the Australian RRP is known, each event is tagged at, below or above RRP, and you can set alerts to fire only at or below RRP.',
      },
    ],
  },
  kmart: {
    intro: [
      'Kmart is one of the most searched places in Australia for Pokémon cards, and much of the action happens on the shelf rather than online. That makes member sightings especially valuable here: collectors report what they find in their local store, other members confirm it, and it becomes an alert.',
      'Our monitor also records changes on the Kmart website where products are listed online. Use the state pages to see sightings near you, and remember that one store having stock says little about the next.',
    ],
    faqs: [
      {
        q: 'When does Kmart restock Pokémon cards?',
        a: 'Kmart doesn’t publish a restock schedule for trading cards, and deliveries differ between stores. Treat “restock day” tips as local anecdotes; confirmed member sightings are a better guide.',
      },
      {
        q: 'Can I report Pokémon stock I see at Kmart?',
        a: 'Yes. Signed-in members can report an in-store sighting with the suburb, product and roughly how much is left. A photo helps it get confirmed faster.',
      },
      {
        q: 'Why is a Kmart product sold out online but on shelves nearby?',
        a: 'Online and in-store stock are usually managed separately, so availability can differ. Check sightings for your state before making a trip.',
      },
    ],
  },
  'big-w': {
    intro: [
      'BIG W sells Pokémon and One Piece trading card products in store and online. Its website often lists products as coming soon or open for pre-order ahead of release, which makes BIG W one of the more predictable places to track an upcoming launch.',
      'We record BIG W listings, pre-orders, stock changes and price movements, and add confirmed in-store sightings from members. Where the Australian RRP is known, each event is tagged against it so you can see at a glance whether a price is fair.',
    ],
    faqs: [
      {
        q: 'Can I pre-order Pokémon products at BIG W?',
        a: 'Some products are offered for pre-order on the BIG W website. When a pre-order opens it appears here, and you can be alerted by choosing the “Pre-order open” event type.',
      },
      {
        q: 'Does BIG W have Pokémon cards in every store?',
        a: 'Range and stock levels vary between stores. Member sightings show where products have actually been seen, filtered by state.',
      },
      {
        q: 'Are there purchase limits at BIG W?',
        a: 'Limits are sometimes applied to popular products. Check the product page or ask staff in store.',
      },
    ],
  },
  'target-au': {
    intro: [
      'Target Australia stocks Pokémon TCG products in many of its stores and on its website. Because range can differ between stores, a confirmed sighting at one Target is a useful lead rather than a promise that every store has the same stock.',
      'This page tracks Target Australia (not the US chain of the same name): website listings and stock changes from our monitor, plus in-store sightings confirmed by members, all priced in AUD against RRP where known.',
    ],
    faqs: [
      {
        q: 'Is this the Australian Target?',
        a: 'Yes. This page covers Target Australia only. Prices are in Australian dollars.',
      },
      {
        q: 'Does Target Australia sell Pokémon cards online?',
        a: 'Some products are sold online, and availability changes often. Online events from the Target website appear here as they happen.',
      },
      {
        q: 'How do I get alerts for Target only?',
        a: 'In your drop alert settings, choose Target as a retailer and optionally add your state and keywords. You’ll only be alerted for matching events.',
      },
    ],
  },
  'eb-games': {
    intro: [
      'EB Games is a specialist games retailer that regularly lists trading card products, often as pre-orders ahead of release. For collectors, the moment a pre-order opens is usually the most important EB Games event to catch.',
      'We monitor the EB Games website for new listings, pre-orders, stock changes and price updates, and members can add in-store sightings. Some products may be online-only or sold through pre-order, so check each listing’s details.',
    ],
    faqs: [
      {
        q: 'Does EB Games take Pokémon and One Piece pre-orders?',
        a: 'EB Games often lists trading card products for pre-order. Pre-order terms such as deposits, payment timing and cancellations are set by EB Games, so read them on the product page.',
      },
      {
        q: 'Will I be alerted when EB Games pre-orders open?',
        a: 'Yes, if your alert filters include EB Games and the “Pre-order open” event type. Premium members are alerted instantly.',
      },
      {
        q: 'Do EB Games stores have stock that isn’t online?',
        a: 'It can happen. In-store availability varies by store, which is where member sightings help.',
      },
    ],
  },
  'premium-bandai-au': {
    intro: [
      'Premium Bandai is Bandai’s official online store. For One Piece Card Game collectors it can be a source of limited products and collections that aren’t widely stocked elsewhere, and popular items can sell out quickly.',
      'We track listings and availability on the Australian storefront, including when a high-demand product uses a virtual queue. It is an online-only store, so there are no in-store sightings on this page.',
    ],
    faqs: [
      {
        q: 'Do I need an account to buy from Premium Bandai?',
        a: 'Online stores like this usually require an account at checkout. Create and verify yours well before a drop so you aren’t doing it while stock sells out.',
      },
      {
        q: 'What does “Queue live” mean?',
        a: 'Some high-demand drops put shoppers in a virtual waiting room. A “Queue live” event means we saw a queue on the store. Join it through the official site; we never queue or buy on anyone’s behalf.',
      },
      {
        q: 'Does Premium Bandai sell One Piece products at RRP?',
        a: 'It is Bandai’s own store, so prices are set by Bandai. Where we know the Australian RRP, we tag each event against it.',
      },
    ],
  },
  toymate: {
    intro: [
      'Toymate is an Australian toy retailer with stores around the country and an online shop, and it stocks trading card products from time to time. We don’t run a website monitor for Toymate, so everything on this page comes from members who have seen stock in store and had it confirmed.',
      'If you spot Pokémon or One Piece product at a Toymate, report it with the suburb and, ideally, a photo. Confirmed reports reach other collectors in your state.',
    ],
    faqs: [
      {
        q: 'Why are there no online restocks for Toymate?',
        a: 'We only monitor some retailers’ websites. For Toymate, this page shows member sightings from stores.',
      },
      {
        q: 'Does Toymate stock Pokémon cards?',
        a: 'Toymate stores sometimes carry trading card products, but range varies by store and over time. Recent sightings show what members have actually found.',
      },
      {
        q: 'How do I report a Toymate sighting?',
        a: 'Sign in, choose Report a sighting, pick Toymate, and add your state, suburb, product and roughly how much is left. A photo helps it get confirmed.',
      },
    ],
  },
  myer: {
    intro: [
      'Myer is a department store, and trading card products sometimes appear in its toy departments, particularly around gift-giving seasons. It isn’t a traditional TCG destination, which is exactly why a confirmed sighting can be worth knowing about.',
      'We don’t monitor Myer’s website, so this page lists in-store sightings reported and confirmed by members. Stock and range vary between stores.',
    ],
    faqs: [
      {
        q: 'Does Myer sell Pokémon cards?',
        a: 'Some Myer stores carry trading card products at times. Check recent sightings for your state rather than assuming every store has them.',
      },
      {
        q: 'Why does this page only show sightings?',
        a: 'We don’t run a website monitor for Myer. Everything here comes from members who saw the stock themselves, confirmed by others.',
      },
      {
        q: 'Can I get alerts for Myer sightings?',
        a: 'Yes. Include Myer in your drop alert retailers, make sure member sightings are switched on, and add your state.',
      },
    ],
  },
  'local-game-store': {
    intro: [
      'Independent game stores are the heart of the Australian TCG community. Many run pre-orders, prerelease and release events, league nights and tournaments, and look after regular players and collectors. Supporting your local store helps keep that community going.',
      'Each store sets its own allocations, pre-order rules and prices, so sightings here are store-specific. Members must include the store name with every report, which makes it easy to see exactly where stock was found.',
    ],
    faqs: [
      {
        q: 'How do independent stores allocate popular products?',
        a: 'It varies. Some prioritise pre-orders, some regular customers or event players, some sell first come, first served. Ask your local store how they handle a release before launch day.',
      },
      {
        q: 'Are local game store prices at RRP?',
        a: 'Independent stores set their own prices. Some sell at RRP, some above or below, especially for high-demand products. Sightings can include the price paid.',
      },
      {
        q: 'Why do sightings need a store name here?',
        a: 'There are many different independent stores, so the store name is required to make a report useful. For chains, the suburb is usually enough.',
      },
      {
        q: 'Can I find prerelease events through TCGTracker?',
        a: 'Our release calendar lists prerelease dates where they’ve been announced. For event times and bookings, contact your local store or check the publisher’s official event locator.',
      },
    ],
  },
}

const EASTERN_TIME = 'Times on TCGTracker are shown in Australian Eastern time (AEST, or AEDT during daylight saving).'

/** Keyed by state code (ACT, NSW, NT, QLD, SA, TAS, VIC, WA). */
export const STATE_COPY: Record<string, PageCopy> = {
  ACT: {
    intro: [
      'Pokémon and One Piece sightings in the ACT come from members across Canberra’s town centres, from Gungahlin and Belconnen to the city, Woden and Tuggeranong. In a compact city, a confirmed sighting can be only a short drive away, so it pays to act on alerts quickly.',
      'This page shows confirmed in-store sightings reported in the ACT. Online restocks aren’t tied to a state; you’ll find those on the main drops page and each retailer’s page.',
    ],
    faqs: [
      {
        q: 'Do ACT alerts include stores in Queanbeyan?',
        a: 'Sightings are filed under the state the store is in. Queanbeyan is in New South Wales, so add NSW to your alert states if you shop there too.',
      },
      {
        q: 'What time zone are ACT alerts shown in?',
        a: 'The ACT uses Australian Eastern time, the same as our site, so alert times match your clock.',
      },
      {
        q: 'How do I get alerts only for Canberra?',
        a: 'In your drop alert settings, choose ACT under states and make sure member sightings are included.',
      },
    ],
  },
  NSW: {
    intro: [
      'New South Wales sightings come from members across greater Sydney and regional centres such as Newcastle, the Central Coast, Wollongong and beyond. With so many stores in the state, confirmed sightings help you work out which ones actually have stock before you set off.',
      'Filter your alerts to NSW and add keywords for the products you want, so you’re only told about the sightings that matter to you. Online restocks apply Australia-wide and are listed on the main drops page.',
    ],
    faqs: [
      {
        q: 'Can I narrow NSW alerts to Sydney only?',
        a: 'Alerts are filtered by state. Each sighting shows its suburb, so you can quickly see whether it’s near you.',
      },
      {
        q: 'What time zone are NSW alerts shown in?',
        a: EASTERN_TIME + ' Most of New South Wales uses Eastern time, so times match your clock. Broken Hill uses Central time, 30 minutes behind.',
      },
      {
        q: 'How are NSW sightings confirmed?',
        a: 'Other members confirm them (fewer confirmations are needed with a photo), a trusted scout reports them, or our team confirms them. Only confirmed sightings trigger alerts.',
      },
    ],
  },
  NT: {
    intro: [
      'Northern Territory sightings come from members in Darwin, Palmerston, Alice Springs and elsewhere in the Territory. With fewer stores spread over long distances, a single confirmed sighting can save a wasted trip. If you see stock, reporting it helps the whole local community.',
      'The NT uses Australian Central Standard Time and doesn’t observe daylight saving, while our alert times are shown in Eastern time. Check the time difference before acting on a time-sensitive alert.',
    ],
    faqs: [
      {
        q: 'How do alert times relate to NT time?',
        a: EASTERN_TIME + ' Darwin is 30 minutes behind AEST, and 1 hour 30 minutes behind during eastern daylight saving.',
      },
      {
        q: 'Are online restocks available in the NT?',
        a: 'Online restocks aren’t tied to a state, but delivery options and times to the NT depend on the retailer. Check shipping details on the product page.',
      },
      {
        q: 'How can I help build NT coverage?',
        a: 'Report stock you see in store with the suburb and a photo. Confirmed reports count towards scout rewards: every 10 confirmed sightings earns 30 days of Premium.',
      },
    ],
  },
  QLD: {
    intro: [
      'Queensland sightings come from members in Brisbane, the Gold Coast, the Sunshine Coast, Toowoomba, Townsville, Cairns and regional towns in between. Stock can reach different parts of a large state at different times, so check the suburb on each sighting.',
      'Queensland doesn’t observe daylight saving. Our alert times are shown in Eastern time, so from October to April they will read one hour ahead of Queensland clocks.',
    ],
    faqs: [
      {
        q: 'Why do alert times look an hour ahead in summer?',
        a: EASTERN_TIME + ' Queensland stays on AEST all year, so during daylight saving in the southern states the times shown are one hour ahead of Queensland time.',
      },
      {
        q: 'Can I get alerts just for Queensland stores?',
        a: 'Yes. Choose QLD under states in your drop alert settings. State filters apply to in-store sightings; online restocks are Australia-wide.',
      },
      {
        q: 'Which retailers do Queensland members report?',
        a: 'Members can report any supported retailer, including Kmart, BIG W, Target, JB Hi-Fi, EB Games and independent game stores.',
      },
    ],
  },
  SA: {
    intro: [
      'South Australian sightings come from members across Adelaide’s suburbs and regional centres such as Mount Gambier, Whyalla and the Riverland. Confirmed sightings tell you which stores have actually had stock, so you can plan your trip.',
      'South Australia uses Australian Central time and observes daylight saving. That puts SA 30 minutes behind the Eastern time shown on our alerts all year round.',
    ],
    faqs: [
      {
        q: 'How do alert times relate to Adelaide time?',
        a: EASTERN_TIME + ' Adelaide is 30 minutes behind that all year, because both regions change for daylight saving together.',
      },
      {
        q: 'Can I include sightings from nearby states?',
        a: 'Yes. You can select several states in your alert settings, which is handy if you travel interstate.',
      },
      {
        q: 'Do I need a photo to report a sighting?',
        a: 'A photo is optional but recommended: a sighting with a photo needs fewer confirmations before it goes out as an alert.',
      },
    ],
  },
  TAS: {
    intro: [
      'Tasmanian sightings come from members in Hobart, Launceston, Devonport, Burnie and around the state. Mainland reports say little about what’s on Tasmanian shelves, so local, confirmed sightings are the most reliable guide to what you can actually buy here.',
      'Tasmania uses Australian Eastern time, including daylight saving, so alert times on TCGTracker match your clock.',
    ],
    faqs: [
      {
        q: 'Do online restocks ship to Tasmania?',
        a: 'Most major retailers deliver to Tasmania, but options and delivery times vary. Check the product page before ordering.',
      },
      {
        q: 'How do I see only Tasmanian sightings?',
        a: 'This page lists confirmed sightings in Tasmania. For alerts, choose TAS under states in your drop alert settings.',
      },
      {
        q: 'What if a sighting is already sold out?',
        a: 'Members can vote “sold out”. Once enough agree, the sighting is marked gone so others don’t make the trip.',
      },
    ],
  },
  VIC: {
    intro: [
      'Victorian sightings come from members across metropolitan Melbourne and regional cities such as Geelong, Ballarat, Bendigo and the Latrobe Valley. Melbourne’s large number of stores means sightings can be frequent, so filters are your friend: pick the retailers you use and add keywords for the products you want.',
      'Our alert times are shown in Melbourne time (AEST/AEDT), so for Victorian collectors they always match the clock.',
    ],
    faqs: [
      {
        q: 'How many confirmations does a Victorian sighting need?',
        a: 'The same as anywhere: a couple of member confirmations, or fewer with a photo. Trusted scouts’ reports and staff-confirmed reports go out straight away.',
      },
      {
        q: 'Can I filter alerts to Victoria and a maximum price?',
        a: 'Yes. Choose VIC under states and set a maximum price, or only alert at or below RRP.',
      },
      {
        q: 'Who are the top scouts in Victoria?',
        a: 'The scouts leaderboard shows members with the most confirmed sightings and the states they report in.',
      },
    ],
  },
  WA: {
    intro: [
      'Western Australian sightings come from members across Perth and regional centres such as Mandurah, Bunbury, Geraldton, Kalgoorlie and Albany. Stock and delivery timing in the west can differ from the east coast, so local sightings are the best signal of what’s actually in WA stores.',
      'WA uses Australian Western Standard Time and doesn’t observe daylight saving. Our alert times are in Eastern time, so an online restock shown at 9:00 am is 7:00 am in Perth, or 6:00 am during eastern daylight saving.',
    ],
    faqs: [
      {
        q: 'How do alert times relate to Perth time?',
        a: EASTERN_TIME + ' Perth is 2 hours behind AEST and 3 hours behind AEDT.',
      },
      {
        q: 'Are online restocks useful from WA?',
        a: 'Yes. Online restocks are national, and you can often order the moment they go live. Check delivery times to WA on the product page.',
      },
      {
        q: 'How do I get WA-only sighting alerts?',
        a: 'Select WA under states in your drop alert settings and keep member sightings switched on.',
      },
    ],
  },
}
