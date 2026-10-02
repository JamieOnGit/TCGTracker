-- The main market figure is now each card's raw (ungraded, Near Mint)
-- market price from JustTCG, built from recent real sales. PSA 10 stays as
-- its own column and grade view. Until licensed population counts exist,
-- rankings are by that price (market.rank_by_price_until_population).
--
-- JustTCG only returns raw and graded variants together on single-card
-- lookups, so each set is fetched twice (graded, then raw): the request
-- budget per run goes up to fit (Professional plan: 5,000 a day).

update public.site_settings
   set value = 'true',
       description = 'Store Near Mint raw prices (the main market price). Raw prices only attach to cards already on the site.'
 where key = 'justtcg.raw_prices';

update public.site_settings
   set value = '2500'
 where key = 'justtcg.max_requests_per_run' and value = '1500'::jsonb;

update public.site_settings
   set value = '"raw"',
       description = 'Grade shown by default on the market cap view: raw = the ungraded card''s market price'
 where key = 'market.primary_grade' and value = '"psa-10"'::jsonb;
