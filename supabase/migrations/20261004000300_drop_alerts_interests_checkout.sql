-- Drop alerts: only what each member follows, one-tap checkout links, and a
-- faster JB Hi-Fi check.
--
-- 1. Interests. Until now every member was alerted to every drop unless they
--    narrowed it down. Now the default is 'interests': a member hears about
--      * products they tapped "Notify me" on (as before, always),
--      * drops whose title matches a set or keyword they follow,
--      * product types they follow (e.g. booster boxes, Elite Trainer Boxes),
--    still narrowed by their games, stores, states, price cap and RRP filter.
--    'everything' keeps the old behaviour (every drop matching the filters).
--    Every member starts on 'interests' and gets one on-site notice asking
--    them to choose what to follow.
-- 2. retail_products.cart_url: the store's own link that adds the item to the
--    cart and opens checkout (Shopify cart permalink, e.g. JB Hi-Fi's
--    /cart/{variant}:1). Alerts and stock pages link straight to it.
-- 3. JB Hi-Fi: every product we know there is re-checked every 30 s (one
--    search request covers them all), so restocks are caught within
--    seconds. Brand-new listings stay on the 5-minute discovery pass.

alter table public.retail_products
  add column if not exists cart_url text check (cart_url is null or cart_url ~ '^https://');

alter table public.drop_alert_filters
  add column if not exists mode text not null default 'interests' check (mode in ('interests', 'everything')),
  add column if not exists product_types text[] check (product_types is null or cardinality(product_types) <= 30);

update public.drop_alert_filters set mode = 'interests' where mode is distinct from 'interests';

-- One notice per active member (no email: the bell only).
insert into public.notifications (user_id, type, title, body, url, data)
select pr.id, 'system',
       'Drop alerts now follow your interests',
       'You’ll only be alerted to the sets, products and product types you follow. Choose yours in 1 minute.',
       '/account/alerts/drops/',
       jsonb_build_object('notice', 'drop-interests-2026-10')
  from public.profiles pr
  join public.profile_private pp on pp.user_id = pr.id and pp.status = 'active'
 where not exists (select 1 from public.notifications n
                    where n.user_id = pr.id and n.data ->> 'notice' = 'drop-interests-2026-10');

update public.retailers
   set watch_interval_seconds = 30
 where slug = 'jb-hi-fi' and watch_interval_seconds > 30;

-- ------------------------------------------- fan-out: watchers + interests
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
  v_keyword_hit boolean;
begin
  select d.*, r.slug as retailer_slug,
         lower(coalesce(p.title, s.product)) as title_lc,
         coalesce(sp.type, p.product_type) as product_type,
         s.id as s_id, s.channel as s_channel, s.state as s_state
    into e
  from public.drop_events d
  left join public.retail_products p on p.id = d.retail_product_id
  left join public.sealed_products sp on sp.id = d.sealed_product_id
  left join public.sightings s on s.id = d.sighting_id
  join public.retailers r on r.id = d.retailer_id
  where d.id = p_event;
  if e.id is null or e.suppressed then
    return 0;
  end if;
  for u in
    select pr.id as user_id, f.games, f.retailer_slugs, f.event_types, f.only_at_or_below_rrp,
           f.states, f.keywords, f.max_price_aud, coalesce(f.include_sightings, true) as include_sightings,
           coalesce(f.mode, 'interests') as mode, f.product_types,
           (e.sealed_product_id is not null and exists (
              select 1 from public.product_watches w
              where w.user_id = pr.id and w.sealed_product_id = e.sealed_product_id)) as watching
    from public.profiles pr
    join public.profile_private pp on pp.user_id = pr.id and pp.status = 'active'
    left join public.drop_alert_filters f on f.user_id = pr.id
  loop
    -- An explicit "Notify me" on this product beats everything else.
    if not u.watching then
      v_keyword_hit := u.keywords is not null and cardinality(u.keywords) > 0
        and exists (select 1 from unnest(u.keywords) k where e.title_lc like '%' || lower(k) || '%');
      if u.mode = 'interests' then
        -- Only what the member follows: a set / keyword, or a product type.
        if not (v_keyword_hit
                or (u.product_types is not null and e.product_type is not null and e.product_type = any (u.product_types))) then
          continue;
        end if;
      elsif u.keywords is not null and cardinality(u.keywords) > 0 and not v_keyword_hit then
        continue; -- 'everything': keywords narrow, as before
      end if;
      if u.games is not null and e.game is not null and not (e.game = any (u.games)) then continue; end if;
      if u.retailer_slugs is not null and not (e.retailer_slug = any (u.retailer_slugs)) then continue; end if;
      if u.event_types is not null and not (e.event_type::text = any (u.event_types)) then continue; end if;
      if coalesce(u.only_at_or_below_rrp, false) and e.rrp_tag = 'ABOVE_RRP' then continue; end if;
      if u.max_price_aud is not null and e.price_aud is not null and e.price_aud > u.max_price_aud then continue; end if;
      if e.s_id is not null and not u.include_sightings then continue; end if;
      if e.s_channel = 'in_store' and u.states is not null and not (e.s_state = any (u.states)) then continue; end if;
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

-- 4. The Premium live feed updates the moment a drop is saved (Supabase
--    Realtime applies RLS: only members allowed to see a fresh event get it).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drop_events') then
    alter publication supabase_realtime add table public.drop_events;
  end if;
end $$;
