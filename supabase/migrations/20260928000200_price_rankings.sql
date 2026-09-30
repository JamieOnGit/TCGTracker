-- Rankings that work before licensed population data exists.
--
-- Market cap needs population x floor. PriceCharting gives us floors but no
-- population, so until a population source is licensed the homepage ranks
-- by PSA 10 value (clearly labelled), and switches to market cap
-- automatically for every card that has a population.

alter table public.market_cap_snapshots alter column population drop not null;
alter table public.market_cap_snapshots alter column market_cap_aud drop not null;

drop materialized view public.market_cap_rankings;

create materialized view public.market_cap_rankings as
with latest as (
  select m.*, row_number() over (partition by card_id, grade_key order by date desc) as rn
  from public.market_cap_snapshots m
),
cur as (select * from latest where rn = 1)
select
  cur.card_id,
  cur.grade_key,
  c.game,
  c.lang,
  c.set_id,
  cur.population,
  cur.floor_aud,
  cur.basis,
  cur.market_cap_aud,
  -- One sort key for both modes: market cap when known, else value.
  coalesce(cur.market_cap_aud, cur.floor_aud) as rank_value,
  cur.date as as_of,
  (select m.floor_aud from public.market_cap_snapshots m
    where m.card_id = cur.card_id and m.grade_key = cur.grade_key and m.date <= cur.date - 1 order by m.date desc limit 1) as floor_1d_ago,
  (select m.floor_aud from public.market_cap_snapshots m
    where m.card_id = cur.card_id and m.grade_key = cur.grade_key and m.date <= cur.date - 7 order by m.date desc limit 1) as floor_7d_ago,
  (select m.floor_aud from public.market_cap_snapshots m
    where m.card_id = cur.card_id and m.grade_key = cur.grade_key and m.date <= cur.date - 30 order by m.date desc limit 1) as floor_30d_ago,
  (select m.market_cap_aud from public.market_cap_snapshots m
    where m.card_id = cur.card_id and m.grade_key = cur.grade_key and m.date <= cur.date - 1 order by m.date desc limit 1) as market_cap_1d_ago,
  (select m.market_cap_aud from public.market_cap_snapshots m
    where m.card_id = cur.card_id and m.grade_key = cur.grade_key and m.date <= cur.date - 7 order by m.date desc limit 1) as market_cap_7d_ago,
  (select m.market_cap_aud from public.market_cap_snapshots m
    where m.card_id = cur.card_id and m.grade_key = cur.grade_key and m.date <= cur.date - 30 order by m.date desc limit 1) as market_cap_30d_ago,
  (select array_agg(m.floor_aud order by m.date) from public.market_cap_snapshots m
    where m.card_id = cur.card_id and m.grade_key = cur.grade_key and m.date > cur.date - 8) as spark_7d
from cur
join public.cards c on c.id = cur.card_id
where not c.is_excluded
  and cur.floor_aud > 0
  and (cur.market_cap_aud is not null or public.setting_bool('market.rank_by_price_until_population'));

create unique index market_cap_rankings_pk on public.market_cap_rankings (card_id, grade_key);
create index market_cap_rankings_sort_idx on public.market_cap_rankings (grade_key, rank_value desc);
revoke all on public.market_cap_rankings from anon, authenticated;
grant select on public.market_cap_rankings to anon, authenticated;
