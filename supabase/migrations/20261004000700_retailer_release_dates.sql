-- Release dates from every Australian store we monitor, not only JB Hi-Fi.
--
-- Stores publish street dates in product titles and descriptions ("Delta
-- Reign Booster Box (Releases 6 Nov 2026)", "Release Date: 06-November-2026",
-- "Releases Dec 2026"). The drop monitor now reads them for Shopify and
-- WooCommerce stores too; a month without a day is kept with 'month'
-- precision. The releases job groups them into the release calendar.
alter table public.retail_products
  add column if not exists release_date_precision text not null default 'day'
    check (release_date_precision in ('day', 'month'));
