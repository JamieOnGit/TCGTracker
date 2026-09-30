# 08 · What the best alert groups do, and what TCG Trade copies (30 Sep 2026)

This came from the owner's request to learn from Lowkey and other top alert and "cook" groups. It is based on a review of Lowkey (a member's write-up) and web research across AU and international services. Services whose value comes mainly from checkout bots, proxies or auto-checkout were noted but not copied. TCG Trade does not evade retailer bot protection.

## Who's out there

| Service | Market | Price | What they actually offer |
|---|---|---|---|
| **Lowkey** (Whop) | AU, general reselling | A$30 first month, then A$60/mo | Discord: announcements, alerts, retail monitors, links, "flips" (wins), guides, moderator Q&A. The reviewer's biggest complaint: **no guided onboarding, and an overwhelming volume of channels**. It is not TCG-specific. |
| **DropZone** | AU, TCG | A$10/mo, 3-day trial | Discord and Whop app alerts, **state channels where members post in-store shelf sightings**, retailer and product preferences, per-retailer release guides, a members' marketplace, giveaways |
| **Shiny Cardboard Society** | AU, TCG | Free community pass; A$13/mo Premium | Alert format "⚡ Kmart — Marrickville \| product now in stock! 1 per customer". **Member sightings tagged with store and suburb.** Release calendars on the free tier. |
| **CardWatch AU** | AU, Pokémon | – | Activity feed (back in stock / new listing / pre-order live), drops shown as Live / Expected / Confirmed with store counts, "community reported" disclaimer, email and Telegram, watchlist |
| **CardTracker.au** | AU, 108 retailers | Free + premium | Discord, Telegram and WhatsApp alerts; filters by game, product type, retailer and stock; AU release calendar; AU market value; eBay deal flags |
| **PokeNotify** | US | US$7.99/mo | Free tier (calendar, community sightings, map); paid in-store alerts with filters by product type, retailer, price ceiling, ZIP and radius; app push; alert history |
| **House of Carts** | US | US$50/mo | The most detailed alert card: format, retailer, first-party vs marketplace seller, price, region, purchase limit, queue/preorder rules. Triage worksheets. (Its value is mainly staff auto-checkout, which we don't copy.) |
| **PokéMafia Restocker** (Whop) | AU, Pokémon | A$10/mo (from A$12.50), 3-day trial; 4.9★ from 152 reviews | Discord restock alerts for Kmart, Target, BIG W, Amazon, EB Games, JB Hi-Fi and "250+ online & in-store retailers" including small stores; **set-specific alert settings**; **RRP-only filter** (scalped stock excluded); **eBay sniper** (below-market listings, auctions ending); automatic giveaway entry. Reviews praise responsive admins and timely updates. |
| NowInStock, HotStock, Distill, BrickSeek | Generic | Free/paid | Status tables, stock history, "Alert me" per product, email/SMS/push |

## What we copied, and where it lives

1. **Member in-store sightings.** No competitor documents a verification process, which is our edge.
   - **Report:** a member reports store, suburb, state, product, price, quantity, purchase limit, a photo and a note.
   - **Confirm:** two other members confirm it (one if there's a photo), or it comes from a trusted scout or staff. Merging stops duplicate reports.
   - **Close:** "sold out" votes close it. Moderators can reject a report and withdraw its alert, and unconfirmed reports expire.
   - Tables: `sightings` and `sighting_votes`. Pages: `/account/sightings/` and `/drops/<state>/`.
2. **Scout rewards and leaderboard.** Every 10 confirmed sightings earns 30 days of Premium. This replaces the "success channel" and giveaway mechanics with something that improves alert coverage. Page: `/drops/scouts/`.
3. **Guided onboarding (Lowkey's weak spot).** A one-page drop-alert setup covers games, retailers, states, keywords, max price, RRP-only, member reports on/off, channels and a test alert. Page: `/account/alerts/drops/`.
4. **Alert card format** in email, Discord and push: retailer and location, product, price and RRP tag, quantity, purchase limit, source (retailer monitor or member sighting with its confirmation count), relative time, photo, and a product link for online stock.
5. **Delivery**: email, on-site, Discord (Premium) and **web push** (phone and desktop notifications with no app and no SMS cost; on iPhone the site must be added to the Home Screen first). Telegram and WhatsApp can come later.
6. **Filters**: game, retailer, state, keywords, max price, at or below RRP, include member reports.
7. **Release calendar**: releases labelled Official / Retailer listing / Unconfirmed, with day, month or quarter precision, "Remind me" reminders the day before, and `.ics` feeds members can add to their phone calendar.
8. **Beginner guides** at `/guides/`, which also serve SEO. Lowkey's members valued its guides and Q&A.
9. **eBay deal finder** (PokéMafia's "eBay sniper", done compliantly). The workers use eBay's official Browse API, not scraping, to find graded cards listed on eBay Australia well under our market value, plus auctions ending soon under value. Strict title matching (card number and exact grade; no proxies or lots) keeps it trustworthy. Premium sees deals live; everyone else after 24 h. Members who wishlist a card are alerted. Links carry your eBay Partner Network ID. Emails link to our deals page, because EPN doesn't allow affiliate links in email. Table `ebay_deals`, page `/deals/`.
10. **Wider store coverage for sightings.** Members can report from Toymate, Myer, Amazon AU, Costco, Officeworks, Zing, Woolworths, Coles and independent game stores (store name required), as well as the monitored retailers.
11. **Follow sets** in the alert setup (PokéMafia's set-specific alerts), plus the existing "RRP only: skip scalper-priced listings" filter.
12. **Pricing check**: the AU norm is roughly A$10–13/mo, often with a 3–7 day trial. TCG Trade Premium at A$12.99 is in range. A 7-day Stripe trial is optional and set on the Stripe price (see YOUR-NEXT-STEPS.md).

## What we deliberately did not copy
**Automatic giveaway entry.** Chance-based giveaways are trade-promotion lotteries in Australia, and the ACT and SA need permits above certain prize values. We haven't built them. Scout rewards are earned, not drawn. If you want giveaways later, check the permit rules first.


Auto-checkout, cart services, proxies, account generation, CAPTCHA solving and queue skipping. These breach retailer terms and would put the brand (registered to your ABN) and your members' orders at risk. Retailers cancel bot orders.

## Official data routes worth pursuing (owner action)
- **BIG W:** listed on Impact. Impact catalogues can carry a `StockAvailability` field, but whether BIG W publishes one is unconfirmed.
- **Kmart and Target AU:** affiliate programmes are listed through sub-networks. Their feed contents are unknown.
- **JB Hi-Fi:** available through sub-networks such as Skimlinks.
- **Amazon AU:** Associates. The Creators API (which replaced PA-API 5 in May 2026) gives offers and availability, usually once you have qualifying sales.
- **Commission Factory** (AU network): about 80% of merchants have feeds; stock level is an optional field.

Sources: whop.com/pokemafia/restocker, the member's Lowkey review (lowkey-discord-whop-review.mintlify.app), whop.com/blog/lowkey-discord-review, dropzone.gg, shinycardboard.au, cardwatch.com.au, cardtracker.au, pokenotify.com, dashboard.houseofcarts.io, nowinstock.net, integrations.impact.com (catalog item object), help.commissionfactory.com, affiliate-program.amazon.com (PA-API deprecation).
