# TCGTracker: your next steps

Last updated **1 October 2026**. Work top to bottom. Each step says **which website or app to open**, **where to click**, **what to copy where**, and **what to tell Claude**. Menu names were checked against each service's current help pages on 1 Oct 2026. If a screen looks different, send Claude a screenshot (cover any keys first).

> Claude updates this guide as you go. Updates arrive as small pull requests in the repo. Merge them once their checks are green, and the latest version is always on `main`.

> **Never paste passwords or secret keys into the chat.** Put them straight into the place this guide names (Cloudflare, Fly.io, Supabase or GitHub). Claude only needs to hear "done".

## Where things stand (1 Oct 2026)
✅ **Live at https://tcgtracker.com.au.** Sign-in works from any device or email app, and sign-in emails come from `hello@tcgtracker.com.au` through Resend.

The website is complete, but these parts are switched off until their services are connected:

| Part of the site | Needs | Step |
|---|---|---|
| Market prices, card pages, market cap | PriceCharting | 9 |
| 24/7 store monitor, drop alerts, email alerts, listing expiry | Fly.io (background workers) | 7 |
| Phone and desktop push alerts | Push keys | 6 |
| Premium A$12.99/month | Stripe | 8 |
| eBay deal finder | eBay developer keys | 9b |
| Card images | Scrydex (your decision) | 9c |
| Discord Premium alerts | Discord webhook | 10 |
| Outage alerts to your phone | Sentry and healthchecks.io | 11 |

**Do next, in order:** 3g (make yourself admin, 2 min) → 6 (push keys, 5 min) → 7 (Fly.io, 30 min) → 9 (PriceCharting) → 8 (Stripe) → the rest.

## Progress
| Step | What | Status |
|---|---|---|
| 1 | GitHub repo `JamieOnGit/TCGTracker` | ✅ Done |
| 2 | Domain `tcgtracker.com.au` (VentraIP) on Cloudflare | ✅ Done. Check 2.8 (SSL **Full (strict)** + **Always Use HTTPS**) is on. |
| 3a–3f | Supabase project, sign-in URLs, GitHub secrets, database deployed | ✅ Done |
| 3f-2 | Deploy database again for the stock-monitor update | ✅ Do it now if you skipped it (1 min) |
| **3g** | **Make yourself admin** | ⏭ **Do now** |
| 4 | Website on Cloudflare Workers + domain + www redirect | ✅ Done |
| 5 | Resend email + Supabase SMTP + rate limit | ✅ Done (sign-in works) |
| 6 | Push-notification keys | ☐ Next |
| 7 | Fly.io workers in Sydney (monitor, alerts, emails) | ☐ |
| 7e | Check the 42-store monitor from Sydney | ☐ After 7 |
| 8 | Stripe (Premium) | ☐ |
| 9 | PriceCharting (prices) | ☐ |
| 9b | eBay developer keys (deal finder) | ☐ |
| 9c | Card images (Scrydex) | ☐ Your decision |
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
| `PRICECHARTING_TOKEN` | Fly.io secret | Step 9 |
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

## Step 3 · Supabase: database, sign-in and photos ✅ done except 3g

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

### 3g · Make yourself admin (≈2 min) ⏭ do now
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

The Magic link email template doesn't need editing: since PR #7, the standard link works in the Gmail app and on other devices.

## Step 6 · Push-notification keys (≈5 min)
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
- check 42 Australian stores for restocks, around the clock
- send drop alerts by email, push and Discord (Premium instantly, Free 24 hours later)
- send marketplace email notifications
- import prices every 4 hours, once PriceCharting is set up
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
   2. Choose the **Session pooler** connection string (not "Direct connection", which only works over IPv6, and not "Transaction pooler").
   3. Copy it. It looks like `postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-…-ap-southeast-2.pooler.supabase.com:5432/postgres`. Copy the host exactly as shown; don't retype it.
   4. Replace `[YOUR-PASSWORD]` (including the brackets) with your database password from Step 3a. If the password contains `@ # ? & / :` or spaces, reset it first to one with only letters and numbers (**Database → Settings → Reset database password**), and update the GitHub secret `SUPABASE_DB_PASSWORD` to match.
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
     DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-…-ap-southeast-2.pooler.supabase.com:5432/postgres" \
     SUPABASE_URL="https://xxxx.supabase.co" \
     RESEND_API_KEY="re_…" \
     VAPID_PRIVATE_KEY="…" \
     VAPID_SUBJECT="mailto:hello@tcgtracker.com.au" \
     ADMIN_ALERT_EMAIL="jamieha1998@gmail.com"
   ```
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
5. Watch it work: `fly logs`. Within a minute you should see lines like `drops toysrus discovery: seen=… events=…` and `drops dispatch: claimed=…`. Press **Ctrl+C** to stop watching; the workers keep running.
6. ✉️ Tell Claude: **"workers deployed"**, plus anything red in the logs (copy the lines, never the secrets).

**Adding more secrets later** (Steps 9–11): `fly secrets set NAME="value"` from the `workers` folder. Fly restarts the worker by itself.
**Deploying Claude's newer code:** `git pull` then `fly deploy --ha=false` from the `workers` folder.

### 7e · Check the live stock monitor from Sydney (≈10 min, 30 min after deploying)
The monitor watches **42 Australian stores** (39 Shopify shops, 2 WooCommerce shops and JB Hi-Fi). It only reads what each store publishes openly, with an honestly named bot (`TCGTrackerBot`, explained at https://tcgtracker.com.au/about/bot/).
1. Open **https://tcgtracker.com.au/drops/stores/**. Each store shows *Live · checked Xm ago*, *Member sightings only* or *Not reachable*.
2. Test one store from the Sydney server. In the terminal, in the `workers` folder:
   ```
   fly ssh console -C "python -m tcgworkers.drops.probe https://www.toysrus.com.au --collection pokemon-tcg"
   ```
   It should list the store's Pokémon products and say which product page each one belongs to.
3. ✉️ Tell Claude **"monitor check"**, plus what the stores page shows (e.g. "35 live, 7 not reachable"). Claude reads the results and tunes the monitor.
4. **Why this matters:** Shopify gives honestly identified bots a small request allowance per internet address. From Claude's shared test machine that was only a few requests at a time, and the monitor slowed itself down rather than pushing (by design). The Sydney server has its own address, so its allowance should be better, but only this check can tell. The monitor tunes its own pace: it slows down whenever a shop asks it to and speeds up while everything's fine.

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

## Step 9 · PriceCharting: graded prices (≈10 min, plus waiting for their reply)
This fills the market cap, card pages and price charts. The price import also **creates the card catalogue** automatically, so until this is done the market pages stay empty.

**App: https://www.pricecharting.com.**
1. Create an account, then subscribe to the **Legendary** plan (US$49/month). It's the only plan with the API and CSV downloads: https://www.pricecharting.com/pricecharting-pro
2. **Before using their prices publicly, ask permission.** Their terms say the data is for *internal use* unless you have a commercial licence and written permission. Email **brady@vgpc.com** from your account email. Claude has a draft ready: ask for it ("draft the PriceCharting email"). It asks for permission to show derived AUD prices publicly, with a link back to PriceCharting on each card.
3. Meanwhile, go to **Subscription** (account menu) → **API/Download** and copy your **40-character API token**.
4. In the terminal, in the `workers` folder: `fly secrets set PRICECHARTING_TOKEN="your-token"`.
5. ✉️ Tell Claude: **"PriceCharting subscribed"**. Claude runs the first import and checks the cards and prices. Keep the site **unannounced** until PriceCharting says yes. Claude can hide prices behind sign-in until then if you prefer.

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
   fly secrets set EBAY_CLIENT_ID="App ID here" EBAY_CLIENT_SECRET="Cert ID here"
   ```
7. On the site, go to **Admin → Settings → eBay deals** and turn on **Find eBay deals**. The defaults are deals at least 20% under value, and auctions ending within 2 hours. Then **Save**.
8. ✉️ Tell Claude: **"eBay keys added"**. Claude checks the first run in the logs. eBay limits new apps to 5,000 calls a day; the deal finder stays well under that.

**Earn commission on eBay links (optional, ≈10 min):**
1. Join the **eBay Partner Network** at https://partnernetwork.ebay.com.au → **Sign Up** → **Sign in with eBay** → fill in your details (free).
2. Once approved, open **Campaigns** and copy the 10-digit campaign number.
3. Paste it into **Admin → Settings → eBay** on the site. Deal and fallback links then earn commission.

## Step 9c · Card images: decide, then Scrydex (≈10 min)
Until this is done, cards show the styled holo placeholder. Neither The Pokémon Company nor Bandai licenses card images to other sites. Most TCG sites show scans anyway, with a "not affiliated" notice (details: `docs/research/03-catalogue-sources.md` §4).
1. Decide, ideally with your lawyer in Step 14, whether to show card scans.
2. If yes, subscribe at **https://scrydex.com/pricing**. **Starter** is US$29/month for 5,000 requests; **Growth** is US$99/month for 50,000. Start on Starter: Claude copies each image once to our own storage, so it doesn't use requests on every page view. Scrydex covers Pokémon EN + JP and One Piece (beta). Its docs say you're free to use the provided images in your app.
3. In the Scrydex dashboard / **Account Hub**, create an **API key** and copy it together with your **Team ID**.
4. Terminal (`workers` folder): `fly secrets set SCRYDEX_API_KEY="…" SCRYDEX_TEAM_ID="…"`.
5. ✉️ Tell Claude: **"Scrydex ready"**. Claude then builds the image import: WebP copies in our own storage, an on/off switch per game in Admin, and a takedown process.
6. One Piece Japanese has no licensable source. It keeps the placeholder and members' own photos.
7. Sealed product images come from your affiliate feeds once approved (Step 13). They include images you're allowed to use.

## Step 10 · Discord Premium alerts channel (≈10 min, optional at launch)
Every drop is posted instantly to a private Discord channel for Premium members. No Admin switch is needed: it starts as soon as the secret is set.

**App: Discord** (desktop app or https://discord.com/app).
1. Create the server: click **+** (Add a Server) in the far-left bar → **Create My Own** → **For a club or community** → name `TCGTracker` → **Create**.
2. Create a role: **Server Settings → Roles → Create Role**, name `Premium` → **Save Changes**.
3. Create the channel: click **+** next to *Text Channels* → name `premium-drops` → turn on **Private Channel** → **Next** → tick the **Premium** role → **Create Channel**.
4. Create the webhook: **Server Settings → Integrations → Webhooks → New Webhook**. Click the new webhook, set **Name** `TCGTracker Drops` and **Channel** `#premium-drops`, then **Copy Webhook URL** → **Save Changes**.
5. Terminal (`workers` folder): `fly secrets set DISCORD_DROPS_WEBHOOK_URL="https://discord.com/api/webhooks/…"`.
6. Linking members' Discord accounts to Premium **isn't automated yet**. Give the Premium role by hand, or launch with push and email only and ask Claude to add automatic linking later.

## Step 11 · Monitoring: know straight away if anything breaks (≈15 min)
### 11a · Sentry (error reports)
**App: https://sentry.io.** The free **Developer** plan (1 user, 5,000 errors a month) is enough.
1. Sign up. When asked to create a project, choose **Python**, name it `tcgtracker-workers` → **Create Project**.
2. Copy the **DSN** it shows. It looks like `https://…@o….ingest.sentry.io/…`. You can find it again under **Settings → Projects → tcgtracker-workers → Client Keys (DSN)**.
3. Terminal (`workers` folder): `fly secrets set SENTRY_DSN="https://…"`.
4. Create a second project: **Projects → Create Project → Next.js**, name `tcgtracker-web`, and copy its DSN.
5. In Cloudflare, add a **build variable** `NEXT_PUBLIC_SENTRY_DSN` = that DSN, then **Retry build**. This reports errors that happen in visitors' browsers. Don't add a server-side `SENTRY_DSN` to Cloudflare yet: Claude will test Sentry's server reporting on Cloudflare first.

### 11b · healthchecks.io (alert if the 24/7 worker stops)
**App: https://healthchecks.io.** The free **Hobbyist** plan is enough. It has no SMS, so phone alerts go through a free app.
1. Sign up. On **Checks**, click **Add Check**.
2. Name it `tcgtracker-workers`. Click **Change Schedule** (or the period shown): **Period** `1 minute`, **Grace Time** `5 minutes` → **Save**. The worker pings every minute only while all its jobs and store monitors are healthy, and sends a "fail" signal with the reason otherwise.
3. Copy the check's **ping URL**, like `https://hc-ping.com/1234abcd-…`.
4. Terminal (`workers` folder): `fly secrets set HEALTHCHECK_URL="https://hc-ping.com/…"`.
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

## Step 14 · Legal (before announcing)
1. Have an Australian lawyer review the **Terms**, **Privacy Policy** and **Marketplace rules**. They're drafts, marked noindex. Ask them to cover:
   - member-submitted sightings and photos (the licence to display them, and a no-photos-of-people rule)
   - scout rewards (free Premium isn't a prize draw, but check the wording)
   - Spam Act compliance for alerts. Consent and unsubscribe links are already built in.
   - PriceCharting's display permission (Step 9) and card images (Step 9c)
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
| Worker logs show `password authentication failed` | The password in `DATABASE_URL` is wrong. Reset it in Supabase (7c), then `fly secrets set DATABASE_URL="…"`. |
| healthchecks.io says the check is down | Run `fly status` and `fly logs` in the `workers` folder and send Claude what you see. |

## What to send Claude, in order
1. "I'm admin" (3g)
2. "push keys added" (6)
3. "workers deployed", then "monitor check" (7d, 7e)
4. "PriceCharting subscribed" and, later, their reply about display rights (9)
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
| PriceCharting Legendary | US$49/mo |
| Scrydex (if you choose images) | US$29/mo |
| Stripe | 1.7% + A$0.30 per domestic card payment, plus 0.7% Billing |
| Web push, Discord, Sentry, healthchecks.io | Free |
