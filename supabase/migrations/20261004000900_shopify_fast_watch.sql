-- Faster restock detection for Shopify stores.
--
-- The drop monitor now re-reads the first page of each Shopify collection
-- (where stores list new, featured and best-selling stock) every minute, and
-- the whole catalogue every 5 minutes. All Shopify stores share one polite
-- request budget that tunes itself to what Shopify accepts, and each shop
-- still sees about one request a minute from us.
update public.retailers
   set watch_interval_seconds = 60
 where platform = 'shopify'
   and watch_interval_seconds = 120;

-- Stores added later from the admin page start at the same pace.
update public.site_settings
   set value = '60'::jsonb
 where key = 'stock.default_interval_seconds'
   and value = '120'::jsonb;
