-- Drop-alert delivery retries (workers/tcgworkers/drops/dispatcher.py).
--
-- * attempts: a failed delivery (Discord down, DB hiccup) stays 'queued'
--   with deliver_at pushed back exponentially; after the last attempt it
--   becomes 'failed' and an admin alert is emailed. Nothing fails silently.
-- * discord_posted_at: the premium Discord channel gets one post per event,
--   however many members have Discord delivery switched on.

alter table public.drop_alert_deliveries
  add column if not exists attempts integer not null default 0;

alter table public.drop_events
  add column if not exists discord_posted_at timestamptz;
