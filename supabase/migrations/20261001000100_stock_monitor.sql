-- Live stock monitor across many Australian stores (owner request 2026-10-01,
-- modelled on CardWatch's stock activity page).
--
-- 1. Retailers carry a platform (shopify / woocommerce / custom) and a config
--    (collections, categories, keywords), so one generic adapter can monitor
--    any store that publishes its catalogue as JSON. Stores that block
--    automated access are recorded with blocked_reason and never worked around.
-- 2. retail_products keep their current availability and price (maintained
--    from retail_product_states), so "in stock now" and product pages are a
--    single query.
-- 3. Retail listings are grouped into sealed_products (one product page per
--    sealed product, e.g. "Prismatic Evolutions Elite Trainer Box (EN)").
-- 4. "Notify me" product watches: a watcher is alerted about that product at
--    any store, whatever their other filters, with the usual tier timing.

-- ------------------------------------------------------------- retailers
alter table public.retailers
  add column if not exists platform text not null default 'custom'
    check (platform in ('custom', 'shopify', 'woocommerce', 'none')),
  add column if not exists config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  add column if not exists kind text
    check (kind in ('specialist', 'big-box', 'toy', 'department', 'marketplace', 'official', 'other')),
  add column if not exists state public.au_state,
  add column if not exists blocked_reason text check (char_length(blocked_reason) <= 200),
  add column if not exists last_checked_at timestamptz;

update public.retailers set platform = 'none' where adapter = 'none';
update public.retailers set kind = case slug
    when 'jb-hi-fi' then 'big-box' when 'kmart' then 'big-box' when 'big-w' then 'big-box'
    when 'target-au' then 'big-box' when 'eb-games' then 'big-box' when 'costco-au' then 'big-box'
    when 'officeworks' then 'big-box' when 'woolworths' then 'big-box' when 'coles' then 'big-box'
    when 'myer' then 'department' when 'amazon-au' then 'marketplace' when 'toymate' then 'toy'
    when 'zing-pop-culture' then 'specialist' when 'local-game-store' then 'specialist'
    when 'premium-bandai-au' then 'official' else kind end
where kind is null;

-- ------------------------------------------------------ sealed products
alter table public.sealed_products
  add column if not exists auto_created boolean not null default false,
  add column if not exists updated_by_matcher_at timestamptz;

-- --------------------------------------------- retail products: current
alter table public.retail_products
  add column if not exists lang text references public.languages (code),
  add column if not exists image_url text check (image_url ~ '^https://' and char_length(image_url) <= 1000),
  add column if not exists current_availability public.availability not null default 'unknown',
  add column if not exists current_price_aud numeric(10, 2),
  add column if not exists last_change_at timestamptz,
  add column if not exists match_confidence numeric(4, 3);
create index if not exists retail_products_sealed_idx on public.retail_products (sealed_product_id);
create index if not exists retail_products_in_stock_idx on public.retail_products (last_change_at desc)
  where current_availability in ('in_stock_online', 'in_stock_cnc', 'in_stock_both', 'preorder');

create or replace function public.retail_product_states_current() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.retail_products
     set current_availability = new.availability,
         current_price_aud = new.price_aud,
         last_change_at = new.observed_at
   where id = new.retail_product_id
     and (last_change_at is null or last_change_at <= new.observed_at);
  return null;
end $$;
drop trigger if exists retail_product_states_current on public.retail_product_states;
create trigger retail_product_states_current after insert on public.retail_product_states
  for each row execute function public.retail_product_states_current();

-- Backfill from existing state history.
update public.retail_products p
   set current_availability = s.availability, current_price_aud = s.price_aud, last_change_at = s.observed_at
  from (select distinct on (retail_product_id) retail_product_id, availability, price_aud, observed_at
          from public.retail_product_states order by retail_product_id, observed_at desc) s
 where s.retail_product_id = p.id;

-- ---------------------------------------- drop events: product grouping
alter table public.sightings
  add column if not exists sealed_product_id uuid references public.sealed_products (id) on delete set null;
alter table public.drop_events
  add column if not exists sealed_product_id uuid references public.sealed_products (id) on delete set null;
create index if not exists drop_events_sealed_idx on public.drop_events (sealed_product_id, occurred_at desc);

create or replace function public.drop_events_fill_source() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.retail_product_id is not null then
    select retailer_id, game, sealed_product_id into new.retailer_id, new.game, new.sealed_product_id
    from public.retail_products where id = new.retail_product_id;
  else
    select retailer_id, game, sealed_product_id into new.retailer_id, new.game, new.sealed_product_id
    from public.sightings where id = new.sighting_id;
  end if;
  return new;
end $$;
update public.drop_events e set sealed_product_id = p.sealed_product_id
  from public.retail_products p where p.id = e.retail_product_id and e.sealed_product_id is null;

-- ------------------------------------------------------- product watches
create table public.product_watches (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sealed_product_id uuid not null references public.sealed_products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sealed_product_id)
);
alter table public.product_watches enable row level security;
create index product_watches_product_idx on public.product_watches (sealed_product_id);
create policy "product_watches: owner" on public.product_watches for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Public watcher counts ("142 collectors watching") without exposing who.
create or replace function public.product_watch_count(p_sealed_product uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.product_watches where sealed_product_id = p_sealed_product
$$;
grant execute on function public.product_watch_count(uuid) to anon, authenticated;

-- ------------------------------------------- fan-out: watchers + filters
create or replace function public.enqueue_drop_alerts(p_event bigint) returns integer
language plpgsql security definer set search_path = public as $$
declare
  e record;
  u record;
  ch text;
  v_n integer := 0;
  v_tier public.tier;
  v_free_delay integer := coalesce(public.setting_int('drops.free_delay_minutes'), 1440);
  v_free_on boolean := public.setting_bool('drops.free_delayed_alerts');
begin
  select d.*, r.slug as retailer_slug,
         lower(coalesce(p.title, s.product)) as title_lc,
         s.id as s_id, s.channel as s_channel, s.state as s_state
    into e
  from public.drop_events d
  left join public.retail_products p on p.id = d.retail_product_id
  left join public.sightings s on s.id = d.sighting_id
  join public.retailers r on r.id = d.retailer_id
  where d.id = p_event;
  if e.id is null or e.suppressed then
    return 0;
  end if;
  for u in
    select pr.id as user_id, f.games, f.retailer_slugs, f.event_types, f.only_at_or_below_rrp,
           f.states, f.keywords, f.max_price_aud, coalesce(f.include_sightings, true) as include_sightings,
           (e.sealed_product_id is not null and exists (
              select 1 from public.product_watches w
              where w.user_id = pr.id and w.sealed_product_id = e.sealed_product_id)) as watching
    from public.profiles pr
    join public.profile_private pp on pp.user_id = pr.id and pp.status = 'active'
    left join public.drop_alert_filters f on f.user_id = pr.id
  loop
    -- An explicit "Notify me" on this product beats the general filters.
    if not u.watching then
      if u.games is not null and e.game is not null and not (e.game = any (u.games)) then continue; end if;
      if u.retailer_slugs is not null and not (e.retailer_slug = any (u.retailer_slugs)) then continue; end if;
      if u.event_types is not null and not (e.event_type::text = any (u.event_types)) then continue; end if;
      if coalesce(u.only_at_or_below_rrp, false) and e.rrp_tag = 'ABOVE_RRP' then continue; end if;
      if u.max_price_aud is not null and e.price_aud is not null and e.price_aud > u.max_price_aud then continue; end if;
      if e.s_id is not null and not u.include_sightings then continue; end if;
      if e.s_channel = 'in_store' and u.states is not null and not (e.s_state = any (u.states)) then continue; end if;
      if u.keywords is not null and cardinality(u.keywords) > 0
         and not exists (select 1 from unnest(u.keywords) k where e.title_lc like '%' || lower(k) || '%') then continue; end if;
    end if;
    v_tier := public.effective_tier(u.user_id);
    if v_tier = 'free' and not v_free_on then continue; end if;
    foreach ch in array array['email', 'onsite', 'discord', 'push'] loop
      if not public.wants_notification(u.user_id, 'drop', ch) then continue; end if;
      if ch = 'push' and not exists (select 1 from public.push_subscriptions ps where ps.user_id = u.user_id) then continue; end if;
      insert into public.drop_alert_deliveries (drop_event_id, user_id, channel, tier_at_enqueue, deliver_at)
      values (e.id, u.user_id, ch, v_tier,
              case when v_tier = 'premium' then e.occurred_at else e.occurred_at + make_interval(mins => v_free_delay) end)
      on conflict do nothing;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
revoke execute on function public.enqueue_drop_alerts(bigint) from anon, authenticated;

-- ------------------------------------------------------------ settings
insert into public.site_settings (key, value, description, is_public) values
  ('stock.show_retailer_images', 'false', 'Show retailers'' product photos on stock pages (off until image rights are settled)', true),
  ('stock.default_interval_seconds', '120', 'Default check interval for newly added stores', true),
  ('drops.price_drop_pct', '5', 'Price-drop alerts only for drops of at least this percent', true)
on conflict (key) do nothing;
