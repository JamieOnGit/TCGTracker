-- Market data (brief 4). The pipelines that FILL these tables are gated on
-- Jamie approving the population and pricing sources (brief 14.1, 14.2); the
-- tables themselves are source-agnostic.
--
-- Grades are (grader, grade). grade_key is the canonical string form used in
-- URLs, config and joins: 'psa-10', 'psa-9', 'bgs-9.5', 'raw'.

create or replace function public.grade_key(p_grader text, p_grade numeric) returns text
language sql immutable as $$
  select case
    when p_grader is null then 'raw'
    else lower(p_grader) || '-' || trim_scale(p_grade)::text
  end
$$;

create table public.fx_rates (
  currency char(3) not null,
  date date not null,
  rate_to_aud numeric(14, 8) not null check (rate_to_aud > 0),
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (currency, date)
);
alter table public.fx_rates enable row level security;

create table public.population_snapshots (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards (id) on delete cascade,
  grader text not null default 'PSA',
  grade numeric(3, 1) not null,
  grade_key text generated always as (public.grade_key(grader, grade)) stored,
  population integer not null check (population >= 0),
  source text not null,
  captured_at timestamptz not null default now()
);
alter table public.population_snapshots enable row level security;
create index population_snapshots_card_idx on public.population_snapshots (card_id, grade_key, captured_at desc);

create type public.price_type as enum ('ask', 'sold');

create table public.price_points (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards (id) on delete cascade,
  grader text,
  grade numeric(3, 1),
  grade_key text generated always as (public.grade_key(grader, grade)) stored,
  type public.price_type not null,
  price numeric(12, 2) not null check (price > 0),
  currency char(3) not null,
  fx_rate numeric(14, 8) not null check (fx_rate > 0),
  fx_date date not null,
  price_aud numeric(12, 2) not null check (price_aud > 0),
  source text not null,              -- 'marketplace' or an approved external source
  source_ref text,                   -- listing id / external record id
  url text,
  observed_at timestamptz not null,
  is_excluded boolean not null default false,
  excluded_reason text,
  excluded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((grader is null) = (grade is null))
);
alter table public.price_points enable row level security;
create index price_points_card_idx on public.price_points (card_id, grade_key, type, observed_at desc);
create unique index price_points_source_ref_idx on public.price_points (source, source_ref, type, observed_at)
  where source_ref is not null;

create type public.floor_basis as enum ('marketplace_ask', 'external_ask', 'last_sale');

-- Current floor per card+grade, with the metadata the methodology page
-- promises: source, timestamp, sample size.
create table public.floor_prices (
  card_id uuid not null references public.cards (id) on delete cascade,
  grade_key text not null,
  floor_aud numeric(12, 2) not null check (floor_aud > 0),
  basis public.floor_basis not null,
  source text not null,
  sample_size integer not null default 0,
  outliers_ignored integer not null default 0,
  last_sold_aud numeric(12, 2),
  last_sold_at timestamptz,
  median_sold_30d_aud numeric(12, 2),
  observed_at timestamptz not null,  -- timestamp of the price the floor came from
  computed_at timestamptz not null default now(),
  primary key (card_id, grade_key)
);
alter table public.floor_prices enable row level security;

create table public.market_cap_snapshots (
  card_id uuid not null references public.cards (id) on delete cascade,
  grade_key text not null,
  date date not null,
  population integer not null,
  floor_aud numeric(12, 2) not null,
  basis public.floor_basis not null,
  market_cap_aud numeric(16, 2) not null,
  fx_date date,
  primary key (card_id, grade_key, date)
);
alter table public.market_cap_snapshots enable row level security;
create index market_cap_snapshots_date_idx on public.market_cap_snapshots (date, grade_key, market_cap_aud desc);

-- Pipeline health for the admin "Market data" screen.
create table public.pipeline_runs (
  id bigint generated always as identity primary key,
  job text not null,                 -- fx | population | prices | floors | snapshots | drops:<retailer>
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error text
);
alter table public.pipeline_runs enable row level security;
create index pipeline_runs_job_idx on public.pipeline_runs (job, started_at desc);

-- Latest population per card+grade.
create view public.population_current with (security_invoker = true) as
select distinct on (card_id, grade_key)
  card_id, grader, grade, grade_key, population, source, captured_at
from public.population_snapshots
order by card_id, grade_key, captured_at desc;

-- The ranking the homepage renders. Cards with no floor are excluded
-- (brief 4.2: "show — and exclude the card from ranking"), as are cards an
-- admin excluded. Refreshed by the snapshot job; unique index allows
-- REFRESH ... CONCURRENTLY.
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
  cur.date as as_of,
  (select m7.market_cap_aud from public.market_cap_snapshots m7
    where m7.card_id = cur.card_id and m7.grade_key = cur.grade_key and m7.date <= cur.date - 7
    order by m7.date desc limit 1) as market_cap_7d_ago,
  (select m30.market_cap_aud from public.market_cap_snapshots m30
    where m30.card_id = cur.card_id and m30.grade_key = cur.grade_key and m30.date <= cur.date - 30
    order by m30.date desc limit 1) as market_cap_30d_ago,
  (select m1.market_cap_aud from public.market_cap_snapshots m1
    where m1.card_id = cur.card_id and m1.grade_key = cur.grade_key and m1.date <= cur.date - 1
    order by m1.date desc limit 1) as market_cap_1d_ago
from cur
join public.cards c on c.id = cur.card_id
where not c.is_excluded and cur.market_cap_aud > 0;

create unique index market_cap_rankings_pk on public.market_cap_rankings (card_id, grade_key);
create index market_cap_rankings_sort_idx on public.market_cap_rankings (grade_key, market_cap_aud desc);

-- Materialized views can't carry RLS; expose read-only access explicitly.
revoke all on public.market_cap_rankings from anon, authenticated;
grant select on public.market_cap_rankings to anon, authenticated;

-- --------------------------------------------------------------- policies
create policy "fx: public read" on public.fx_rates for select using (true);
create policy "population: public read" on public.population_snapshots for select using (true);
create policy "price_points: public read of non-excluded" on public.price_points for select
  using (not is_excluded or public.has_role('admin'));
create policy "price_points: admin updates (exclude/override)" on public.price_points for update
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "floor_prices: public read" on public.floor_prices for select using (true);
create policy "market_cap_snapshots: public read" on public.market_cap_snapshots for select using (true);
create policy "pipeline_runs: admin read" on public.pipeline_runs for select using (public.has_role('admin'));
-- All writes to these tables come from the workers using the service role,
-- which bypasses RLS. No insert policies = no user writes.
