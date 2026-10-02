-- Switch on the Kmart and Target online-store monitors (2 Oct 2026).
--
-- Re-checked against the decision rule in docs/research/07 §C.6: both sites
-- now serve their robots-allowed category and product pages to our honestly
-- identified bot (TCGTrackerBot) with HTTP 200 and no challenge, and robots.txt
-- allows those paths. Nothing here touches Kmart's /api/, search, checkout or
-- accounts, or Target's /search/ or sort/view parameters.
--
-- * Kmart: category ItemList (3 pages) + product pages, new products fetched
--   immediately, known ones refreshed in rotation (adapters/kmart.py).
-- * Target: its two category pages (adapters/target_au.py). Alerts link to the
--   category page until Target consents to deep links (TARGET_DEEP_LINKS_OK).
--
-- BIG W (connection refused to cloud IPs) and EB Games (Cloudflare challenge)
-- stay sightings-only. If either ever serves the honest bot, a later migration
-- switches it on; they are never worked around.
update public.retailers
   set adapter = 'kmart', platform = 'custom', enabled = true, blocked_reason = null,
       watch_interval_seconds = 120, discovery_interval_seconds = 300
 where slug = 'kmart';

update public.retailers
   set adapter = 'target_au', platform = 'custom', enabled = true, blocked_reason = null,
       watch_interval_seconds = 120, discovery_interval_seconds = 300
 where slug = 'target-au';
