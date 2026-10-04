-- Every card in every set, not only the ones with graded sales.
--
-- 1. The JustTCG import creates cards from raw (ungraded) prices too
--    (justtcg.raw_discover). Most of a new set has no graded sales yet, so
--    until now those cards never appeared.
-- 2. Rankings come from the current prices (floor_prices), so every priced
--    card is ranked; daily snapshots are only kept for the change columns and
--    value charts, and only for cards worth market.snapshot_min_aud or more
--    (the snapshots job also thins snapshots older than 60 days to weekly).
--    A daily snapshot of tens of thousands of A$0.20 commons would fill the
--    database for no use.
-- 3. A year of price history is only backfilled for cards worth
--    justtcg.history_min_aud or more, for the same reason.
-- 4. sitemap_cards() pages through every card in one request per sitemap
--    file (Google's limit is 50,000 addresses a file).

insert into public.site_settings (key, value, description, is_public) values
  ('justtcg.raw_discover', 'true', 'Add cards from raw (ungraded) prices too, so every card in a set appears, not only graded ones', false),
  ('justtcg.history_min_aud', '10', 'Backfill a year of price history only for cards worth at least this (A$)', false),
  ('market.snapshot_min_aud', '5', 'Keep daily value history (charts, 24h/7d/30d change) for cards worth at least this (A$)', false)
on conflict (key) do nothing;

update public.site_settings
   set description = 'Store Near Mint raw prices (the main market price)'
 where key = 'justtcg.raw_prices';

drop materialized view public.market_cap_rankings;

create materialized view public.market_cap_rankings as
with today as (select (now() at time zone 'Australia/Melbourne')::date as d)
select
  f.card_id,
  f.grade_key,
  c.game,
  c.lang,
  c.set_id,
  p.population,
  f.floor_aud,
  f.basis,
  round(p.population * f.floor_aud, 2) as market_cap_aud,
  -- One sort key for both modes: market cap when known, else value.
  coalesce(round(p.population * f.floor_aud, 2), f.floor_aud) as rank_value,
  (f.observed_at at time zone 'Australia/Melbourne')::date as as_of,
  (select m.floor_aud from public.market_cap_snapshots m
    where m.card_id = f.card_id and m.grade_key = f.grade_key and m.date <= today.d - 1 order by m.date desc limit 1) as floor_1d_ago,
  (select m.floor_aud from public.market_cap_snapshots m
    where m.card_id = f.card_id and m.grade_key = f.grade_key and m.date <= today.d - 7 order by m.date desc limit 1) as floor_7d_ago,
  (select m.floor_aud from public.market_cap_snapshots m
    where m.card_id = f.card_id and m.grade_key = f.grade_key and m.date <= today.d - 30 order by m.date desc limit 1) as floor_30d_ago,
  (select m.market_cap_aud from public.market_cap_snapshots m
    where m.card_id = f.card_id and m.grade_key = f.grade_key and m.date <= today.d - 1 order by m.date desc limit 1) as market_cap_1d_ago,
  (select m.market_cap_aud from public.market_cap_snapshots m
    where m.card_id = f.card_id and m.grade_key = f.grade_key and m.date <= today.d - 7 order by m.date desc limit 1) as market_cap_7d_ago,
  (select m.market_cap_aud from public.market_cap_snapshots m
    where m.card_id = f.card_id and m.grade_key = f.grade_key and m.date <= today.d - 30 order by m.date desc limit 1) as market_cap_30d_ago,
  (select array_agg(m.floor_aud order by m.date) from public.market_cap_snapshots m
    where m.card_id = f.card_id and m.grade_key = f.grade_key and m.date > today.d - 8) as spark_7d
from public.floor_prices f
cross join today
join public.cards c on c.id = f.card_id
left join public.population_current p on p.card_id = f.card_id and p.grade_key = f.grade_key
where not c.is_excluded
  and f.floor_aud > 0
  and (p.population is not null or public.setting_bool('market.rank_by_price_until_population'));

create unique index market_cap_rankings_pk on public.market_cap_rankings (card_id, grade_key);
create index market_cap_rankings_sort_idx on public.market_cap_rankings (grade_key, rank_value desc);
revoke all on public.market_cap_rankings from anon, authenticated;
grant select on public.market_cap_rankings to anon, authenticated;

-- One sitemap file's cards: page path parts, last change, and whether the
-- card has active marketplace listings (its marketplace page is only
-- indexable then). Returns one JSON array, so a single request fetches a
-- whole file regardless of the API's row limit.
create or replace function public.sitemap_cards(p_offset integer, p_limit integer)
returns json
language sql stable security invoker set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'game', x.game, 'lang', x.lang, 'set', x.set_slug, 'slug', x.slug, 'updated', x.updated_at,
           'listed', x.listed) order by x.id), '[]'::json)
  from (
    select c.id, c.game, c.lang, s.slug as set_slug, c.slug, c.updated_at,
           exists (select 1 from public.listings l where l.card_id = c.id and l.status = 'active') as listed
      from public.cards c join public.sets s on s.id = c.set_id
     where not c.is_excluded
     order by c.id
     offset greatest(p_offset, 0) limit least(greatest(p_limit, 0), 25000)
  ) x
$$;
grant execute on function public.sitemap_cards(integer, integer) to anon, authenticated;

create or replace function public.sitemap_card_count()
returns integer
language sql stable security invoker set search_path = public as $$
  select count(*)::integer from public.cards where not is_excluded
$$;
grant execute on function public.sitemap_card_count() to anon, authenticated;
