# Shutting TCGTracker down (Oct 2026)

The code side is done: the workers now start, log "TCGTracker is shut down"
and exit, and Fly is told never to restart them. That stops every job
(prices, floors, pictures, releases, emails, alerts, eBay deals) and every
store/drop monitor. What's left is switching off the paid services, in this
order.

## 1 · Stop the workers (Fly.io) — do this first
After merging the shutdown PR, in a terminal:
```
cd ~/TCGTracker
git checkout main
git pull
cd workers
fly deploy
fly scale count 0
```
`fly scale count 0` removes the machine, so nothing can run or bill. To delete
the app completely instead: `fly apps destroy tcgtracker-workers` (type the
name to confirm). Then **fly.io → Billing**: check there's nothing else
running, and remove your card if you want.

## 2 · Stripe (Premium A$12.99/mo) — before anything else touches the site
Members are still billed every month until their subscriptions are cancelled.
**dashboard.stripe.com → Billing → Subscriptions**: filter **Active**, select
all, **Cancel subscriptions → Immediately** (refund the current period if you
want). Then **Developers → Webhooks**: delete the TCGTracker endpoint. Close
the account under **Settings → Business → Close account** if you won't use it.

## 3 · JustTCG (US$49/mo)
justtcg.com → sign in → **Account / Billing → Cancel subscription**. Then
delete the API key.

## 4 · Scrydex (US$29/mo, only if you subscribed)
scrydex.com → **Account → Billing → Cancel**, and delete the API key.

## 5 · Supabase (database, Free or US$25/mo Pro)
**Optional first:** download a backup (**Database → Backups**, or Project
Settings → Database → connection string with `pg_dump`) if you might want the
data again. Members' emails are personal data, so don't keep a copy you don't
need.
- Pro plan: **Organization → Billing → Change plan → Free** (stops the
  US$25/mo), or
- delete it outright: **Project Settings → General → Delete project**.

## 6 · Cloudflare (website, Workers Paid US$5/mo)
**Workers & Pages → tcgtracker → Settings → Delete** (the site goes offline).
Then **Account → Billing → Subscriptions → Workers Paid → Cancel**. If you
want a simple "closed" page instead of an error, ask Claude for a one-page
replacement before deleting.

## 7 · Resend (email, Free or US$20/mo)
resend.com → **Settings → Billing → downgrade to Free** (or delete the
account). Delete the API key and the tcgtracker.com.au domain.

## 8 · Free services (no cost, tidy up when you like)
- **healthchecks.io**: delete the `tcgtracker-workers` check, otherwise it
  emails you that the worker is down.
- **Sentry**: delete the `tcgtracker-workers` / `tcgtracker-web` projects.
- **Discord**: delete the `TCGTracker Drops` webhook (or the server).
- **eBay developer**: delete the app keys (developer.ebay.com → Application Keys).
- **Web push (VAPID)**: nothing to cancel.
- **GitHub**: CI only runs on pull requests and Deploy database only by hand,
  so nothing runs on its own. Archive the repo (**Settings → Archive this
  repository**) if you like.

## 9 · Domain (VentraIP, ~A$20–30/yr)
VentraIP → **Domains → tcgtracker.com.au → Auto-renew: Off**. It lapses at its
renewal date. Keep it longer if you'd rather nobody else used the name.

## Bringing it back later
Set `SHUT_DOWN = False` in `workers/tcgworkers/main.py`, set the restart
policy in `workers/fly.toml` back to `"always"`, re-create the services above
and follow `docs/YOUR-NEXT-STEPS.md`.
