# Setting up TCG Trade: step by step for Jamie

Do these in order. Each step says what to click and which value to send back, if any. **Never paste passwords or secret keys into chat.** Put them into the dashboards named below (Cloudflare, Fly.io, GitHub), and Claude reads them from there.

Rough monthly cost, similar to beforeyoufly.com.au:

| Service | What for | Cost to start |
|---|---|---|
| GoDaddy | `tcgtrade.com.au` domain | about A$20–30 a year |
| Cloudflare | DNS and website hosting (Workers) | Free. Workers Paid (US$5/mo) once traffic grows. |
| Supabase | Database, sign-in, photo storage, realtime messaging | Free. Pro (US$25/mo) once you have real users, for daily backups and no pausing. |
| Fly.io | The 24/7 drop monitor and alert sender, in Sydney | about US$2–5/mo |
| Resend | Alert emails | Free for 3,000 emails/mo (100 a day). Pro (US$20/mo) when alert volume grows. |
| PriceCharting | Graded prices | US$49/mo (you've approved this) |
| Stripe | Premium subscriptions | 1.7% + A$0.30 per domestic card payment, no monthly fee |
| Sentry, healthchecks.io | Error alerts, "is the drop monitor alive" pings | Free |

---

## 1. GitHub repository (do this first)
1. Go to https://github.com/new.
2. Owner: **JamieOnGit**. Repository name: **tcgtrade**. Visibility: **Private**.
3. **Don't** tick "Add a README", .gitignore or licence. The repo must be empty.
4. Click **Create repository**.
5. Give Claude access: open https://github.com/apps/claude/installations/select_target, choose your account, then **Configure**. Under *Repository access*, add **tcgtrade** (or choose *All repositories*), and **Save**.
6. Tell Claude: "repo is ready". Claude pushes all the work there and opens the pull request.

## 2. Domain: tcgtrade.com.au (GoDaddy)
`.com.au` domains need an Australian presence. You'll be asked for an **ABN (or ACN)**, and the name must match or relate to your business. If you don't have an ABN, get a free one at https://www.abr.gov.au first.
1. On godaddy.com.au, search `tcgtrade.com.au` and add it to the cart. **Untick** the extras (Microsoft email, website builder, "Full Domain Protection" isn't needed). Choose 1 or 2 years.
2. At checkout, enter your ABN, entity name and eligibility type ("Company"/"Sole trader"), then pay.
3. **Move DNS to Cloudflare**, so hosting, email records and redirects are all managed in one place, as with beforeyoufly:
   1. In Cloudflare (https://dash.cloudflare.com), click **Add a domain**, enter `tcgtrade.com.au`, choose the **Free** plan, and continue. Cloudflare shows you **two nameservers** (for example `ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`).
   2. In GoDaddy, go to **My Products**, then `tcgtrade.com.au` → **DNS**, then **Nameservers** → **Change nameservers** → **I'll use my own nameservers**. Paste the two Cloudflare nameservers and save.
   3. Wait until Cloudflare emails "tcgtrade.com.au is now active". It's usually under an hour, but can take up to 24.
4. In Cloudflare, under **SSL/TLS**, set the mode to **Full (strict)**. Under **SSL/TLS → Edge Certificates**, turn on **Always Use HTTPS**.
5. (Later, Claude will ask) Add a redirect rule so `www.tcgtrade.com.au` goes to `https://tcgtrade.com.au` (301).

## 3. Cloudflare Workers (hosts the website)
1. In Cloudflare, go to **Workers & Pages** → **Create** → **Import a repository** → connect GitHub → select **tcgtrade**.
2. Settings: *Root directory* `web`, *Build command* `npm ci && npx opennextjs-cloudflare build`, *Deploy command* `npx opennextjs-cloudflare deploy`.
3. Under **Settings → Variables and secrets**, add the values from steps 4–8 below. The names are in the README's environment table. Mark keys as *Secret*.
4. Under **Settings → Domains & Routes → Add → Custom domain**, add `tcgtrade.com.au`.

## 4. Supabase (database, sign-in, storage)
1. Go to https://supabase.com/dashboard → **New project**. Name `tcgtrade`, **Region: Sydney (ap-southeast-2)**, and a strong database password (save it in your password manager).
2. When it's ready, go to **Project Settings → API**. Copy **Project URL** and the **anon public** key into Cloudflare as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Copy the **service_role** key into Cloudflare as the secret `SUPABASE_SERVICE_ROLE_KEY`.
3. **Authentication → URL Configuration**: Site URL `https://tcgtrade.com.au`, Redirect URLs `https://tcgtrade.com.au/auth/callback/`.
4. **Authentication → Emails → SMTP Settings**: enable custom SMTP using Resend (step 6) so sign-in emails come from `tcgtrade.com.au`. Host `smtp.resend.com`, port `465`, user `resend`, password = your Resend API key, sender `TCG Trade <hello@tcgtrade.com.au>`.
5. Tell Claude when the project exists. Claude applies the database migrations with `supabase db push`. You'll be asked to run one command, or to add the database password as a secret.

## 5. Fly.io (24/7 drop monitor, in Sydney)
1. Sign up at https://fly.io and add a card.
2. Install the CLI (`brew install flyctl` on a Mac) and run `fly auth login`.
3. Claude has prepared `workers/fly.toml` (region `syd`). From the repo folder: `cd workers && fly launch --copy-config --no-deploy`, then set the secrets Claude lists (`fly secrets set DATABASE_URL=... RESEND_API_KEY=...`), then `fly deploy`.
4. Why Sydney: retailers like BIG W and Kmart block overseas data-centre traffic. An Australian server gives the drop monitor the best chance of seeing what Australian shoppers see.

## 6. Resend (emails)
1. Sign up at https://resend.com → **Domains** → **Add domain** → `tcgtrade.com.au`, region **Tokyo or Sydney** if offered.
2. Resend shows DNS records (MX, TXT for SPF, TXT for DKIM). If your Cloudflare is linked, click **Auto-configure with Cloudflare**. Otherwise add each record in Cloudflare → DNS, with Proxy **off** (grey cloud).
3. Add a DMARC record in Cloudflare DNS: Type `TXT`, Name `_dmarc`, Content `v=DMARC1; p=quarantine; rua=mailto:dmarc@tcgtrade.com.au`.
4. Create an API key (**Sending access**) and add it as `RESEND_API_KEY` in Fly.io, Cloudflare and Supabase SMTP.

## 7. Stripe (A$12.99/month including GST)
1. Sign up at https://dashboard.stripe.com in Australia and complete business verification (with your ABN).
2. **GST:** prices that "include GST" means you're registered for GST, which is required once turnover reaches A$75k. If you're not registered yet, the price is still A$12.99, but the receipts must not show GST. Tell Claude which applies. In Stripe, go to **Settings → Tax** and add your ABN/GST registration if you have one.
3. **Product catalogue → Add product**: "TCG Trade Premium", recurring **monthly**, **A$12.99**, *Include tax in price*: **Yes**. Copy the **price id** (`price_...`) into Cloudflare as `STRIPE_PRICE_PREMIUM_MONTHLY`.
4. **Settings → Billing → Customer portal**: turn on *cancel subscriptions* (at period end), *update payment method* and *invoice history*.
5. **Developers → Webhooks → Add endpoint**: `https://tcgtrade.com.au/webhooks/stripe/`. Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Copy the **signing secret** into Cloudflare as `STRIPE_WEBHOOK_SECRET`, and the **secret key** as `STRIPE_SECRET_KEY`.
6. **Settings → Billing → Subscriptions and emails**: turn on retries for failed payments. Our side keeps Premium for a 7-day grace period.

## 8. PriceCharting (graded prices)
1. Subscribe at https://www.pricecharting.com/pricecharting-pro?f=api (the US$49/mo plan with API access).
2. In your PriceCharting account, find the **API token** (40 characters). Add it in Fly.io as `PRICECHARTING_TOKEN`.
3. **Important:** PriceCharting's standard terms license the data for *internal use*. To show their prices publicly on TCG Trade, email **brady@vgpc.com** from your account email and ask for written permission for commercial display of derived AUD prices, with attribution. Claude can draft the email. Until the reply, keep the site in "preview" (not announced publicly).

## 9. eBay Partner Network (affiliate, optional, any time)
1. Apply at https://partnernetwork.ebay.com.au (eBay Australia programme). Describe TCG Trade as a trading-card price and marketplace site.
2. Once approved, create a campaign called "TCG Trade site" and copy its **10-digit Campaign ID**.
3. On TCG Trade, go to **Admin → Settings → eBay**, paste the Campaign ID, tick **Affiliate tracking on**, and save. Every card's "Check eBay" link is tracked from then on. There's no code change or redeploy.

## 10. Monitoring
1. **Sentry** (https://sentry.io): create two projects, *tcgtrade-web* (Next.js) and *tcgtrade-workers* (Python). Put the DSNs in Cloudflare (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`) and Fly.io (`SENTRY_DSN`).
2. **healthchecks.io**: create a check "drop-monitor", period 5 min, grace 5 min, and add your email and phone for alerts. Put its ping URL in Fly.io as `HEALTHCHECK_URL`. If the 24/7 monitor ever stops, you're emailed within 10 minutes.
3. Set `ADMIN_ALERT_EMAIL` (Fly.io) to your email. You'll get a message if a retailer adapter fails or returns nothing for several cycles.

## 11. Google Search Console
1. Go to https://search.google.com/search-console → **Add property** → **Domain** → `tcgtrade.com.au`. Copy the TXT record and add it in Cloudflare DNS, then **Verify**.
2. **Sitemaps** → submit `https://tcgtrade.com.au/sitemap.xml`.
3. Bing Webmaster Tools → **Import from Google Search Console**.

## What to send Claude
- "Repo is ready" (step 1)
- "Supabase project created" (step 4). Claude will then tell you exactly which secret to add.
- Whether you're registered for GST (step 7)
- "PriceCharting subscribed" (step 8)
