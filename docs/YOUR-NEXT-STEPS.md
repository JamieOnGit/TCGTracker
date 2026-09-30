# TCGTracker: your next steps

Last updated 30 September 2026 (evening). Work top to bottom. Each step says **where to click**, **what to copy where**, and **what to tell Claude**.

> Claude updates this guide as you go. Updates arrive as small "Docs:" pull requests in the repo: merge them once their checks are green, and the latest version is always on `main`.

> **Never paste passwords or secret keys into the chat.** Put them straight into Cloudflare, Fly.io or Supabase as described below. Claude only needs to hear "done".

**Where things stand:** the site is built and tested on Claude's side. It covers:
- market cap rankings
- the marketplace with messaging and email alerts
- 24/7 retailer monitors
- member in-store sightings
- the release calendar
- web push alerts
- guides

It isn't online yet. That needs the accounts below, which only you can open.

## Progress
| Step | What | Status |
|---|---|---|
| 1 | GitHub repo `JamieOnGit/TCGTracker` | ✅ Done |
| 2 | Domain `tcgtracker.com.au` (VentraIP) on Cloudflare | ✅ Active. Finish the two SSL settings (2.8) if you haven't. |
| 3a | Supabase project `tcgtracker` (Sydney) | ✅ Done |
| 3b | Supabase sign-in URLs | ☐ Confirm Site URL and Redirect URL are set (Authentication → URL Configuration) |
| 3c–3d | Access token, Project ID and DB password saved as GitHub secrets | ✅ Done |
| 3e | Merge pull request #1 | ✅ Merged |
| 3f | Database deployed to Supabase | ✅ Done (tables visible in Table Editor) |
| 3g | Make yourself admin | After Step 4 |
| **4** | **Put the website online (Cloudflare Workers)** | ⏭ **Do next** |
| 5 onwards | Resend, push keys, Fly.io, Stripe, PriceCharting, eBay, images… | ☐ Not started |

---

## Step 1 · GitHub repository ✅ done
The code lives in **https://github.com/JamieOnGit/TCGTracker**. Claude pushed it there and opened a pull request.
- Keep it **Private**: go to *Settings → General → Danger Zone → Change visibility*. The code contains no secrets, but there's no reason to publish it.
- You can delete the unused **tcgtrade** repo you created earlier (and make sure it's gone or private). Go to *Settings → Danger Zone → Delete this repository*.

## Step 2 · Buy the domain and point it at Cloudflare ✅ done (active on Cloudflare 30 Sep 2026)
1. On **https://ventraip.com.au**, search `tcgtracker.com.au` and add it to the cart. Choose 1 or 2 years. **Skip the hosting and email add-ons**: the site is hosted on Cloudflare and email goes through Resend.
2. At checkout, fill in the **.au eligibility** details: your **ABN**, the registrant name exactly as it appears on the ABN, and eligibility type (sole trader or company). No ABN yet? It's free at https://www.abr.gov.au.
3. VentraIP emails you to confirm the registrant details. Click the link, or the .au registry can suspend the domain.
4. At **https://dash.cloudflare.com**, go to **Add a site → Connect a domain**. (Not "Transfer", since the domain stays registered at VentraIP, and not "Buy".)
   - Enter `tcgtracker.com.au` and keep **Quick scan for DNS records**.
   - **Configure AI training & search policies** (what you chose):
     - *I monetize pages that serve ads*: **unticked**. eBay affiliate links aren't display ads.
     - *Search*: **Allow**, so Google and Bing can crawl.
     - *Agent*: **Allow**, so ChatGPT, Perplexity, Claude and others can read and cite your prices.
     - *Training*: **Allow**. It matches the site's open robots.txt; switch to Block later if you prefer.
     - *Enable Bot Preference Sync*: **OFF**. Otherwise it would insert Cloudflare's rules at the top of the site's own robots.txt, which blocks `/account/`, `/admin/` and other private pages.
   - *Import DNS records*: **Automatic**.
   - Plan: **Free**.
   - **Review DNS records:** delete the two VentraIP parking `A` records, for `tcgtracker.com.au` and `www`, both pointing to `103.42.108.46` (done). Cloudflare warns that the domain will have no web address. That's expected: Step 4 adds the right records, and Step 5 adds Resend's. Ignore the "add an MX record" banner too; receiving email comes later.
   - Click **Continue to activation**, then copy the **two nameservers** Cloudflare shows. Yours are `grannbo.ns.cloudflare.com` and `jaime.ns.cloudflare.com`. These are **not** the DNS records from the previous screen.
5. In VIPcontrol, turn **DNSSEC off** for the domain if it's on. Otherwise the domain can stop resolving while nameservers switch. You can turn it back on later from Cloudflare.
6. Log in to **VIPcontrol** (https://vip.ventraip.com.au) → **Domain Names** → click `tcgtracker.com.au` → the **Custom Nameservers** tab (not "DNS Hosting"; editing NS records there does nothing). Choose **custom nameservers**, replace VentraIP's nameservers with the two from Cloudflare, and save. Remove any extra nameserver rows, so only Cloudflare's two are left.
7. In Cloudflare, click **Check nameservers now**, then wait for the email "tcgtracker.com.au is now active". It usually takes under an hour, and .au domains can take up to 24 hours. Until then, Cloudflare's domain list shows **"Invalid nameservers"**. That's normal while the change spreads; it switched to **Active** for you the same day.
8. In Cloudflare, go to **SSL/TLS** → mode **Full (strict)**. Then **SSL/TLS → Edge Certificates** → turn on **Always Use HTTPS**.

## Step 3 · Supabase: database, sign-in and photos (≈20 min)

### 3a · Create the project ✅ done
What you chose, for reference:

| Field | Setting |
|---|---|
| Organization | `tcgtracker` (Free) |
| GitHub (optional) | **Skipped.** Database changes are applied by the "Deploy database" workflow instead. |
| Project name | `tcgtracker` |
| Database password | **Generate a password**, saved in your password manager, never pasted into chat |
| Region | **Oceania (Sydney)** |
| Enable Data API | **Ticked** (the website uses it) |
| Automatically expose new tables | **Ticked**, despite Supabase's advice. The database setup relies on it, and every table has row-level security (a test fails if one doesn't). |
| Enable automatic RLS | Unticked. The database setup enables RLS itself. |

Email templates (the Magic link) can't be edited until custom SMTP is on. That's in Step 5.

### 3b · Sign-in address settings (2 min)
1. In the Supabase dashboard, open the **tcgtracker** project.
2. In the left sidebar, click **Authentication**. Under **Configuration**, click **URL Configuration**.
3. **Site URL**: replace `http://localhost:3000` with `https://tcgtracker.com.au` and click **Save changes**.
4. **Redirect URLs**: click **Add URL**, enter `https://tcgtracker.com.au/**` and click **Save URLs**.
5. Skip the email templates for now. They unlock after custom SMTP in Step 5.

### 3c · Collect three values for GitHub ✅ done
These let GitHub load the database tables into Supabase for you. Don't paste them into the chat.
1. **Project ID:** Supabase → **Project Settings** (gear icon, bottom of the sidebar) → **General** → copy **Project ID**. It's a 20-letter code like `abcdefghijklmnopqrst`.
2. **Access token:** click your avatar (top right) → **Account preferences** → **Access Tokens** (or go to https://supabase.com/dashboard/account/tokens) → **Generate new token**. Name it `github-deploy`, then copy the token. It's shown once only.
   - *Expires in*: 90 days if it's offered (7 days is the default). You'll reuse this token whenever Claude adds database changes.
   - What you chose: resource access **Project** (tcgtracker only), preset **Full access**, with **Infrastructure and delivery** and **Account and organization** set to **None**.
   - If the deploy's "Link the project" step ever fails with *forbidden*, make a new token with **Projects (account-wide) → Read** added and update the secret.
   - When the token expires, the deploy fails with an authorisation error. Generate a new one and update `SUPABASE_ACCESS_TOKEN` in GitHub.
3. **Database password:** the one you saved from 3a. Forgot it? Go to **Project Settings → Database → Reset database password**, generate a new one and save it.

### 3d · Add them to GitHub as secrets ✅ done
1. Open **https://github.com/JamieOnGit/TCGTracker/settings/secrets/actions**. That's the repo → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret** three times, one per value. The names must match exactly, and paste each value with no spaces or quotes around it:

   | Name | Secret |
   |---|---|
   | `SUPABASE_PROJECT_REF` | the Project ID |
   | `SUPABASE_ACCESS_TOKEN` | the access token |
   | `SUPABASE_DB_PASSWORD` | the database password |

### 3e · Merge the code into main ✅ done
The "Deploy database" button only appears once the code is on `main`.
1. Open **https://github.com/JamieOnGit/TCGTracker/pull/1**.
2. Click **Ready for review**, then **Merge pull request** → **Confirm merge**. All checks are green.

### 3f · Load the database ✅ done
1. Open **https://github.com/JamieOnGit/TCGTracker/actions** → click **Deploy database** in the left list.
2. Click **Run workflow** (right side). Keep branch `main`, type `deploy` in the box, then click the green **Run workflow**.
3. Wait for the green tick (about a minute). Click into the run to see each step. "Apply migrations" lists every table set it created.
4. Check in Supabase: **Table Editor** should now show tables like `cards`, `listings`, `sightings` and `release_events`. **Storage** should show the buckets `listing-images`, `message-attachments` and `sighting-photos`.
5. ✉️ Tell Claude: **"database deployed"**. If the run is red, tell Claude and it will read the log.

### 3g · Make yourself admin (after Step 4, once the site is live)
Sign in on the live site once, then in Supabase open **SQL Editor** → **New query**, paste this and click **Run**:
```sql
update public.profile_private set role = 'admin'
where user_id = (select id from auth.users where email = 'jamieha1998@gmail.com');
```
You'll need the keys under **Project Settings → API** (Project URL, anon key, service_role key) in Step 4.

## Step 4 · Cloudflare Workers: put the website online (≈25 min) ⏭ next

### 4a · Upgrade to Workers Paid (US$5/month), required
The site's code bundle is about 3.8 MB compressed, and Cloudflare's free Workers plan allows 3 MB. Workers Paid allows 10 MB and covers every Worker on your account.
1. Cloudflare dashboard → **Workers & Pages** → **Plans** (or **Compute (Workers) → Plans**).
2. Choose **Workers Paid** ($5/month) and add a card. Your domains stay on their Free plans; this is only the Workers plan.

### 4b · Get the Supabase keys (keep them out of the chat)
Supabase → **Project Settings → API Keys**. You need three values:

| Value | Where |
|---|---|
| Project URL | **Project Settings → Data API** (looks like `https://abcdefghijklmnopqrst.supabase.co`) |
| Public key | the **anon** key (on the **Legacy API keys** tab) or the **publishable** key (`sb_publishable_…`). Either works. |
| Secret key | the **service_role** key (Legacy tab) or a **secret** key (`sb_secret_…`). Never share this one. |

### 4c · Connect the repo to Cloudflare
1. Cloudflare → **Workers & Pages → Create application → Import a repository** (or "Continue with GitHub"). Authorise Cloudflare for your GitHub account and choose **JamieOnGit/TCGTracker**.
2. Fill in the form:

   | Field | Value |
   |---|---|
   | Project name | `tcgtracker`. It must match exactly (it's the name in `web/wrangler.jsonc`). |
   | Production branch | `main` |
   | Root directory (under Advanced / Build settings) | `web` |
   | Build command | `npx opennextjs-cloudflare build` |
   | Deploy command | `npx opennextjs-cloudflare deploy` |

3. **Build variables** (on the same screen under **Advanced settings → Build variables**, or later under **Settings → Build → Variables and secrets**). These are baked into the site when it builds:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | `https://tcgtracker.com.au` |
   | `NEXT_PUBLIC_SUPABASE_URL` | the Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the public (anon/publishable) key |

4. Click **Deploy**. The first build takes 3–6 minutes. If it fails, copy the last 30 lines of the build log to Claude.

### 4d · Add the runtime secret
After the first deploy: **Workers & Pages → tcgtracker → Settings → Variables and secrets → Add**:
- Type **Secret**, name `SUPABASE_SERVICE_ROLE_KEY`, value = the secret (service_role / `sb_secret_…`) key. Save.

Add it as a **Secret**, not plain text: plain-text variables set in the dashboard are replaced on every deploy, while secrets are kept. Stripe, push and Sentry values come later (Steps 6, 8 and 11) and go in the same place as Secrets. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` goes in the Build variables.

### 4e · Connect the domain
1. **Workers & Pages → tcgtracker → Settings → Domains & Routes → Add → Custom domain** → `tcgtracker.com.au` → **Add domain**. Cloudflare creates the DNS record and the certificate itself (allow a few minutes).
2. **www → main address:**
   - **DNS → Records → Add record:** Type `AAAA`, Name `www`, IPv6 `100::`, Proxy **on** (orange cloud). This is a placeholder address so Cloudflare can catch `www` traffic.
   - **Rules → Redirect Rules → Create rule:** "Redirect from WWW to root" template, or a custom rule: when hostname equals `www.tcgtracker.com.au`, dynamic redirect to `concat("https://tcgtracker.com.au", http.request.uri.path)`, status **301**, preserve query string.

### 4f · Check it
1. Open **https://tcgtracker.com.au**. You should see the TCGTracker homepage with the market table. It'll be empty until prices are imported (Step 9) and the catalogue is loaded.
2. **https://www.tcgtracker.com.au** should jump to `https://tcgtracker.com.au`.
3. Click **Sign in**, enter your email, and open the link **on the same device**. Supabase's built-in email sender allows only a few emails an hour until Step 5.
4. Then do **3g** (make yourself admin), and open **https://tcgtracker.com.au/admin/**.
5. ✉️ Tell Claude: **"site is live"**. Claude runs the SEO and speed checks against the real domain.

## Step 5 · Resend: alert emails (≈15 min)
1. Go to **https://resend.com** → **Domains → Add domain** → `tcgtracker.com.au`.
2. Click **Auto-configure with Cloudflare**, or add the MX/TXT records in Cloudflare DNS with the proxy **off** (grey cloud).
3. In Cloudflare DNS, add a TXT record with Name `_dmarc` and Content `v=DMARC1; p=quarantine; rua=mailto:dmarc@tcgtracker.com.au`.
4. Go to **API Keys → Create** (Sending access). Keep it for Step 7.
5. In Supabase, go to **Authentication → Emails → SMTP Settings** → enable custom SMTP:
   - Host `smtp.resend.com`, port `465`
   - User `resend`, password = the API key
   - Sender `TCGTracker <hello@tcgtracker.com.au>`
6. Now that SMTP is on, open **Authentication → Emails → Templates → Magic link or OTP** and replace the link in the body with:
   `{{ .SiteURL }}/login/confirm/?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}`
   With this link, a sign-in email opened on a different device (e.g. your phone's email app) still works. Save.

## Step 6 · Push-notification keys (≈2 min) *new*
These let the site send phone and desktop notifications with no app and no SMS cost.
1. On any computer with Node installed, run:
   ```
   npx web-push generate-vapid-keys
   ```
2. It prints a **Public Key** and a **Private Key**.
   - Public Key → Cloudflare as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (Step 4).
   - Private Key → Fly.io as `VAPID_PRIVATE_KEY` (Step 7). **Never share it.**
3. Use `VAPID_SUBJECT` = `mailto:hello@tcgtracker.com.au` (Step 7).
4. Generate them **once**. If you change them later, every member has to turn push on again.

## Step 7 · Fly.io: the 24/7 drop monitor and alert sender, in Sydney (≈20 min)
1. Sign up at **https://fly.io** and add a card. This costs about US$2–5 a month.
2. Install the CLI (`brew install flyctl` on a Mac) and run `fly auth login`.
3. From the repo folder:
   ```
   cd workers
   fly launch --copy-config --no-deploy
   fly secrets set \
     DATABASE_URL="(Supabase → Project Settings → Database → Connection string → URI, 'Session pooler', with your DB password)" \
     SUPABASE_URL="(Supabase Project URL)" \
     EMAIL_PROVIDER="resend" RESEND_API_KEY="(Step 5)" \
     VAPID_PRIVATE_KEY="(Step 6)" VAPID_SUBJECT="mailto:hello@tcgtracker.com.au" \
     ADMIN_ALERT_EMAIL="jamieha1998@gmail.com" \
     HEALTHCHECK_URL="(Step 11)" SENTRY_DSN="(Step 11)"
   fly deploy
   ```
4. ✉️ Tell Claude: **"workers deployed"**. Claude checks the logs and tests BIG W and Kmart from the Sydney server. They block overseas data centres and may allow an Australian one, but may still block it.

## Step 8 · Stripe: Premium at A$12.99/month incl. GST (≈30 min)
1. Sign up at **https://dashboard.stripe.com** (Australia) and verify your business with your ABN.
2. **GST:** if you're registered, add it under **Settings → Tax**. If you're not, the price is still A$12.99, but receipts must not say "incl. GST". ✉️ Tell Claude which applies.
3. Go to **Product catalogue → Add product**:
   - Name "TCGTracker Premium", **Recurring monthly**, **A$12.99**, *Include tax in price* **Yes**.
   - Optional: a **7-day free trial**. Most Australian alert groups offer 3–7 days.
   - Copy the `price_…` id → Cloudflare `STRIPE_PRICE_PREMIUM_MONTHLY`.
4. Under **Settings → Billing → Customer portal**, turn on cancel at period end, update card, and invoices.
5. Under **Developers → Webhooks → Add endpoint**:
   - URL `https://tcgtracker.com.au/webhooks/stripe/`
   - Events `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`
   - Copy the signing secret → `STRIPE_WEBHOOK_SECRET`, and the secret key → `STRIPE_SECRET_KEY`.

## Step 9 · PriceCharting: graded prices (≈10 min)
1. Subscribe to the US$49/mo plan with API access at https://www.pricecharting.com/pricecharting-pro?f=api.
2. Copy your 40-character **API token** → `fly secrets set PRICECHARTING_TOKEN=...`.
3. **Important:** email **brady@vgpc.com** from your account email asking for written permission to *display derived AUD prices publicly, with attribution*. Claude can draft it. Until they say yes, keep the site unannounced.

## Step 9b · eBay developer keys, for the eBay deal finder (≈15 min) *new*
This powers **/deals/**: graded cards listed on eBay Australia well under market value, and auctions ending soon. It uses eBay's official API, so it's allowed and free.
1. Sign up at **https://developer.ebay.com** (use your eBay account) and wait for the approval email. It's usually quick.
2. Go to **Hi, <name> → Application Keysets** → create a **Production** keyset named "TCGTracker".
3. Copy the **App ID (Client ID)** and **Cert ID (Client Secret)**, then run:
   `fly secrets set EBAY_CLIENT_ID=... EBAY_CLIENT_SECRET=...`
4. eBay may ask you to confirm how you handle "marketplace account deletion" notifications. Choose the **exemption** ("I do not persist eBay user data"). We only store listing details, never eBay user accounts.
5. On the site, go to **Admin → Settings → eBay deals** and turn on **Find eBay deals**. The defaults are ≥20% under value, and auctions ending within 2 hours.
6. Deal links earn commission once your eBay Partner Network campaign ID is set (Step 13 / Admin → Settings → eBay).

## Step 9c · Card images: decide, then Scrydex (≈10 min) *new*
Until this is done, cards show a styled placeholder. Neither The Pokémon Company nor Bandai licenses card images to other sites. Most TCG sites show scans anyway, with a "not affiliated" notice (see `docs/research/03-catalogue-sources.md` §4).
1. Decide, ideally with your lawyer in Step 14, whether to show card scans.
2. If yes: subscribe to **Scrydex** (https://scrydex.com, from US$29/mo for 5,000 requests a month; about US$99/mo for the next tier if you outgrow it). It covers Pokémon EN + JP and One Piece EN, and its terms allow showing and self-hosting its images.
3. Run `fly secrets set SCRYDEX_API_KEY=... SCRYDEX_TEAM_ID=...` and tell Claude **"Scrydex ready"**. Claude then builds the image import: copied once to our own storage as WebP, with an admin on/off switch per game and a takedown process.
4. One Piece Japanese has no licensable source. It keeps the placeholder plus members' own photos.
5. Sealed product images: use your affiliate feeds once approved (Step 13). They include images you're allowed to use.

## Step 10 · Discord Premium alerts channel (≈10 min, optional at launch)
1. Create a Discord server "TCGTracker" with a private channel **#premium-drops**.
2. Go to **Channel settings → Integrations → Webhooks → New Webhook** → **Copy URL** → `fly secrets set DISCORD_DROPS_WEBHOOK_URL=...`.
3. On the site, go to **Admin → Settings → Features** and turn on Discord alerts.
4. Linking a member's Discord account to their Premium membership **isn't automated yet**. For now, give the Premium role by hand, or launch with push and email only and add Discord later.

## Step 11 · Monitoring (≈10 min)
1. **Sentry** (https://sentry.io): create the projects *tcgtracker-web* and *tcgtracker-workers*. The DSNs go into Cloudflare and Fly.io.
2. **healthchecks.io**: create the check "drop-monitor" with a 5 min period and 5 min grace, and add your phone and email. The ping URL → Fly `HEALTHCHECK_URL`. If the 24/7 monitor ever stops, you're told within 10 minutes.

## Step 12 · Before you announce: set up the community side (≈1–2 hours) *new*
1. **Launch settings.** Go to **Admin → Settings → Member sightings**:
   - Set **Confirmations needed = 1** while the community is small. Raise it to 2 once you have about 50 active Premium members.
   - Keep **Premium reward every = 10** sightings and **30 days**.
2. **Recruit 5–10 founding scouts** from friends and TCG contacts in different states, and ideally 2 moderators.
   - Moderators: in the Supabase SQL Editor, run `update public.profile_private set role = 'moderator' where user_id = (select id from auth.users where email = 'THEIR EMAIL');`
   - Moderators confirm or reject reports in **Admin → Sightings**. Staff reports alert instantly.
3. **Fill the release calendar** in **Admin → Releases** with the next 3–6 months of Pokémon and One Piece releases. Use official sources and tick the right confidence:
   - Pokémon: https://www.pokemon.com/au/pokemon-tcg and the Pokémon press site
   - One Piece: https://en.onepiece-cardgame.com/products/ (the Oceania region shares the global date)
   - Retailer pre-order pages count as "Retailer listing". Anything else is "Unconfirmed".
4. **Check RRPs** in **Admin → Drops → RRP table**, so alerts show "At RRP" or "Above RRP (+40%)" correctly.
5. **Test the whole loop yourself:**
   1. Turn on push at **Account → Drop alerts** (on iPhone, first use Share → *Add to Home Screen*, then open the site from that icon).
   2. Report a test sighting and confirm it with a moderator account. The alert should arrive on your phone.
   3. Reject it afterwards in **Admin → Sightings**.

## Step 13 · Official data deals (ongoing, in your own name) *new*
These give reliable stock and price data **with permission**, which beats any workaround.
1. **BIG W:** apply to its affiliate programme on **Impact** (impact.com). Ask whether a product catalogue with stock availability is available.
2. **Commission Factory** (commissionfactory.com, Australian): apply, then check which of Kmart, Target, JB Hi-Fi and EB Games have product feeds.
3. **Amazon Associates AU** (affiliate-program.amazon.com.au): once you have qualifying sales, the Creators API gives availability.
4. **Email the retailers' online teams.** Claude can draft the email. Ask whether a low-rate, clearly identified stock check is acceptable to them, pitching it as sending customers to them at RRP. A "yes" lets Claude switch that retailer's monitor on.
5. ✉️ Tell Claude about any feed access you get and it'll be wired in.

## Step 14 · Legal (before launch)
1. Have an Australian lawyer review the **Terms**, **Privacy Policy** and **Marketplace rules**. They're drafts and marked noindex. Ask them to cover:
   - member-submitted sightings and photos (the licence to display them, a no-photos-of-people rule)
   - the scout rewards (free Premium isn't a prize draw, but check the wording)
   - Spam Act compliance for alerts, which is already built in: consent and unsubscribe links
2. **Giveaways:** if you ever want PokéMafia-style giveaways, chance-based giveaways are trade-promotion lotteries. The ACT and SA need permits above certain prize values, so check with your lawyer first. Scout rewards are earned, so they're fine.
3. Keep the "not affiliated with Nintendo, The Pokémon Company, Bandai or any retailer" footer.

## Step 15 · Google and Bing (≈15 min, after launch)
1. Go to **https://search.google.com/search-console** → **Add property** → **Domain** → `tcgtracker.com.au`. Add the TXT record in Cloudflare → **Verify**.
2. Under **Sitemaps**, submit `https://tcgtracker.com.au/sitemap.xml`.
3. In **Bing Webmaster Tools**, choose **Import from Google Search Console**.
4. Follow the 90-day content calendar in `docs/SEO-STRATEGY-AU.md`. One guide or release write-up a week is enough to build momentum.

---

## What to send Claude, in order
1. "database deployed" (Step 3f)
2. "workers deployed" (Step 7)
3. Whether you're registered for GST (Step 8)
4. "PriceCharting subscribed" and, later, their reply about display rights (Step 9)
5. Any retailer feed or permission you get (Step 13)
6. Whether to show card scans, and "Scrydex ready" if yes (see the card images note in the pull request)

## Monthly running costs (similar to beforeyoufly.com.au)
| Service | Cost |
|---|---|
| Domain (VentraIP) | ~A$20–30/yr |
| Cloudflare Workers Paid (site hosting) | US$5/mo (needed from day one: the site is over the free plan's 3 MB limit) |
| Supabase | Free → US$25/mo once there are real users (daily backups) |
| Fly.io (Sydney) | ~US$2–5/mo |
| Resend | Free (3,000 emails/mo) → US$20/mo |
| PriceCharting | US$49/mo |
| Web push | Free |
| Stripe | 1.7% + A$0.30 per domestic card payment |
| Sentry, healthchecks.io | Free |
