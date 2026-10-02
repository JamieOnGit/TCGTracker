# Email asking for per-store stock levels (Good Games, Toyworld, Kmart)

Per-store stock counts ("7 at Box Hill") exist for these chains. They aren't open to automated reading, though:
- **Good Games** and **Toyworld** use the *Stock In Store* service (stockinstore.net). Its robots.txt says `Disallow: /`.
- **Kmart** serves its store stock from `/api/`, which its robots.txt disallows.

We only show them with the owner's permission. This email asks for it. Send it from hello@tcgtracker.com.au to the head-office or e-commerce contact, and personalise the first line.

For Good Games and Toyworld, also send a short version to Stock In Store (https://www.stockinstore.com.au, contact form). It can then switch on a data feed once each retailer agrees.

---

**Subject:** Sending Pokémon buyers to your stores: can we show your in-store stock?

Hi {Name / team},

I run TCGTracker (https://tcgtracker.com.au), an Australian site where Pokémon and One Piece collectors check what's in stock and get restock alerts. Every listing links straight to the store's own page.

We already show {Store name}'s online stock live: https://tcgtracker.com.au/stock/{store-slug}/. Collectors keep asking which **{Store name} store** near them has stock on the shelf. Your website already shows this per store, but your robots.txt and your stock provider's ask automated tools not to read it, so we don't.

Would you be open to one of these?

1. Permission for our bot (`TCGTrackerBot`, https://tcgtracker.com.au/about/bot/) to read your store-stock lookup for Pokémon and One Piece products only, at a rate you choose, or
2. A simple feed (CSV, JSON or your stock provider's export) of trading-card stock by store, updated as often as suits you.

In return:
- every store result links to your product page, or to your store page for click & collect
- {Store name} is listed as a partner store
- we never resell, add to cart or check out
- we'll follow any limits you set (products, refresh rate, attribution)

Happy to jump on a quick call.

Thanks,
Jamie
TCGTracker · tcgtracker.com.au
