# TCGTracker: your next steps

Last updated **1 October 2026**. Work top to bottom. Each step says **which website or app to open**, **where to click**, **what to copy where**, and **what to tell Claude**. Menu names were checked against each service's current help pages on 1 Oct 2026. If a screen looks different, send Claude a screenshot (cover any keys first).

> Claude updates this guide as you go. Updates arrive as small pull requests in the repo. Merge them once their checks are green, and the latest version is always on `main`.

> **Never paste passwords or secret keys into the chat.** Put them straight into the place this guide names (Cloudflare, Fly.io, Supabase or GitHub). Claude only needs to hear "done".

## Where things stand (1 Oct 2026)
✅ **Live at https://tcgtracker.com.au.** Sign-in works from any device or email app, and sign-in emails come from `hello@tcgtracker.com.au` through Resend.

The website is complete, but these parts are switched off until their services are connected:

| Part of the site | Needs | Step |
|---|---|---|
| Market prices, price history, card pages, market cap | JustTCG | 9 |
| 24/7 store monitor, drop alerts, email alerts, listing expiry | Fly.io (background workers) | 7 |
| Phone and desktop push alerts | Push keys | 6 |
| Premium A$12.99/month | Stripe | 8 |
| eBay deal finder | eBay developer keys | 9b |
| Card and sealed product images | Free sources (TCGdex, pokemontcg.io, Bandai, TCGplayer by JustTCG id); Scrydex optional | 9c |
| Discord Premium alerts | Discord webhook | 10 |
| Outage alerts to your phone | Sentry and healthchecks.io | 11 |

**Do next, in order:** 6 (push keys, 5 min) → 7 (Fly.io, 30 min) → 9 (JustTCG) → 8 (Stripe) → the rest.

## Progress
| Step | What | Status |
|---|---|---|
| 1 | GitHub repo `JamieOnGit/TCGTracker` | ✅ Done |
| 2 | Domain `tcgtracker.com.au` (VentraIP) on Cloudflare | ✅ Done. Check 2.8 (SSL **Full (strict)** + **Always Use HTTPS**) is on. |
| 3a–3f | Supabase project, sign-in URLs, GitHub secrets, database deployed | ✅ Done |
| 3f-2 | Deploy database again for the Kmart/Target update (PR #9) | ✅ Done (2 Oct 2026) |
| 3g | Make yourself admin | ✅ Done |
| 4 | Website on Cloudflare Workers + domain + www redirect | ✅ Done |
| 5 | Resend email + Supabase SMTP + rate limit | ✅ Done (sign-in works) |
| **5b** | **Sign in on the computer by opening the email on your phone** | ⏭ **Do now**: after the PR is merged, **Actions → Deploy database**, then test (3 min) |
| 6 | Push-notification keys | ✅ Done |
| 7 | Fly.io workers in Sydney (monitor, alerts, emails) | ✅ Done (2 Oct 2026). Stores are being read; `fly logs` shows `discovery: seen=…` |
| 7e | Check the 44-store monitor from Sydney (incl. Kmart and Target) | ⏭ Next, after 5b |
| **7f** | **Live stock section (`/stock/`) and the 5-minute free delay** | ⏭ After that PR is merged: **Actions → Deploy database** (adds the stock summary and switches the free delay from 24 hours to 5 minutes), then open https://tcgtracker.com.au/stock/ |
| 8 | Stripe (Premium) | ☐ |
| **9** | **JustTCG (card prices and history)** | ⏭ After the JustTCG pull request is merged (10 min) |
| 9b | eBay developer keys (deal finder) | ☐ |
| 9c | Product images (free sources, 100% aim) | ⏭ After the image-coverage PR is merged: **Actions → Deploy database**, then run prices and images (5 min) |
| **9d** | **Every card in every set** | ⏭ After the full-catalogue PR is merged: **Actions → Deploy database**, refresh all sets, run prices (5 min). Move Supabase to Pro before launch. |
| **9e** | **Drop alerts: interests only, instant, one-tap checkout** | ⏭ After the drop-alerts PR is merged: **Actions → Deploy database**, `fly deploy` the workers, then set your own interests (5 min) |
| **9f** | **Workers stay within 512 MB** | ⏭ After the worker-memory PR is merged: `fly deploy` the workers (2 min). No database step. |
| **9g** | **Australian release calendar (automatic) on the Drops page** | ⏭ After the release-calendar PR is merged: **Actions → Deploy database**, `fly deploy` the workers (3 min) |
| **9h** | **Site scan fixes (guides, live connections, sitemap speed)** | ⏭ After the site-scan PR is merged: **Actions → Deploy database** (1 min). Optional later: page cache (below) |
| 10 | Discord Premium channel | ☐ Optional at launch |
| 11 | Monitoring (Sentry, healthchecks.io) | ☐ |
| 12 | Community set-up before announcing | ☐ |
| 13 | Store outreach and affiliate programs | ☐ Ongoing |
| 14 | Legal review | ☐ Before announcing |
| 15 | Google and Bing | ☐ After launch |

## Where every key goes (cheat sheet)
Keep this table handy. "Cloudflare build variable" and "Cloudflare secret" are two different places, explained in Step 4.

| Name | Where it goes | Comes from |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cloudflare build variable | ✅ done (Step 4) |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloudflare secret | ✅ done (Step 4) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Cloudflare build variable | Step 6 |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Fly.io secret | Step 6 |
| `DATABASE_URL`, `SUPABASE_URL`, `RESEND_API_KEY`, `ADMIN_ALERT_EMAIL` | Fly.io secret | Step 7 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PREMIUM_MONTHLY` | Cloudflare secret | Step 8 |
| `JUSTTCG_API_KEY` | Fly.io secret | Step 9 |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | Fly.io secret | Step 9b |
| `SCRYDEX_API_KEY`, `SCRYDEX_TEAM_ID` | Fly.io secret | Step 9c |
| `DISCORD_DROPS_WEBHOOK_URL` | Fly.io secret | Step 10 |
| `SENTRY_DSN` (workers) | Fly.io secret | Step 11 |
| `NEXT_PUBLIC_SENTRY_DSN` (website) | Cloudflare build variable | Step 11 |
| `HEALTHCHECK_URL` | Fly.io secret | Step 11 |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` | GitHub secret | ✅ done (Step 3) |

**Adding a Cloudflare secret:** **Workers & Pages → tcgtracker → Settings → Variables and Secrets → + Add** → Type **Secret** → name → value → **Deploy**.
**Adding a Cloudflare build variable:** **Workers & Pages → tcgtracker → Settings → Build → Variables and secrets → + Add** → name → value → **Save**. Then go to **Deployments** and click **Retry build** on the latest one (or merge any PR). Build variables only take effect on the next build.

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

## Step 3 · Supabase: database, sign-in and photos ✅ done

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

### 3b · Sign-in address settings ✅ done
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

### 3f-2 · Load the stock-monitor update (≈1 min)
Run **Deploy database** once more if you haven't since PR #3: **https://github.com/JamieOnGit/TCGTracker/actions** → **Deploy database** → **Run workflow** → branch `main`, type `deploy` → **Run workflow**. In Supabase **Table Editor**, `retailers` should list 67 stores.

Rule from now on: **whenever a merged PR changes `supabase/migrations/`, run Deploy database again.** Claude reminds you each time.

### 3g · Make yourself admin ✅ done
**App: Supabase** (https://supabase.com/dashboard → project **tcgtracker**). You must have signed in on the live site at least once (done ✅).
1. In the left sidebar, click **SQL Editor** (the `>_` icon).
2. Click **+ New query** (or the **+** next to the tabs). A blank editor opens.
3. Paste exactly:
   ```sql
   update public.profile_private set role = 'admin'
   where user_id = (select id from auth.users where email = 'jamieha1998@gmail.com');
   ```
   If you signed in on the site with a different email, put that one in instead.
4. Click **Run** (bottom right), or press **Ctrl+Enter** (Windows) / **⌘+Enter** (Mac).
5. It should say **Success. 1 rows affected** (or "UPDATE 1"). **0 rows** means that email hasn't signed in yet: sign in on the site first, then run it again.
6. On the site, refresh the page, then open **https://tcgtracker.com.au/admin/**. You should see the admin dashboard (Listings, Reports, Users, Drops, Sightings, Releases, Settings…).
7. ✉️ Tell Claude: **"I'm admin"**.

Your Supabase values (Project URL, publishable key, secret key) are found as described in 4b.

## Step 4 · Cloudflare Workers: put the website online ✅ done

*Checked against Cloudflare's and Supabase's current docs on 1 Oct 2026.* Cloudflare's left-hand menu moves around from time to time. If a menu name below doesn't match what you see, use the **links** given (they jump straight to the right page), or type the page name into the dashboard's search box (**Ctrl+K** on Windows, **⌘K** on Mac).

### 4a · Turn on Workers Paid (US$5/month), strongly recommended ✅ done
**What changed:** Cloudflare removed the code-size limit on 4 Sep 2026, so the free plan *can* now host the site. Stay on Paid anyway:
- **CPU time:** the free plan allows only **10 ms of CPU per page view**. Our pages are built on the server, and many take longer than that. On Free, visitors would randomly get "Error 1102: Worker exceeded resource limits". Paid allows 30 seconds.
- **Daily cap:** Free stops serving the site after **100,000 requests a day**. Paid includes 10 million a month.

1. Open **https://dash.cloudflare.com/?to=/:account/workers/plans**. If that doesn't open the plans page: **Workers & Pages** in the left menu (sometimes inside **Compute** or **Compute & AI**), then **Plans** or **Upgrade**.
2. Pick **Workers Paid** → **Purchase/Upgrade** → add a card. This is only the Workers plan; your domain stays on the Free plan.

### 4b · Get the Supabase values (keep them out of the chat) ✅ done
Supabase now has two kinds of keys. The old `anon` / `service_role` keys are being switched off by the end of 2026, so **use the new ones**.

| What | Where in Supabase | Looks like |
|---|---|---|
| **Project URL** | Click **Connect** at the top of the project page. It's also under **Project Settings → Data API**. | `https://abcdefghijklmnopqrst.supabase.co` |
| **Publishable key** (public, safe in the site) | **Project Settings → API Keys** → section **Publishable key** | `sb_publishable_…` |
| **Secret key** (private, never share) | **Project Settings → API Keys** → section **Secret keys** → copy the `default` key (click the eye/copy icon), or **+ New secret key** if there isn't one | `sb_secret_…` |

If the API Keys page only shows "Legacy API keys", click the **API Keys** tab next to it, or the **Create new API keys** button.

### 4c · Create the Worker from GitHub ✅ done (build green)
From now on, every merge to `main` rebuilds and redeploys the site automatically. Check **tcgtracker → Deployments** if something looks off.

If you left **Enable Preview builds** on, turn it off under **tcgtracker → Settings → Build**. Otherwise every pull request shows a Cloudflare preview check (harmless, but noisy).

The original setup instructions are below for reference.
1. Open **https://dash.cloudflare.com/?to=/:account/workers-and-pages/create** (or **Workers & Pages → Create application**).
2. Next to **Import a repository**, click **Get started**. Choose your GitHub account. The first time, click **Connect GitHub**/**Add account**, allow the Cloudflare app on **JamieOnGit/TCGTracker**, then come back.
3. Select **TCGTracker** from the list, then fill in the setup page. Grey text in a box is only a placeholder: click in and type the value yourself.

   | Field | Value |
   |---|---|
   | **Project name** (Worker name) | `tcgtracker`. It must be exactly this: Cloudflare fails the build if it doesn't match the name in `web/wrangler.jsonc`. |
   | **Build command** | `npx opennextjs-cloudflare build` |
   | **Deploy command** | `npx opennextjs-cloudflare deploy` |
   | **Preview command** (may be called "Non-production branch deploy command") | `npx opennextjs-cloudflare upload` |
   | **Enable Preview builds** | turn **off** for now (previews would use the live database) |
   | **Advanced settings → Path** (called **Root directory** on the settings page later) | `web` |
   | **API token** (if shown) | leave as **Create new token**; Cloudflare makes it for you |

4. Still under **Advanced settings → Build variables**, click **Add variable** three times. These are read while the site is built:

   | Variable name | Value |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | `https://tcgtracker.com.au` |
   | `NEXT_PUBLIC_SUPABASE_URL` | the Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **publishable** key (`sb_publishable_…`). The name still says "ANON"; that's expected, it's what the code reads. |

5. Click **Deploy** (or **Save and Deploy**). The first build takes 3–6 minutes. Watch it under the Worker → **Deployments** (or **Builds**) tab. If it goes red, open the build, scroll to the bottom, and paste the last 30 lines to Claude. Those lines never contain your secret key.

**If you already created the Worker** in an earlier attempt, check it instead under **Workers & Pages → tcgtracker → Settings → Build**. The fields there are **Git repository**, **Git branch** (`main`), **Build command**, **Deploy command**, **Root directory** (`web`) and **Build variables and secrets**. Then click **Retry build** on the latest deployment.

### 4d · Add the secret key to the running site ✅ done
1. **Workers & Pages → tcgtracker → Settings**, then scroll to **Variables and Secrets** → **+ Add**.
2. **Type:** `Secret`. **Variable name:** `SUPABASE_SERVICE_ROLE_KEY`. **Value:** the **secret** key (`sb_secret_…`).
3. Click **Deploy** (bottom of the panel) to save it.

Always choose type **Secret**. Plain-text variables added in the dashboard are wiped on the next deploy (the site's config file owns those); secrets are kept. Later steps add more secrets here (Stripe, push and Sentry in Steps 6, 8 and 11). Anything starting with `NEXT_PUBLIC_` goes in **Settings → Build → Build variables and secrets** instead, followed by a new build.

### 4e · Connect the domain ✅ done
1. **Workers & Pages → tcgtracker → Settings → Domains & Routes → + Add → Custom domain**. Type `tcgtracker.com.au` and click **Add domain** (or **Add Custom Domain**). Cloudflare creates the DNS record and the security certificate itself. It shows "Initializing", then "Active" within about 5–15 minutes.
   - If it says a DNS record already exists: open **DNS → Records** for tcgtracker.com.au, delete any `A`, `AAAA` or `CNAME` record named `tcgtracker.com.au` / `@` (but **not** MX or TXT records), then try again.
2. **Send www to the main address:**
   1. **DNS → Records → + Add record**: Type `AAAA`, Name `www`, IPv6 address `100::`, Proxy status **Proxied** (orange cloud) → **Save**. This placeholder lets Cloudflare catch `www` visits.
   2. Open the domain's **Rules → Overview** → **+ Create rule** → **Redirect Rule**.
   3. If a template called **Redirect from WWW to root** (or similar) is offered, choose it and **Deploy**. Otherwise fill in:
      - **Rule name:** `www to root`
      - **If incoming requests match…** → **Wildcard pattern**. **Request URL:** `https://www.tcgtracker.com.au/*`
      - **Then… Target URL:** `https://tcgtracker.com.au/${1}` · **Status code:** `301` · tick **Preserve query string**
      - Click **Deploy**.

### 4f · Check it ✅ done
Before signing in, make sure **3b** is done. In Supabase → **Authentication → URL Configuration**, set **Site URL** to `https://tcgtracker.com.au` and add `https://tcgtracker.com.au/**` under **Redirect URLs**. Without this, the sign-in email link sends you to the wrong place.

1. Open **https://tcgtracker.com.au**. You should see the TCGTracker homepage with the market table. It stays mostly empty until prices are imported (Step 9) and the catalogue is loaded.
2. **https://www.tcgtracker.com.au** should jump to `https://tcgtracker.com.au`.
3. Click **Sign in**, enter your email, and open the link **on the same device**. Supabase's built-in email sender allows only a few emails an hour until Step 5.
4. Then do **3g** (make yourself admin) and open **https://tcgtracker.com.au/admin/**.
5. ✉️ Tell Claude: **"site is live"**. Claude runs the SEO and speed checks against the real domain.

**Stuck on a screen?** Send Claude a screenshot (cover any key values first) and say which sub-step you're on.

## Step 5 · Resend: sign-in and alert emails ✅ done (1 Oct 2026)
What you set up, for reference:
1. **Resend → Domains → Add domain:** `tcgtracker.com.au`, region **Tokyo (ap-northeast-1)** (the nearest to Australia), Custom Return-Path `send`, tracking subdomain left empty (click and open tracking stay off, so sign-in links aren't rewritten).
2. **Auto configure** (Cloudflare sign-in) added these to Cloudflare DNS, all **DNS only (grey cloud)**:
   - TXT `resend._domainkey`
   - CNAME `rsend` → `rsend-apne1.forge.rmta.net`
   - CNAME `send` → `send.forge.rmta.net`
3. **DMARC:** TXT `_dmarc` = `v=DMARC1; p=none;`. Check it exists in Cloudflare DNS, and add it if not. Once emails have been delivering well for a month, Claude can help you tighten it to `p=quarantine`.
4. **Resend → API keys:** `tcgtracker-supabase` (Sending access). Step 7 creates a second key for the workers.
5. **Supabase → Authentication → Emails → SMTP Settings**, custom SMTP **on**:
   - sender `hello@tcgtracker.com.au` / `TCGTracker`
   - host `smtp.resend.com`, port `465`, username `resend`, password = the key
   - minimum interval per user `60` seconds
6. **Supabase → Authentication → Rate Limits:** emails per hour `100`. Supabase's built-in sender allows only 2 emails an hour for the whole site, which caused the "too many attempts" message.
7. Leave **Enable Receiving** off in Resend. Cloudflare's "Email cannot reach @tcgtracker.com.au" notice is about *receiving* email and can be ignored.

## Step 5b · Sign in on your computer by opening the email on your phone (≈3 min) ⏭ do now
**How sign-in works now:**
1. On the computer, enter your email and click **Email me a sign-in link**. The page shows **Check your email** and waits. Keep it open.
2. Open the email on your phone and tap the link. The phone signs in and asks **Sign in your other device too?** It names the computer's browser, for example *Chrome on Mac*.
3. Tap **Yes**. Within about 3 seconds the computer signs itself in and goes to your account page.

If you open the link on the computer itself, it simply signs the computer in.

**What you need to do (once):** after the pull request that adds this is merged, run GitHub → **Actions → Deploy database → Run workflow**, typing `deploy` to confirm. It adds the small table that links the two devices. Until then, the link signs in only the device that opens it.

**Test it:** in an incognito window on your computer, go to https://tcgtracker.com.au/login/ and request a link. Tap it on your phone, then tap **Yes**. Watch the computer sign in.

✉️ Tell Claude **"cross-device sign-in works"**, or what you saw if it didn't.

**Optional: a code in the email as well.** If you'd also like the email to show a 6-digit code (handy when a phone can't open links), paste this template into Supabase:
1. Go to Supabase → **Authentication → Emails → Templates**.
2. Open **Magic link** and set the **Subject** to `Your TCGTracker sign-in code`. In **Message body**, select everything, delete it, paste the block below and **Save changes**.
3. Do the same for **Confirm sign up**.

The sign-in page has a small **Got a code in the email instead?** box for typing it.
```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 16px">Sign in to TCGTracker</h2>
  <p style="margin:0 0 8px">Your sign-in code:</p>
  <p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:Menlo,Consolas,monospace">{{ .Token }}</p>
  <p style="margin:0 0 20px">Type it on the page where you asked to sign in. Or, to sign in on the device you're reading this on, tap the button:</p>
  <p style="margin:0 0 24px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Sign in on this device</a></p>
  <p style="margin:0;color:#666;font-size:13px">The code and button work once and expire in an hour. If you didn't ask to sign in, you can ignore this email.</p>
</div>
```
Keep `{{ .Token }}` and `{{ .ConfirmationURL }}` exactly as written. Supabase fills in the real code and link.

## Step 6 · Push-notification keys (≈5 min) ✅ done
These let the site send phone and desktop notifications for drops, with no app and no SMS cost. You create one key pair, once.

**App: your computer's terminal.** You need Node.js. Check by typing `node -v` in Terminal (Mac) or PowerShell (Windows). If it says "not found", install the **LTS** version from https://nodejs.org first.

1. In the terminal, run:
   ```
   npx web-push generate-vapid-keys
   ```
   If it asks "Need to install the following packages… Ok to proceed?", type `y` and press Enter.
2. It prints two lines:
   - **Public Key:** about 87 characters, starting with `B`.
   - **Private Key:** about 43 characters. **Never share it.**
   Save both in your password manager now.
3. **Public Key → Cloudflare build variable.** In Cloudflare go to **Workers & Pages → tcgtracker → Settings → Build → Variables and secrets → + Add**. Name `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, value = the Public Key, then **Save**. Then **Deployments → Retry build** on the latest deployment, so the site picks it up.
4. **Private Key:** keep it for Step 7. It goes to Fly.io as `VAPID_PRIVATE_KEY`, together with `VAPID_SUBJECT` = `mailto:hello@tcgtracker.com.au`.
5. Don't generate new keys later. If the keys change, every member who turned on push has to turn it on again.

Push alerts start working once Step 7 is done, because the Fly.io workers send them.

## Step 7 · Fly.io: the 24/7 workers in Sydney (≈30 min)
The **workers** are the always-on background program. They:
- check 44 Australian stores for new listings, pre-orders, restocks and price drops, around the clock (including **Kmart** and **Target** online)
- send drop alerts by email, push and Discord (Premium instantly, Free 24 hours later)
- send marketplace email notifications
- import prices every 4 hours, once JustTCG is set up
- expire old listings and member sightings

They run on one small server in **Sydney**, at about **US$5 a month**.

### 7a · Account and command-line tool
**App: https://fly.io, then your terminal.**
1. Sign up at **https://fly.io/app/sign-up**. Use your email or GitHub.
2. Go to **Billing** and **add a credit card**. Without a card, Fly's free trial stops machines after 5 minutes, so an always-on worker needs one. Adding a card ends the trial; that's expected.
3. Install the `fly` command:
   - **Mac:** `brew install flyctl`. No Homebrew? Use `curl -L https://fly.io/install.sh | sh` and follow the message it prints about adding it to your PATH, then open a new Terminal window.
   - **Windows (PowerShell):** `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`. If `pwsh` isn't found, use `powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"`. Then open a new PowerShell window.
4. Run `fly auth login`. A browser tab opens; log in. The terminal then says you're logged in.

### 7b · Get the code onto your computer (once)
**App: terminal.** You need **git** (Mac: run `git --version`, and macOS offers to install it; Windows: https://git-scm.com/download/win).
```
git clone https://github.com/JamieOnGit/TCGTracker.git
cd TCGTracker/workers
```
Because the repo is private, git asks you to sign in to GitHub. The easiest way is to install **GitHub Desktop** (https://desktop.github.com), sign in, then **File → Clone repository → JamieOnGit/TCGTracker**. Then, in the terminal, `cd` into the folder it made, and into `workers`.

Later, to get Claude's newest code before redeploying: `git pull` (or **Fetch origin → Pull** in GitHub Desktop).

### 7c · Collect the values (keep them out of the chat)
1. **`DATABASE_URL`** (**App: Supabase**):
   1. Open the **tcgtracker** project and click the **Connect** button at the top of the page.
   2. Stay on the **Direct** tab and set **Method** to **Session pooler**. Don't use "Direct connection", which only works over IPv6, or "Transaction pooler".
   3. Copy it. It looks like `postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-…-ap-southeast-2.pooler.supabase.com:5432/postgres`. Copy the host exactly as shown; don't retype it.
   4. Replace `[YOUR-PASSWORD]` (including the brackets) with your database password from Step 3a. If the password contains `! @ # ? & / :` or spaces, reset it first to one with only letters and numbers (**Database → Settings → Reset database password**), and update the GitHub secret `SUPABASE_DB_PASSWORD` to match.
2. **`SUPABASE_URL`**: the Project URL from 4b, like `https://abcdefghijklmnopqrst.supabase.co`.
3. **`RESEND_API_KEY`** (**App: Resend**): go to **API keys → + Create API key**. Name `tcgtracker-workers`, permission **Sending access**, domain `tcgtracker.com.au` → **Add**. Copy the `re_…` key. It's shown only once. Use a separate key from the Supabase one, so you can replace either without breaking the other.
4. **`VAPID_PRIVATE_KEY`**: from Step 6.

### 7d · Create the app and deploy
**App: terminal, inside the `workers` folder.**
1. Create the app from the ready-made settings (Sydney, 1 machine):
   ```
   fly launch --copy-config --no-deploy --name tcgtracker-workers --region syd --ha=false
   ```
   If it asks "Do you want to tweak these settings before proceeding?", answer **N**. If the name is taken, try `tcgtracker-workers-au` and tell Claude the name you used.
2. Store the secrets. Paste this as **one** command, with your values between the quotes. Mac: lines end with `\`. Windows PowerShell: put it all on one line, without the `\`.
   ```
   fly secrets set --stage \
     DATABASE_URL='postgresql://postgres.xxxx:PASSWORD@aws-…-ap-southeast-2.pooler.supabase.com:5432/postgres' \
     SUPABASE_URL='https://xxxx.supabase.co' \
     RESEND_API_KEY='re_…' \
     VAPID_PRIVATE_KEY='…' \
     VAPID_SUBJECT='mailto:hello@tcgtracker.com.au' \
     ADMIN_ALERT_EMAIL='jamieha1998@gmail.com'
   ```
   - Use **straight single quotes** `'…'`. On a Mac, double quotes break on a `!` (zsh says `event not found`), and curly quotes `‘ ’` (which Notes, Messages and Word insert) leave the terminal stuck at `quote>`. If you see `quote>`, press **Ctrl+C** and paste again.
   - No `[ ]` around the password, and nothing after each `\`, not even a space.

   It should say the secrets are staged for the next deploy. Check with `fly secrets list`, which shows names only, never values.
3. Deploy:
   ```
   fly deploy --ha=false
   ```
   The first build takes 3–6 minutes. It ends with something like "Machine … is now in a good state".
4. Make sure exactly **one** machine runs, so the scheduler never runs twice:
   ```
   fly scale count 1 --yes
   fly status
   ```
   `fly status` should list one machine in `syd` with state **started**.
5. Watch it work: `fly logs`. It streams forever (it never "finishes"), so press **Ctrl+C** when you've seen enough. Within a minute you should see lines like `drops toysrus discovery: seen=… events=…` and `drops dispatch: claimed=…`. Press **Ctrl+C** to stop watching; the workers keep running.
   - If the logs fill with `EMAXCONNSESSION max clients reached in session mode`, you're running code from before 2 Oct 2026, when each store monitor kept a database connection open. Run `git pull`, then `fly deploy --ha=false`.
6. ✉️ Tell Claude: **"workers deployed"**, plus anything red in the logs (copy the lines, never the secrets).

**Adding more secrets later** (Steps 9–11): `fly secrets set NAME='value'` from the `workers` folder. Fly restarts the worker by itself.
**Deploying Claude's newer code:** `git pull` then `fly deploy --ha=false` from the `workers` folder.

### 7e · Check the live stock monitor from Sydney (≈10 min, 30 min after deploying)
The monitor watches **44 Australian stores**: 39 Shopify shops, 2 WooCommerce shops, JB Hi-Fi, **Kmart** and **Target** (their online stores, switched on 2 Oct 2026). It only reads what each store publishes openly, with an honestly named bot (`TCGTrackerBot`, explained at https://tcgtracker.com.au/about/bot/).
1. Open **https://tcgtracker.com.au/drops/stores/**. Each store shows *Live · checked Xm ago*, *Member sightings only* or *Not reachable*.
2. Test one store from the Sydney server. In the terminal, in the `workers` folder:
   ```
   fly ssh console -C "python -m tcgworkers.drops.probe https://www.toysrus.com.au --collection pokemon-tcg"
   ```
   It should list the store's Pokémon products and say which product page each one belongs to.
   - **Kmart:** the first check after each deploy reads all ~127 Kmart Pokémon products once (about 8–10 minutes) and stores them quietly as the starting point. From then on, a new Kmart product is picked up within about 2 minutes. `fly logs` shows `drops kmart discovery: seen=…`.
   - **Target:** reads Target's Pokémon and One Piece pages every 2 minutes. Alerts link to Target's Pokémon category page, not the product page, until Target agrees to deep links (send them the outreach email in Step 13).
   - **BIG W and EB Games** still refuse automated visitors (BIG W drops the connection; EB Games shows a Cloudflare challenge). They stay on member sightings until they allow it or agree to a feed.
3. ✉️ Tell Claude **"monitor check"**, plus what the stores page shows (e.g. "35 live, 7 not reachable"). Claude reads the results and tunes the monitor.
4. **Why this matters:** Shopify gives honestly identified bots a small request allowance per internet address. From Claude's shared test machine that was only a few requests at a time, and the monitor slowed itself down rather than pushing (by design). The Sydney server has its own address, so its allowance should be better, but only this check can tell. The monitor tunes its own pace: it slows down whenever a shop asks it to and speeds up while everything's fine.


### 7f · The live stock section and the 5-minute free delay (≈5 min)
**What it is:**
- **https://tcgtracker.com.au/stock/** is the summary view:
  - listings in stock now, stores with stock and stock changes this week
  - a **Stock by store** table, ranked by what's in stock
  - the most available products
  - in-store member sightings by state
- **/stock/{store}/** (e.g. **/stock/kmart/**) is the detailed view. It lists every Pokémon and One Piece listing at that store, with its status, price, change versus RRP, when it last changed, and a link to buy.

Both pages refresh every minute and are live for everyone. Drop alerts reach Premium instantly and free members **5 minutes** later (was 24 hours). You can change the delay any time in **Admin → Settings → Drops → Free member alert delay**.

**Do once:** after the pull request that adds it is merged, run GitHub → **Actions → Deploy database → Run workflow** (type `deploy`). Then open https://tcgtracker.com.au/stock/.

✉️ Tell Claude **"stock section live"** with what the summary shows, for example "120 in stock, 14 stores".

## Step 8 · Stripe: Premium at A$12.99/month (≈30 min)
**App: https://dashboard.stripe.com.** Stripe now has **sandboxes** for testing and **live mode** for real money. Set things up in live mode, except where the guide says otherwise. The mode switch is in the account menu at the top left.

### 8a · Account
1. Sign up with country **Australia**. As a sole trader you can use your own name and ABN. You need photo ID, an Australian bank account, and the website `https://tcgtracker.com.au`.
2. Finish **Activate payments** (business details, ID, bank). Stripe may take a day to review.
3. Go to **Settings → Billing → Invoice** and add your **ABN**, so it prints on receipts.
4. **GST:** ✉️ tell Claude whether you're **registered for GST**.
   - **Registered:** go to **Settings → Tax**, set *Prices include tax* to **Inclusive**, and add your GST registration under **Locations**. Tell Claude whether you want Stripe Tax (A$0.75 per transaction) or a simple tax-inclusive price; Claude recommends the simple price.
   - **Not registered** (under A$75k a year): skip Stripe Tax. The price is still A$12.99, but receipts mustn't say "incl. GST". Claude adjusts the wording.

### 8b · The Premium product
1. Go to **Product catalogue** (under **More** in the left menu if it isn't shown) → **+ Add product**.
2. Fill in:
   - **Name:** `TCGTracker Premium`
   - **Description:** `Instant drop alerts, unlimited listings and full market data.`
   - **Pricing:** **Recurring**, amount **12.99**, currency **AUD**, billing period **Monthly**
   - **Include tax in price:** **Yes** (tax inclusive)
3. Optional: a free trial. Tell Claude how many days (7 is common for Australian alert groups); Claude adds it in code.
4. Click **Add product**. On the product's page, under **Pricing**, click the price row and copy its **API ID** (`price_…`).
5. Add it as a **Cloudflare secret** named `STRIPE_PRICE_PREMIUM_MONTHLY`.

### 8c · Customer portal (members cancel and update cards themselves)
1. Go to **Settings → Billing → Customer portal**.
2. Turn on:
   - **Customers can cancel subscriptions**, at the **end of billing period**
   - **Customers can update payment methods**
   - **Invoice history**
3. Set **Default redirect link** to `https://tcgtracker.com.au/account/billing/`.
4. Click **Save changes**, then **Activate link** if it's shown.

### 8d · Webhook (tells the site when someone subscribes or cancels)
1. Open **Workbench** (bottom of the left menu, or the **Developers** menu) → **Webhooks** tab → **Create an event destination** (or **+ Add destination**).
2. **Events from:** **Your account**. **API version:** leave the default. **Payload:** **Snapshot**, if asked.
3. Select these 5 events (use the search box):
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. **Continue** → destination type **Webhook endpoint** → **Continue**.
5. **Endpoint URL:** `https://tcgtracker.com.au/webhooks/stripe/` (keep the slash at the end). Then **Create destination**.
6. On the destination's page, click **Reveal** under **Signing secret** and copy the `whsec_…` value. Add it as a **Cloudflare secret** named `STRIPE_WEBHOOK_SECRET`.

### 8e · Secret key
1. Go to **Developers → API keys** (https://dashboard.stripe.com/apikeys), in **live mode**.
2. Under **Standard keys → Secret key**, click **Reveal live key** and copy the `sk_live_…` key. Add it as a **Cloudflare secret** named `STRIPE_SECRET_KEY`.
3. Go to Cloudflare **Deployments** and click **Retry build**, or wait for the next merge.
4. ✉️ Tell Claude: **"Stripe done"** and whether you're GST-registered. Then do one test yourself: sign in, go to **/premium/**, subscribe with your own card, check your account shows Premium, then refund it in Stripe (**Payments** → the payment → **Refund**) and cancel the subscription. Claude checks the webhook arrived.

Stripe fees: **1.7% + A$0.30** per domestic card payment (from 1 Oct 2026), plus **0.7%** for Stripe Billing subscriptions.

## Step 9 · JustTCG: card prices and price history (≈10 min)
This fills the market cap, card pages and price charts. The price import also **creates the card catalogue** automatically, so until this is done the market pages stay empty.

**Why JustTCG:** every paid plan includes a commercial licence written into their Terms (§7.1). You can show prices, price history and % changes, and calculate market cap from them, with **no permission email**. It prices each grading company separately (PSA, BGS, CGC, SGC). PSA drives market cap; the others show on card pages for comparison. The one rule: never hand their raw data to others as a download, feed or API. The site doesn't.

**App: https://justtcg.com.**
1. Click **Sign Up** (top right) and create an account with hello@tcgtracker.com.au.
2. Subscribe to **Professional** (US$49/month: 5,000 requests a day, enough to refresh every card daily): https://justtcg.com/pricing. Free and Starter won't do: Free is personal-use only, and Starter's 1,000 requests a day is too few for both games.
3. In your JustTCG **Dashboard**, copy your **API key**. It starts with `tcg_`.
4. Terminal (`workers` folder): `fly secrets set JUSTTCG_API_KEY='tcg_your_key'`. Fly restarts the worker by itself.
5. Within 4 hours the first import runs. It lists every Pokémon (English and Japanese) and One Piece set, then fetches the sets with the oldest prices first, about 1,500 requests per run. Each set's first fetch also brings **a year of price history**, so charts aren't empty on day one. Everything is filled in within about a day.
6. Check progress on the admin dashboard (https://tcgtracker.com.au/admin/) under **Pipeline status**. The `prices` job shows `source: justtcg`, `sets_refreshed` and `sets_remaining`.
7. ✉️ Tell Claude: **"JustTCG live"**. Claude checks the first import: matched cards, the admin review queue, and prices on a few card pages.

**Good to know:**
- Prices are JustTCG's North American market values in USD, converted to AUD at the Reserve Bank's rate for each day.
- Population (how many PSA 10s exist) isn't part of JustTCG. Until a population source is licensed, rankings are ordered by PSA 10 value and the market-cap column shows "—".
- Some cards need a human check: if a set or card name differs from ours, the import queues it in **Admin → Card mapping** (https://tcgtracker.com.au/admin/mapping/) instead of guessing.
- You don't need PriceCharting. If you already subscribed, you can cancel it.

## Step 9b · eBay developer keys: the deal finder (≈20 min)
This powers **/deals/**: graded cards on eBay Australia listed well under market value, and auctions ending soon. It uses eBay's official API.

**App: https://developer.ebay.com.**
1. **Register** (top right). Use your normal eBay account; create one if needed. Approval is usually quick and comes by email.
2. Open **Application Keys** (account menu → *Application Keysets*, or https://developer.ebay.com/my/keys).
3. Enter an application title, `TCGTracker`, then under **Production** click **Create a keyset**. Confirm your contact details when asked.
4. You'll see **App ID (Client ID)**, **Dev ID** and **Cert ID (Client Secret)**. You need the App ID and the Cert ID.
5. **Required before the keys work.** eBay makes every app either receive "account deletion" notices or opt out:
   1. On Application Keys, click **Notifications** next to the Production App ID.
   2. Select **Marketplace Account Deletion**.
   3. Turn **Not persisting eBay data** **On**, then **Confirm**.
   4. Choose the exemption reason saying you **don't store eBay users' personal data**. That's true: we only store listing details, never eBay accounts.
   5. **Submit**.
6. In the terminal (`workers` folder):
   ```
   fly secrets set EBAY_CLIENT_ID='App ID here' EBAY_CLIENT_SECRET='Cert ID here'
   ```
7. On the site, go to **Admin → Settings → eBay deals** and turn on **Find eBay deals**. The defaults are deals at least 20% under value, and auctions ending within 2 hours. Then **Save**.
8. ✉️ Tell Claude: **"eBay keys added"**. Claude checks the first run in the logs. eBay limits new apps to 5,000 calls a day; the deal finder stays well under that.

**Earn commission on eBay links (optional, ≈10 min):**
1. Join the **eBay Partner Network** at https://partnernetwork.ebay.com.au → **Sign Up** → **Sign in with eBay** → fill in your details (free).
2. Once approved, open **Campaigns** and copy the 10-digit campaign number.
3. Paste it into **Admin → Settings → eBay** on the site. Deal and fallback links then earn commission.

## Step 9c · Product images (≈5 min) ⏭ after the image-coverage PR is merged
Every card and sealed product gets a picture from free and official sources: **no Scrydex needed**. Until a product has one, it shows the TCGTracker default image (the logo on a soft tile), never a "coming soon" message.

Where images come from, best first. A better source replaces a weaker one; an image you set by hand is never replaced:
1. **Scrydex** (optional, paid): only if you ever add its keys (bottom of this step).
2. **TCGdex** (free, open): Pokémon cards, English and Japanese. Two requests per language fetch its whole card list.
3. **pokemontcg.io** (free, open): English Pokémon cards TCGdex has no picture for, such as Shiny Vault, Trainer Gallery, Galarian Gallery and Black Star promos. It searches 10 cards per request.
4. **Bandai's official card images**: One Piece, English and Japanese, including each parallel, manga and SP print. The exact print is found through optcgapi.com's card list.
5. **The card’s TCGplayer image**: the last resort for anything left. JustTCG gives every card its exact TCGplayer product id, so no guessing is involved. The price import saves that id on each card. To switch this source off: **Admin → Settings → Images**.
6. **The product's own store listing**: sealed products, from the photo on the store page we track for it.

How matches are kept right:
- A card only takes an image when number, name and set all agree.
- The printed set size must also agree: 199/165 only matches a set of 165.
- A card missing from its own set is never given another set's picture, and nothing is guessed between two possibilities.
- One Piece alternate prints only take the image of that exact print.
- Every image address is checked before it is saved (one quick request each).

Every run reports coverage per game and language. It also lists the cards still on the default image (`missing_cards`), most valuable first, and notes any with no TCGplayer id. **Admin → Images** shows the same figures, with a box to paste an image address and fix one by hand.

Each image shows "Image © The Pokémon Company" or "© Bandai" underneath. Card artwork belongs to those companies; check how you show it with your lawyer in Step 14.

**After merging:**
1. **GitHub → Actions → Deploy database** (adds the TCGplayer id to cards and three image settings).
2. Wait for the next price import (every 4 hours; it saves each card's TCGplayer id), or run it now:
   ```
   cd ~/TCGTracker/workers
   fly ssh console -C "python -m tcgworkers.main --once prices"
   ```
3. Fill the images now rather than waiting for the daily run:
   ```
   fly ssh console -C "python -m tcgworkers.main --once images"
   ```
   The last line starts `images:`. Send Claude its `coverage` and `missing_cards` parts.

**Optional: Scrydex.** Only if you want its images ahead of the free ones. Subscribe at **https://scrydex.com/pricing** (Starter, US$29/month). Create an **API key** in its Account Hub and copy your **Team ID**. Keep both out of the chat. Then run `fly secrets set SCRYDEX_API_KEY='paste-key' SCRYDEX_TEAM_ID='paste-team-id'` in the `workers` folder. If a run stops with `request budget used`, the next daily run carries on.

## Step 9d · Every card in every set (≈5 min) ⏭ after the full-catalogue PR is merged
**Why cards were missing:** the JustTCG import only added a card once it had a *graded* sale (PSA, BGS...). A brand-new set, such as the 30th Celebration with #034/103, has almost none yet. On top of that, a new card that shared its number with any other set's card (nearly all of them do) went to the review queue instead of onto the site.

**Now:** every card JustTCG lists is added, graded or not. Only a real look-alike goes to **Admin → Mapping**: same number, same name and the same set size under another set name. Expect tens of thousands of cards (English, Japanese and One Piece) over the first day of price imports.

**Keeping the database small** (a daily copy of every A$0.20 common would fill it):
- Every priced card is ranked and has a page.
- Value charts and 24h/7d/30d change are kept for cards worth **A$5+**.
- A year of past prices is backfilled for cards worth **A$10+**.
- History older than 60 days keeps one point a week.
- All three are in **Admin → Settings → Market**.

**Search engines:** card pages are listed in sitemap files of 20,000 cards each (`/sitemaps/cards-1.xml`, `-2`...). A card's "for sale" page is only indexed once someone lists that card; until then it would be an empty page per card.

**After merging:**
1. **GitHub → Actions → Deploy database.**
2. Bring every set in now instead of over the next 20 hours. Paste in the **SQL Editor** (Supabase), then **Run**:
   ```
   update public.justtcg_sets set refreshed_at = null;
   ```
   Then in Terminal (`workers` folder): `fly ssh console -C "python -m tcgworkers.main --once prices"`. Each run fetches as many sets as its request budget allows (2,500 requests ≈ 1,200 sets). Run it again if the last line shows `sets_remaining` above 0.
3. Run the images job (Step 9c) so the new cards get pictures. The first full fill can take a few daily runs.
4. **Supabase plan:** the free plan holds 500 MB. A full catalogue with price history needs more within a few months. Move to **Pro** (US$25/month, 8 GB, daily backups) before launch: Supabase → **Organization → Billing**. Check usage any time under **Reports → Database**.

## Step 9e · Drop alerts: interests only, instant, one-tap checkout (≈5 min)
**Only what each member follows.** Members no longer get every drop. By default ("Only what I follow") a member hears about:
- products they tap **Notify me** on;
- sets or words they follow (e.g. "prismatic", "charizard");
- product types they follow (booster boxes, Elite Trainer Boxes, premium collections and so on).

Their stores, states, price cap and RRP filters still narrow that. Anyone who really wants everything can pick **Every drop**. Every member, you included, gets a one-off on-site notice asking them to choose their interests.

**Faster.** What used to add up to ~2 minutes:
- **JB Hi-Fi** is re-checked every **30 s** (was 90 s). One search request covers every JB product we know.
- The **alert sender wakes the instant** the monitor saves a drop (it used to poll every 15 s).
- **Push notifications go to every phone at once** (they used to go one by one, so with 1,000 subscribers the last one waited minutes).
- The Premium **live feed on /drops/ updates the moment** a drop is saved.

**One-tap checkout.** For JB Hi-Fi and every Shopify store we watch, alerts carry the store's own **Add to cart & check out** link. Tapping a push notification opens the store's checkout with the item already in the cart; the member enters their own address and payment. The same button appears on product pages, store stock pages and fresh drops. A link is only made when it's certain which item it adds: a product with two buyable options (e.g. pack or box) gets no link. Kmart, Target, BIG W and WooCommerce shops have no such public link, so they keep "View at store".

**After merging:**
1. **GitHub → Actions → Deploy database.**
2. Deploy the workers so the faster monitor, sender and checkout links go live. In Terminal (`workers` folder): `fly deploy`.
3. Open **https://tcgtracker.com.au/account/alerts/drops/**. Under **What to alert on**, follow your sets and product types, then **Save**.
4. Check speed: the next JB Hi-Fi restock should reach your phone within about 30–40 seconds of JB listing it.

## Step 9f · Workers stay within 512 MB (≈2 min) ⏭ after the worker-memory PR is merged
**Why:** with the full catalogue, the 4-hourly **floors** job (it works out every card's current price) loaded 120 days of every card's prices at once: about 470 MB for 40,000 cards, nearly the whole 512 MB machine. When the machine ran out, the whole worker restarted, drop monitor included.

**Now:**
- **Floors** reads prices one card at a time: about 50 MB however big the catalogue gets, and roughly twice as fast.
- **Prices, floors and images run in their own short-lived process**, one at a time. If one of them ever runs out of memory, only that job stops. The drop monitor and the alert sender keep running, so drops are still detected and alerted instantly. They also no longer share the monitor's CPU time, so detection is, if anything, slightly quicker.
- The price import's in-memory card list is about 30% smaller.
- The machine gets **512 MB of swap** (spare memory on its own disk, free).

No upgrade to 1 GB is needed. (If you ever do upgrade, change `memory = "512mb"` in `workers/fly.toml` too, or the next `fly deploy` sets it back.)

**After merging:** in Terminal:
```
cd ~/TCGTracker
git checkout main
git pull
cd workers
fly deploy
```
A manual run (`fly ssh console -C "python -m tcgworkers.main --once prices"`) still works the same. If a scheduled big job is already running, it prints "another big job ... is running; waiting for it to finish" and starts straight after.

## Step 9g · Australian release calendar, filled automatically (≈3 min) ⏭ after the release-calendar PR is merged
**What you get:** the **Drops** page shows a small **Release calendar** with the next six Australian release dates. Each one links to its release page, and there's a link to the full calendar (`/releases/`) and the calendar feed (.ics). Dates are Australian calendar days.

**Where the dates come from (every 6 hours):**
- **One Piece:** Bandai's official English site, edition NA/EU/**OC** (Oceania). These are official Australian dates. Accessories (sleeves, playmats, storage boxes) and Premium Bandai web-store items are left out.
- **Pokémon:** the release date **JB Hi-Fi** publishes on its pre-orders. Products of one set out on the same day become one release, listing each product with its Australian RRP. These are marked **Retailer listing**, because retailers can move dates; when JB moves a date, the calendar moves with it.
- **pokemon.com** blocks automated access, so official Pokémon dates still need an editor. Add them in **Admin → Releases**. Once a set has your release, JB's dates for that set aren't added again.
- Overseas dates are never shown. The calendar no longer falls back to card-catalogue set dates, which are US dates.

**You stay in charge (Admin → Releases):**
- Automatic entries say "Automatic: Bandai …" or "Automatic: JB Hi-Fi".
- If you **edit** one, it's locked and never overwritten.
- If you **delete** one, it never comes back.
- To switch the automatic fill off: **Admin → Settings → Drops → Fill the release calendar automatically**.

**After merging:**
1. **GitHub → Actions → Deploy database.**
2. Then deploy the workers. Do it in this order: database first, then workers.
   ```
   cd ~/TCGTracker
   git checkout main
   git pull
   cd workers
   fly deploy
   ```
3. Fill the calendar now instead of waiting up to 6 hours:
   ```
   fly ssh console -C "python -m tcgworkers.main --once releases"
   ```
   The last line shows how many releases were added. JB Hi-Fi's dates appear after the drop monitor has seen each product once more (within minutes), so run it again after about 30 minutes for the full Pokémon list.

## Step 9h · Site scan fixes (≈1 min) ⏭ after the site-scan PR is merged
A full scan of the live site (every page type, desktop and phone, plus the sitemaps) found:

| Found | Fixed |
|---|---|
| **All 8 guides were 404s in production**, though linked from the menu, the release pages and the sitemap. Cloudflare doesn't serve build-time pages without a page cache, and guides were set to build-time only. | Guides render on request too. Checked on a local Cloudflare build: 200, and unknown guides still 404. |
| **Every visitor opened a live (Realtime) connection** to Supabase, from the notification bell and the Drops live feed, even when not signed in. The free plan allows about 200 at once, so a busy day could have cut off Premium's live feed. The live feed also skipped the member's sign-in on that connection, so Premium only got the 30-second refresh. | Visitors and Free members open none. Signed-in members get the bell, and Premium gets the instant live feed, using their own sign-in. |
| The **drops sitemap took 11 seconds** (about 60 database requests). Google can give up on slow sitemaps. | One database query; the same 26 pages are listed. |
| Pages from overseas (and Googlebot, which crawls from the US) waited for one trip to Sydney **per database query**: 1.5–3 s per page. | Cloudflare **Smart Placement** runs the site next to the database when that's faster. |

Everything else checked clean on the live site: no JavaScript errors, broken images, missing alt text, heading problems or sideways scrolling on phones.

**After merging:** **GitHub → Actions → Deploy database**. Until then the sitemap uses its old, slower method, so nothing breaks in the meantime. The website redeploys by itself.

**Run the scan yourself any time** (in the `web` folder, needs Chromium: `npx playwright install chromium` once):
```
BASE_URL=https://tcgtracker.com.au npm run site:scan
BASE_URL=https://tcgtracker.com.au npm run seo:check
```

**Optional, later: page cache (faster pages, less database load).** Pages are meant to refresh every 5 minutes, but on Cloudflare every visit currently rebuilds the page from the database. That's fine at today's traffic. Before a big launch, ask Claude to "set up the OpenNext R2 page cache". It needs a free Cloudflare R2 bucket, which you create in Cloudflare (**R2 → Create bucket**, about 2 minutes).

## Step 10 · Discord Premium alerts channel (≈10 min, optional at launch)
Every drop is posted instantly to a private Discord channel for Premium members. No Admin switch is needed: it starts as soon as the secret is set.

**App: Discord** (desktop app or https://discord.com/app).
1. Create the server: click **+** (Add a Server) in the far-left bar → **Create My Own** → **For a club or community** → name `TCGTracker` → **Create**.
2. Create a role: **Server Settings → Roles → Create Role**, name `Premium` → **Save Changes**.
3. Create the channel: click **+** next to *Text Channels* → name `premium-drops` → turn on **Private Channel** → **Next** → tick the **Premium** role → **Create Channel**.
4. Create the webhook: **Server Settings → Integrations → Webhooks → New Webhook**. Click the new webhook, set **Name** `TCGTracker Drops` and **Channel** `#premium-drops`, then **Copy Webhook URL** → **Save Changes**.
5. Terminal (`workers` folder): `fly secrets set DISCORD_DROPS_WEBHOOK_URL='https://discord.com/api/webhooks/…'`.
6. Linking members' Discord accounts to Premium **isn't automated yet**. Give the Premium role by hand, or launch with push and email only and ask Claude to add automatic linking later.

## Step 11 · Monitoring: know straight away if anything breaks (≈15 min)
### 11a · Sentry (error reports)
**App: https://sentry.io.** The free **Developer** plan (1 user, 5,000 errors a month) is enough.
1. Sign up. When asked to create a project, choose **Python**, name it `tcgtracker-workers` → **Create Project**.
2. Copy the **DSN** it shows. It looks like `https://…@o….ingest.sentry.io/…`. You can find it again under **Settings → Projects → tcgtracker-workers → Client Keys (DSN)**.
3. Terminal (`workers` folder): `fly secrets set SENTRY_DSN='https://…'`.
4. Create a second project: **Projects → Create Project → Next.js**, name `tcgtracker-web`, and copy its DSN.
5. In Cloudflare, add a **build variable** `NEXT_PUBLIC_SENTRY_DSN` = that DSN, then **Retry build**. This reports errors that happen in visitors' browsers. Don't add a server-side `SENTRY_DSN` to Cloudflare yet: Claude will test Sentry's server reporting on Cloudflare first.

### 11b · healthchecks.io (alert if the 24/7 worker stops)
**App: https://healthchecks.io.** The free **Hobbyist** plan is enough. It has no SMS, so phone alerts go through a free app.
1. Sign up. On **Checks**, click **Add Check**.
2. Name it `tcgtracker-workers`. Click **Change Schedule** (or the period shown): **Period** `1 minute`, **Grace Time** `5 minutes` → **Save**. The worker pings every minute only while all its jobs and store monitors are healthy, and sends a "fail" signal with the reason otherwise.
3. Copy the check's **ping URL**, like `https://hc-ping.com/1234abcd-…`.
4. Terminal (`workers` folder): `fly secrets set HEALTHCHECK_URL='https://hc-ping.com/…'`.
5. Alerts to your phone: open **Integrations**. **Email** is already on. Then, next to **Telegram**, **Pushover** or **Discord**, click **Add Integration** and follow its steps. Telegram is free and the easiest.
6. Test it: the check should turn **green** within 2 minutes.

## Step 12 · Before you announce: set up the community side (≈1–2 hours)
**App: the site's admin, https://tcgtracker.com.au/admin/.**
1. **Member sightings:** go to **Admin → Settings → Member sightings**.
   - **Confirmations needed** = `1` while the community is small. Raise it to `2` once you have about 50 active Premium members.
   - Keep **Premium reward every** = `10` sightings and **Premium reward length** = `30` days.
   - **Save**.
2. **Founding scouts:** recruit 5–10 friends and TCG contacts in different states, and ideally 2 moderators. To make someone a moderator, use the Supabase **SQL Editor** (as in 3g):
   ```sql
   update public.profile_private set role = 'moderator'
   where user_id = (select id from auth.users where email = 'THEIR EMAIL');
   ```
   Moderators confirm or reject reports in **Admin → Sightings**. Staff reports alert instantly.
3. **Release calendar:** in **Admin → Releases**, add the next 3–6 months of Pokémon and One Piece releases. Use official sources and tick the right confidence:
   - Pokémon: https://www.pokemon.com/au/pokemon-tcg and the Pokémon press site
   - One Piece: https://en.onepiece-cardgame.com/products/ (Oceania shares the global date)
   - Retailer pre-order pages count as "Retailer listing". Anything else is "Unconfirmed".
4. **RRPs:** in **Admin → Drops → RRP table**, check the RRPs, so alerts show "At RRP" or "Above RRP (+40%)" correctly.
5. **Test the whole loop yourself:**
   1. Turn on push at **Account → Drop alerts**. On iPhone, first open the site in Safari → **Share → Add to Home Screen**, then open it from that icon.
   2. Report a test sighting, and confirm it with a moderator account. The alert should arrive on your phone.
   3. Reject it afterwards in **Admin → Sightings**.
   4. Create a test marketplace listing, message it from a second account, and check both emails arrive.

## Step 13 · Store outreach and affiliate programs (ongoing, in your own name)
These give reliable stock and price data **with permission**, and earn commission.
1. **Specialist TCG stores** (the biggest win): most are small businesses that *want* buyers sent to them. For every store that `/drops/stores/` shows as *Not reachable* or slowed down, send the ready-made email in `docs/templates/store-outreach-email.md`. It asks them to allow `TCGTrackerBot` or share a feed. Each "yes" makes that store fully live, with no code change.
2. **Toymate:** on **Commission Factory** (https://www.commissionfactory.com, Australian, 7% commission). Join as an affiliate, then apply to Toymate. Commission Factory advertisers can offer **product feeds** (CSV/XML); check Toymate's listing after you're approved.
3. **BIG W:** reported to run its program on **Impact** (https://impact.com). Sign up as a partner and search for BIG W. Ask whether a product feed with stock availability is available.
4. **Kmart, Target AU, JB Hi-Fi:** their programs are on other networks: Target AU on FlexOffers, JB Hi-Fi through Skimlinks, Kmart unconfirmed. Apply once the site has some traffic; ✉️ tell Claude about any approval and it wires the feed in.
5. **Amazon Associates AU:** https://affiliate-program.amazon.com.au → **Sign up**. Amazon's product-data API (now the "Creators API") only opens after **10 qualifying sales in 30 days**, so it's a later win.
6. **eBay Partner Network:** see Step 9b.
7. **Per-store stock levels** ("7 in stock at Box Hill"), the one thing some competitors show that we don't:
   - **Good Games** and **Toyworld** publish per-store stock through a service called *Stock In Store*, whose rules forbid automated reading.
   - **Kmart** publishes it through a part of its site its rules also forbid (`/api/`).
   - We only show them with permission. Send `docs/templates/store-stock-levels-request.md` to each of the three, and the short version to Stock In Store.
   - ✉️ When one says yes, tell Claude **"store stock approved: {store}"**. Claude then adds per-store counts to `/stock/{store}/` and to the hub.

## Step 14 · Legal (before announcing)
1. Have an Australian lawyer review the **Terms**, **Privacy Policy** and **Marketplace rules**. They're drafts, marked noindex. Ask them to cover:
   - member-submitted sightings and photos (the licence to display them, and a no-photos-of-people rule)
   - scout rewards (free Premium isn't a prize draw, but check the wording)
   - Spam Act compliance for alerts. Consent and unsubscribe links are already built in.
   - JustTCG's licence terms (Step 9: display allowed on a paid plan) and card images (Step 9c)
2. **Giveaways:** chance-based giveaways are trade-promotion lotteries. ACT and SA need permits above certain prize values, so check with your lawyer first. Scout rewards are earned, so they're fine.
3. Keep the "not affiliated with Nintendo, The Pokémon Company, Bandai or any retailer" footer.

## Step 15 · Google and Bing (≈15 min, after launch)
**App: https://search.google.com/search-console.**
1. Click **Add property** → **Domain** → `tcgtracker.com.au` → **Continue**.
2. If Google offers your DNS provider (Cloudflare) with **Start verification** / **Authorize**, use it and approve in Cloudflare. Otherwise copy the `google-site-verification=…` TXT value, then in Cloudflare go to **DNS → Records → + Add record**: Type `TXT`, Name `@`, Content = the value → **Save**. Back in Google, click **Verify**. Leave the record in place permanently.
3. Open **Sitemaps** → **Add a new sitemap** → `sitemap.xml` → **Submit**.
4. **Bing:** go to https://www.bing.com/webmasters → sign in → **Import** (from Google Search Console) → **Allow** → select `tcgtracker.com.au` → **Import**. It's verified automatically.
5. ✉️ Tell Claude: **"Search Console done"**. Claude then follows the 90-day content calendar in `docs/SEO-STRATEGY-AU.md`. One guide or release write-up a week builds momentum.

---

## Troubleshooting
| Problem | Fix |
|---|---|
| "We've sent a lot of sign-in emails just now" | Wait a few minutes. Each address can request one link a minute; the whole site 100 an hour (Supabase → **Authentication → Rate Limits**). |
| Sign-in link says it didn't work | Links work once and expire after an hour. Request a new one. |
| A Cloudflare build is red | Open it → **View build log** → copy the last 30 lines to Claude. |
| `fly deploy` fails | Copy the last 30 lines to Claude. |
| Worker logs show `password authentication failed` | The password in `DATABASE_URL` is wrong. Reset it in Supabase (7c), then `fly secrets set DATABASE_URL='…'`. |
| Worker logs show `EMAXCONNSESSION max clients reached in session mode` | The worker opened more database connections than Supabase's pooler allows (15). Fixed in the code on 2 Oct 2026: `git pull`, then `fly deploy --ha=false`. If it ever comes back, `fly secrets set DB_MAX_CONNECTIONS=5` lowers the worker's limit (default 8). |
| healthchecks.io says the check is down | Run `fly status` and `fly logs` in the `workers` folder and send Claude what you see. |

## What to send Claude, in order
1. ✅ "I'm admin" (3g)
2. ✅ "push keys added" (6)
2b. "cross-device sign-in works" (5b)
3. ✅ "workers deployed" (7d), then "monitor check" (7e)
4. "JustTCG live" (9)
5. "Stripe done" and whether you're GST-registered (8)
6. "eBay keys added" (9b)
7. Whether to show card scans, and "Scrydex ready" if yes (9c)
8. Any store, retailer feed or affiliate approval (13)
9. "Search Console done" (15)

## Monthly running costs (similar to beforeyoufly.com.au)
| Service | Cost |
|---|---|
| Domain (VentraIP) | ~A$20–30/yr |
| Cloudflare Workers Paid (website) | US$5/mo |
| Supabase | Free → **US$25/mo** Pro once there are real users. Free projects pause after a week with no activity, and Pro adds daily backups. Upgrade before announcing. |
| Fly.io (Sydney worker) | ~US$5/mo |
| Resend | Free (3,000 emails/mo) → US$20/mo |
| JustTCG Professional (card prices) | US$49/mo |
| Scrydex (if you choose images) | US$29/mo |
| Stripe | 1.7% + A$0.30 per domestic card payment, plus 0.7% Billing |
| Web push, Discord, Sentry, healthchecks.io | Free |
