-- Retail drop alerts (brief 9). Written by the Python drop monitors using the
-- service role. Instant events are Premium-only; everyone else sees them
-- after drops.public_delay_minutes (public_at).

create type public.drop_event_type as enum ('NEW_LISTING', 'PREORDER_OPEN', 'IN_STOCK', 'PRICE_CHANGE', 'QUEUE_LIVE');
create type public.rrp_tag as enum ('AT_RRP', 'BELOW_RRP', 'ABOVE_RRP', 'UNKNOWN');
create type public.availability as enum ('unknown', 'out_of_stock', 'preorder', 'in_stock_online', 'in_stock_cnc', 'in_stock_both');

create table public.retailers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  base_url text not null,
  adapter text not null,             -- python adapter module name
  enabled boolean not null default false,
  watch_interval_seconds integer not null default 90 check (watch_interval_seconds >= 30),
  discovery_interval_seconds integer not null default 1800 check (discovery_interval_seconds >= 300),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  consecutive_errors integer not null default 0,
  zero_product_cycles integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.retailers enable row level security;

-- Seeded disabled: each adapter is switched on only after its ToS/robots
-- review is signed off (docs/research/04-retailers.md).
insert into public.retailers (slug, name, base_url, adapter) values
  ('premium-bandai-au', 'Premium Bandai AU', 'https://p-bandai.com/au', 'premium_bandai_au'),
  ('jb-hi-fi', 'JB Hi-Fi', 'https://www.jbhifi.com.au', 'jb_hi_fi'),
  ('eb-games', 'EB Games', 'https://www.ebgames.com.au', 'eb_games'),
  ('big-w', 'BIG W', 'https://www.bigw.com.au', 'big_w'),
  ('kmart', 'Kmart', 'https://www.kmart.com.au', 'kmart');

create table public.retail_products (
  id bigint generated always as identity primary key,
  retailer_id uuid not null references public.retailers (id) on delete cascade,
  sku text not null,
  url text not null,
  title text not null,
  game text references public.games (code),
  sealed_product_id uuid references public.sealed_products (id) on delete set null,
  product_type text,                 -- booster-box, etb, ...
  set_code text,
  is_marketplace_seller boolean not null default false, -- third-party seller on the retailer site
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (retailer_id, sku)
);
alter table public.retail_products enable row level security;

-- State history: one row per observed change (brief 9.3).
create table public.retail_product_states (
  id bigint generated always as identity primary key,
  retail_product_id bigint not null references public.retail_products (id) on delete cascade,
  availability public.availability not null,
  price_aud numeric(10, 2),
  queue_live boolean not null default false,
  observed_at timestamptz not null default now(),
  raw jsonb
);
alter table public.retail_product_states enable row level security;
create index retail_product_states_idx on public.retail_product_states (retail_product_id, observed_at desc);

create table public.rrp_reference (
  id bigint generated always as identity primary key,
  game text not null references public.games (code),
  lang text references public.languages (code),
  product_type text not null,
  set_code text,                     -- null = default for this product type
  sealed_product_id uuid references public.sealed_products (id) on delete cascade,
  rrp_aud numeric(10, 2) not null check (rrp_aud > 0),
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.rrp_reference enable row level security;
create unique index rrp_reference_key_idx on public.rrp_reference
  (game, coalesce(lang, '*'), product_type, coalesce(set_code, '*'));

create table public.drop_events (
  id bigint generated always as identity primary key,
  retail_product_id bigint not null references public.retail_products (id) on delete cascade,
  event_type public.drop_event_type not null,
  price_aud numeric(10, 2),
  previous_price_aud numeric(10, 2),
  rrp_aud numeric(10, 2),
  rrp_tag public.rrp_tag not null default 'UNKNOWN',
  rrp_delta_pct numeric(6, 2),
  dedupe_key text not null unique,   -- retailer:sku:event:state-hash, so a flapping page can't double-alert
  occurred_at timestamptz not null default now(),
  public_at timestamptz not null,
  alerted_at timestamptz,
  suppressed boolean not null default false,
  suppressed_reason text,
  manual boolean not null default false,
  created_by uuid references public.profiles (id)
);
alter table public.drop_events enable row level security;
create index drop_events_public_idx on public.drop_events (public_at desc) where not suppressed;
create index drop_events_occurred_idx on public.drop_events (occurred_at desc);

create or replace function public.drop_events_set_public_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.public_at is null then
    new.public_at := new.occurred_at + make_interval(mins => public.setting_int('drops.public_delay_minutes'));
  end if;
  return new;
end $$;
create trigger drop_events_public_at before insert on public.drop_events
  for each row execute function public.drop_events_set_public_at();

create table public.watchlist (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('include_keyword', 'exclude_keyword', 'set_code', 'sku', 'url')),
  value text not null,
  game text references public.games (code),
  retailer_id uuid references public.retailers (id) on delete cascade,
  priority boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, value, retailer_id)
);
alter table public.watchlist enable row level security;

insert into public.watchlist (kind, value, game) values
  ('include_keyword', 'one piece card game', 'one-piece'),
  ('include_keyword', 'pokemon tcg', 'pokemon'),
  ('include_keyword', 'pokémon tcg', 'pokemon'),
  ('include_keyword', 'pokemon trading card game', 'pokemon'),
  ('include_keyword', 'elite trainer box', 'pokemon'),
  ('include_keyword', 'booster box', null),
  ('include_keyword', 'booster bundle', 'pokemon'),
  ('include_keyword', 'booster pack', null),
  ('set_code', 'OP-', 'one-piece'),
  ('set_code', 'EB-', 'one-piece'),
  ('set_code', 'PRB-', 'one-piece'),
  ('set_code', 'ST-', 'one-piece'),
  ('exclude_keyword', 'plush', null),
  ('exclude_keyword', 'figure', null),
  ('exclude_keyword', 'nintendo switch', null),
  ('exclude_keyword', 'video game', null),
  ('exclude_keyword', 't-shirt', null),
  ('exclude_keyword', 'hoodie', null),
  ('exclude_keyword', 'costume', null),
  ('exclude_keyword', 'lego', null),
  ('exclude_keyword', 'sleeves', null),
  ('exclude_keyword', 'binder', null);

-- --------------------------------------------------------------- policies
create policy "retailers: public read" on public.retailers for select using (true);
create policy "retailers: admin write" on public.retailers for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "retail_products: public read" on public.retail_products for select using (true);
create policy "retail_product_states: premium or admin read" on public.retail_product_states for select
  using (public.is_premium(auth.uid()) or public.has_role('admin'));

-- The paywall lives here, not only in the UI: non-Premium readers simply
-- cannot select an event before its public_at.
create policy "drop_events: delayed public, instant premium" on public.drop_events for select
  using (
    (not suppressed and public_at <= now())
    or (not suppressed and public.is_premium(auth.uid()))
    or public.has_role('admin')
  );
create policy "drop_events: admin manual send" on public.drop_events for insert
  with check (public.has_role('admin') and manual);

create policy "rrp_reference: public read" on public.rrp_reference for select using (true);
create policy "rrp_reference: admin write" on public.rrp_reference for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "watchlist: admin" on public.watchlist for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
