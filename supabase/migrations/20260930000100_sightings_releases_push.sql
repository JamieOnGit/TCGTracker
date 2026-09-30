-- Community sightings, release calendar, web push and scout rewards
-- (owner request 2026-09-30, docs/research/08-alert-groups.md).
--
-- 1. Sightings: members report Pokémon / One Piece stock they see in a store
--    or online. A report is confirmed by other members (or a photo plus one
--    member, or a trusted scout, or staff) and then becomes an ordinary
--    drop_event, so it reuses the whole alert pipeline: Premium instant, Free
--    after drops.free_delay_minutes, public history after
--    drops.public_delay_minutes, email / on-site / Discord / push delivery.
--    Nothing here scrapes a retailer.
-- 2. Scout rewards: every N confirmed sightings earns M days of Premium.
-- 3. Alert filters: states (in-store reports), keywords, member reports on/off.
-- 4. Web push: phone / desktop notifications with no app and no SMS cost.
-- 5. Release calendar with reminders and an .ics feed.

insert into public.site_settings (key, value, description, is_public) values
  ('sightings.enabled',                'true',  'Members can report in-store and online sightings', true),
  ('sightings.confirmations_needed',   '2',     'Other members who must confirm a sighting before it alerts', true),
  ('sightings.confirmations_with_photo','1',    'Confirmations needed when the report has a photo', true),
  ('sightings.trusted_after',          '5',     'Confirmed sightings before a scout''s reports alert without confirmation', true),
  ('sightings.trusted_max_reject_pct', '10',    'A scout stays trusted only while at most this percent of their reports were rejected', true),
  ('sightings.daily_limit',            '10',    'Sightings one member may report per 24 hours', false),
  ('sightings.merge_window_minutes',   '180',   'A second report of the same store and game inside this window counts as a confirmation', true),
  ('sightings.pending_expiry_minutes', '360',   'Unconfirmed reports expire after this long', true),
  ('sightings.gone_votes_to_close',    '2',     '"Sold out" votes that mark a sighting as gone', true),
  ('scouts.reward_every',              '10',    'Confirmed sightings per Premium reward', true),
  ('scouts.reward_days',               '30',    'Days of Premium per reward', true)
on conflict (key) do nothing;

-- ------------------------------------------------------- scout rewards
alter table public.profile_private add column if not exists premium_until timestamptz;

create or replace function public.effective_tier(p_user uuid) returns public.tier
language sql stable security definer set search_path = public as $$
  select case
    when pp.tier_override is not null then pp.tier_override
    when s.status in ('active', 'trialing') then 'premium'::public.tier
    when s.status = 'past_due' and s.grace_until is not null and s.grace_until > now() then 'premium'::public.tier
    when pp.premium_until is not null and pp.premium_until > now() then 'premium'::public.tier
    else 'free'::public.tier
  end
  from public.profiles p
  left join public.profile_private pp on pp.user_id = p.id
  left join public.subscriptions s on s.user_id = p.id
  where p.id = p_user
$$;

-- ------------------------------------------------------------ sightings
create table public.sightings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  retailer_id uuid not null references public.retailers (id),
  channel text not null check (channel in ('in_store', 'online')),
  state public.au_state,
  suburb text check (char_length(suburb) between 2 and 60),
  store_name text check (char_length(store_name) <= 80),
  game text not null references public.games (code),
  product text not null check (char_length(product) between 3 and 120),
  price_aud numeric(10, 2) check (price_aud > 0 and price_aud < 10000),
  quantity text check (quantity in ('few', 'some', 'plenty')),
  purchase_limit smallint check (purchase_limit between 1 and 20),
  url text check (url ~ '^https://' and char_length(url) <= 500),
  photo_path text check (char_length(photo_path) <= 300),
  note text check (char_length(note) <= 280),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'expired')),
  confirm_count integer not null default 0,
  gone_count integer not null default 0,
  flag_count integer not null default 0,
  gone_at timestamptz,
  drop_event_id bigint,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reject_reason text check (char_length(reject_reason) <= 200),
  check (channel = 'online' or (state is not null and suburb is not null)),
  check (channel = 'in_store' or url is not null)
);
alter table public.sightings enable row level security;
create index sightings_recent_idx on public.sightings (created_at desc);
create index sightings_pending_idx on public.sightings (status, created_at) where status = 'pending';
create index sightings_user_idx on public.sightings (user_id, created_at desc);
create index sightings_store_idx on public.sightings (retailer_id, state, lower(suburb), game, created_at desc);

create table public.sighting_votes (
  sighting_id bigint not null references public.sightings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  vote text not null check (vote in ('confirm', 'gone', 'fake')),
  created_at timestamptz not null default now(),
  primary key (sighting_id, user_id, vote)
);
alter table public.sighting_votes enable row level security;

-- drop_events can now come from a monitor (retail_product_id) or a member
-- (sighting_id). Exactly one is set.
alter table public.drop_events alter column retail_product_id drop not null;
alter table public.drop_events add column if not exists sighting_id bigint unique references public.sightings (id) on delete cascade;
alter table public.drop_events add constraint drop_events_source_chk
  check ((retail_product_id is not null) <> (sighting_id is not null));
alter table public.sightings add constraint sightings_drop_event_fk
  foreign key (drop_event_id) references public.drop_events (id) on delete set null;

-- Denormalised retailer and game on every event, so feeds can filter one
-- column whether the event came from a monitor or a member.
alter table public.drop_events
  add column if not exists retailer_id uuid references public.retailers (id),
  add column if not exists game text references public.games (code);
update public.drop_events e set retailer_id = p.retailer_id, game = p.game
from public.retail_products p where p.id = e.retail_product_id and e.retailer_id is null;
create index if not exists drop_events_retailer_idx on public.drop_events (retailer_id, occurred_at desc);

create or replace function public.drop_events_fill_source() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.retail_product_id is not null then
    select retailer_id, game into new.retailer_id, new.game from public.retail_products where id = new.retail_product_id;
  else
    select retailer_id, game into new.retailer_id, new.game from public.sightings where id = new.sighting_id;
  end if;
  return new;
end $$;
create trigger drop_events_fill_source before insert on public.drop_events
  for each row execute function public.drop_events_fill_source();

-- Stats per scout, used for trust and the leaderboard.
create or replace function public.scout_stats(p_user uuid)
returns table (confirmed integer, rejected integer, trusted boolean)
language sql stable security definer set search_path = public as $$
  with c as (
    select count(*) filter (where status = 'confirmed')::integer as confirmed,
           count(*) filter (where status = 'rejected')::integer as rejected
    from public.sightings where user_id = p_user
  )
  select c.confirmed, c.rejected,
         c.confirmed >= coalesce(public.setting_int('sightings.trusted_after'), 5)
         and c.rejected * 100 <= coalesce(public.setting_int('sightings.trusted_max_reject_pct'), 10) * (c.confirmed + c.rejected)
  from c
$$;

-- Confirming a sighting: the alert is a drop_event (IN_STOCK). The trigger
-- on drop_events fans it out with the tier timing. Also pays scout rewards.
create or replace function public.confirm_sighting(p_sighting bigint, p_by uuid default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  s public.sightings;
  v_event bigint;
  v_confirmed integer;
  v_every integer := coalesce(public.setting_int('scouts.reward_every'), 10);
  v_days integer := coalesce(public.setting_int('scouts.reward_days'), 30);
  v_rrp numeric;
  v_tag public.rrp_tag := 'UNKNOWN';
  v_tol numeric := coalesce(public.setting_num('drops.rrp_tolerance_pct'), 2);
begin
  select * into s from public.sightings where id = p_sighting for update;
  if s.id is null or s.status <> 'pending' then
    return s.drop_event_id;
  end if;

  -- RRP tag, if we know the RRP for this kind of product.
  if s.price_aud is not null then
    select r.rrp_aud into v_rrp from public.rrp_reference r
    where r.game = s.game and lower(s.product) like '%' || replace(r.product_type, '-', ' ') || '%'
    order by r.set_code nulls last limit 1;
    if v_rrp is not null then
      v_tag := case
        when abs(s.price_aud - v_rrp) <= v_rrp * v_tol / 100 then 'AT_RRP'
        when s.price_aud < v_rrp then 'BELOW_RRP'
        else 'ABOVE_RRP' end;
    end if;
  end if;

  insert into public.drop_events (sighting_id, event_type, price_aud, rrp_aud, rrp_tag, rrp_delta_pct, dedupe_key, occurred_at, manual, created_by)
  values (s.id, 'IN_STOCK', s.price_aud, v_rrp, v_tag,
          case when v_rrp is not null and s.price_aud is not null then round((s.price_aud - v_rrp) / v_rrp * 100, 2) end,
          'sighting:' || s.id, now(), false, p_by)
  returning id into v_event;

  update public.sightings
     set status = 'confirmed', confirmed_at = now(), drop_event_id = v_event,
         reviewed_by = coalesce(p_by, reviewed_by)
   where id = s.id;

  select confirmed into v_confirmed from public.scout_stats(s.user_id);
  if v_every > 0 and v_confirmed > 0 and v_confirmed % v_every = 0 then
    update public.profile_private
       set premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => v_days)
     where user_id = s.user_id;
    perform public.notify(s.user_id, 'system', 'You earned ' || v_days || ' days of Premium',
      v_confirmed || ' of your sightings have been confirmed. Thanks for looking out for the community.',
      '/account/', jsonb_build_object('reward_days', v_days), null, 'scout-reward:' || s.user_id || ':' || v_confirmed);
  end if;
  perform public.notify(s.user_id, 'system', 'Your sighting was confirmed',
    s.product || ' at ' || (select name from public.retailers where id = s.retailer_id),
    '/account/sightings/', jsonb_build_object('sighting_id', s.id), null, 'sighting-confirmed:' || s.id);
  return v_event;
end $$;
revoke execute on function public.confirm_sighting(bigint, uuid) from anon, authenticated;

-- Report a sighting. The only way in (no direct insert policy), so every
-- rule is enforced here. Returns the sighting id and whether the report was
-- merged into an existing one (as a confirmation).
create or replace function public.report_sighting(
  p_retailer_slug text, p_channel text, p_game text, p_product text,
  p_state public.au_state default null, p_suburb text default null, p_store_name text default null,
  p_price_aud numeric default null, p_quantity text default null, p_url text default null,
  p_photo_path text default null, p_note text default null, p_seen_minutes_ago integer default 0,
  p_purchase_limit smallint default null
) returns table (sighting_id bigint, merged boolean, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_retailer public.retailers;
  v_existing bigint;
  v_id bigint;
  v_needed integer;
  v_trusted boolean;
  v_text text := coalesce(p_product, '') || ' ' || coalesce(p_note, '') || ' ' || coalesce(p_store_name, '');
begin
  if v_user is null or not public.is_active_user(v_user) then
    raise exception 'sign in to report a sighting' using errcode = '42501';
  end if;
  if not public.setting_bool('sightings.enabled') then
    raise exception 'sighting reports are paused' using errcode = '22023';
  end if;
  select * into v_retailer from public.retailers where slug = p_retailer_slug;
  if v_retailer.id is null then
    raise exception 'unknown retailer' using errcode = '22023';
  end if;
  if p_channel = 'online' and (p_url is null or lower(p_url) not like lower(rtrim(v_retailer.base_url, '/')) || '/%') then
    raise exception 'online sightings need a link to the product on %', v_retailer.name using errcode = '22023';
  end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> v_user::text then
    raise exception 'photo must be your own upload' using errcode = '42501';
  end if;
  if exists (select 1 from public.listing_banned_words(v_text) where severity = 'block') then
    raise exception 'report contains words that are not allowed' using errcode = '22023';
  end if;
  if (select count(*) from public.sightings where user_id = v_user and created_at > now() - interval '24 hours')
     >= coalesce(public.setting_int('sightings.daily_limit'), 10) then
    raise exception 'daily sighting limit reached' using errcode = '54000';
  end if;

  -- Same store, same game, recently: count it as a confirmation instead.
  if p_channel = 'in_store' then
    select s.id into v_existing from public.sightings s
    where s.retailer_id = v_retailer.id and s.channel = 'in_store' and s.state = p_state
      and lower(s.suburb) = lower(trim(p_suburb)) and s.game = p_game
      and s.status in ('pending', 'confirmed') and s.gone_at is null
      and s.created_at > now() - make_interval(mins => coalesce(public.setting_int('sightings.merge_window_minutes'), 180))
    order by s.created_at desc limit 1;
  else
    select s.id into v_existing from public.sightings s
    where s.retailer_id = v_retailer.id and s.channel = 'online' and s.url = p_url
      and s.status in ('pending', 'confirmed') and s.gone_at is null
      and s.created_at > now() - make_interval(mins => coalesce(public.setting_int('sightings.merge_window_minutes'), 180))
    order by s.created_at desc limit 1;
  end if;
  if v_existing is not null then
    if (select user_id from public.sightings where id = v_existing) <> v_user then
      insert into public.sighting_votes (sighting_id, user_id, vote) values (v_existing, v_user, 'confirm')
      on conflict do nothing;
    end if;
    return query select v_existing, true, (select s.status from public.sightings s where s.id = v_existing);
    return;
  end if;

  insert into public.sightings (user_id, retailer_id, channel, state, suburb, store_name, game, product,
                                price_aud, quantity, purchase_limit, url, photo_path, note, seen_at)
  values (v_user, v_retailer.id, p_channel, p_state, nullif(trim(p_suburb), ''), nullif(trim(p_store_name), ''), p_game, trim(p_product),
          p_price_aud, p_quantity, p_purchase_limit, p_url, p_photo_path, nullif(trim(p_note), ''),
          now() - make_interval(mins => least(greatest(coalesce(p_seen_minutes_ago, 0), 0), 240)))
  returning id into v_id;

  select t.trusted into v_trusted from public.scout_stats(v_user) t;
  if public.has_role('moderator') or v_trusted then
    perform public.confirm_sighting(v_id, v_user);
  end if;
  return query select v_id, false, (select s.status from public.sightings s where s.id = v_id);
end $$;
revoke execute on function public.report_sighting(text, text, text, text, public.au_state, text, text, numeric, text, text, text, text, integer, smallint) from anon;
grant execute on function public.report_sighting(text, text, text, text, public.au_state, text, text, numeric, text, text, text, text, integer, smallint) to authenticated;

-- Vote rules + counters. Confirming needs Premium or staff (pending reports
-- are Premium-only information); "gone" and "fake" are open to any member who
-- can see the sighting. You can't vote on your own report.
create or replace function public.sighting_votes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.sightings;
begin
  select * into s from public.sightings where id = new.sighting_id;
  if s.id is null then
    raise exception 'unknown sighting' using errcode = '22023';
  end if;
  if s.user_id = new.user_id then
    raise exception 'you cannot vote on your own sighting' using errcode = '42501';
  end if;
  if s.status in ('rejected', 'expired') then
    raise exception 'this sighting is closed' using errcode = '22023';
  end if;
  if new.vote = 'confirm' and s.status <> 'pending' then
    raise exception 'already confirmed' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger sighting_votes_guard before insert on public.sighting_votes
  for each row execute function public.sighting_votes_guard();

create or replace function public.sighting_votes_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.sightings;
  v_needed integer;
begin
  update public.sightings set
    confirm_count = confirm_count + (new.vote = 'confirm')::int,
    gone_count = gone_count + (new.vote = 'gone')::int,
    flag_count = flag_count + (new.vote = 'fake')::int
  where id = new.sighting_id
  returning * into s;

  if new.vote = 'confirm' and s.status = 'pending' then
    v_needed := case when s.photo_path is not null
      then coalesce(public.setting_int('sightings.confirmations_with_photo'), 1)
      else coalesce(public.setting_int('sightings.confirmations_needed'), 2) end;
    if s.confirm_count >= v_needed and s.flag_count < s.confirm_count then
      perform public.confirm_sighting(s.id, null);
    end if;
  elsif new.vote = 'gone' and s.gone_at is null
        and s.gone_count >= coalesce(public.setting_int('sightings.gone_votes_to_close'), 2) then
    update public.sightings set gone_at = now() where id = s.id;
  end if;
  return null;
end $$;
create trigger sighting_votes_apply after insert on public.sighting_votes
  for each row execute function public.sighting_votes_apply();

-- Staff review.
create or replace function public.review_sighting(p_sighting bigint, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('moderator') then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if p_action = 'confirm' then
    perform public.confirm_sighting(p_sighting, auth.uid());
  elsif p_action = 'reject' then
    update public.sightings set status = 'rejected', reviewed_by = auth.uid(), reject_reason = p_reason
    where id = p_sighting and status in ('pending', 'confirmed');
    -- A rejected confirmed sighting withdraws its alert everywhere.
    update public.drop_events set suppressed = true, suppressed_reason = 'sighting rejected: ' || coalesce(p_reason, '')
    where sighting_id = p_sighting;
    update public.drop_alert_deliveries d set status = 'skipped', error = 'sighting rejected'
    from public.drop_events e where e.id = d.drop_event_id and e.sighting_id = p_sighting and d.status = 'queued';
  elsif p_action = 'gone' then
    update public.sightings set gone_at = coalesce(gone_at, now()) where id = p_sighting;
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
end $$;
grant execute on function public.review_sighting(bigint, text, text) to authenticated;

-- Housekeeping (called by the workers every few minutes).
create or replace function public.expire_sightings() returns integer
language sql security definer set search_path = public as $$
  with x as (
    update public.sightings set status = 'expired'
    where status = 'pending'
      and created_at < now() - make_interval(mins => coalesce(public.setting_int('sightings.pending_expiry_minutes'), 360))
    returning 1
  ) select count(*)::integer from x
$$;
revoke execute on function public.expire_sightings() from anon, authenticated;

-- Public leaderboard: usernames and counts only.
create or replace function public.scout_leaderboard(p_days integer default 30, p_limit integer default 20)
returns table (username text, confirmed integer, states text[])
language sql stable security definer set search_path = public as $$
  select p.username::text, count(*)::integer,
         array_remove(array_agg(distinct s.state::text), null)
  from public.sightings s
  join public.profiles p on p.id = s.user_id
  where s.status = 'confirmed' and s.confirmed_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
  group by p.username
  order by count(*) desc, max(s.confirmed_at) desc
  limit least(greatest(p_limit, 1), 100)
$$;
grant execute on function public.scout_leaderboard(integer, integer) to anon, authenticated;

-- Visibility mirrors drop_events: confirmed sightings are public once their
-- drop event is public; Premium members and staff see everything live
-- (including pending ones, so they can confirm); reporters see their own.
create policy "sightings: tiered read" on public.sightings for select using (
  user_id = auth.uid()
  or public.is_premium(auth.uid())
  or public.has_role('moderator')
  or (status = 'confirmed' and exists (
        select 1 from public.drop_events e where e.id = drop_event_id and not e.suppressed and e.public_at <= now()))
);
create policy "sighting_votes: own" on public.sighting_votes for select using (user_id = auth.uid() or public.has_role('moderator'));
create policy "sighting_votes: members vote" on public.sighting_votes for insert with check (
  user_id = auth.uid() and public.is_active_user(auth.uid())
  and (vote <> 'confirm' or public.is_premium(auth.uid()) or public.has_role('moderator'))
  and exists (select 1 from public.sightings s where s.id = sighting_id)
);

create trigger audit_staff_write after insert or update or delete on public.sightings
  for each row execute function public.audit_staff_write();

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('sighting-photos', 'sighting-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where policyname = 'sighting photos: owner uploads') then
      create policy "sighting photos: owner uploads" on storage.objects for insert to authenticated
      with check (bucket_id = 'sighting-photos' and (storage.foldername(name))[1] = auth.uid()::text);
    end if;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sightings;
  end if;
end $$;

-- --------------------------------------------------------- alert filters
alter table public.drop_alert_filters
  add column if not exists states public.au_state[],          -- in-store reports: null = every state
  add column if not exists keywords text[],                   -- null = everything; else title must contain one
  add column if not exists include_sightings boolean not null default true,
  add column if not exists max_price_aud numeric(10, 2) check (max_price_aud > 0),
  add column if not exists onboarded_at timestamptz;
alter table public.drop_alert_filters add constraint drop_alert_filters_keywords_chk
  check (keywords is null or (cardinality(keywords) <= 20));

-- ------------------------------------------------------------ web push
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text check (char_length(user_agent) <= 300),
  failures integer not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create policy "push_subscriptions: owner" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.drop_alert_deliveries drop constraint if exists drop_alert_deliveries_channel_check;
alter table public.drop_alert_deliveries add constraint drop_alert_deliveries_channel_check
  check (channel in ('email', 'onsite', 'discord', 'push'));
alter table public.notification_preferences drop constraint if exists notification_preferences_channel_check;
alter table public.notification_preferences add constraint notification_preferences_channel_check
  check (channel in ('email', 'onsite', 'discord', 'push'));
alter table public.notification_preferences drop constraint if exists notification_preferences_alert_type_check;
alter table public.notification_preferences add constraint notification_preferences_alert_type_check
  check (alert_type in ('message', 'listing_status', 'listing_expiring', 'saved_search', 'wishlist',
                        'drop', 'release', 'billing', 'weekly_digest', 'marketing'));

-- ------------------------------------------- fan-out (monitors + members)
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
  select d.*, coalesce(p.game, s.game) as game, r.slug as retailer_slug,
         lower(coalesce(p.title, s.product)) as title_lc,
         s.id as s_id, s.channel as s_channel, s.state as s_state
    into e
  from public.drop_events d
  left join public.retail_products p on p.id = d.retail_product_id
  left join public.sightings s on s.id = d.sighting_id
  join public.retailers r on r.id = coalesce(p.retailer_id, s.retailer_id)
  where d.id = p_event;
  if e.id is null or e.suppressed then
    return 0;
  end if;
  for u in
    select pr.id as user_id, f.games, f.retailer_slugs, f.event_types, f.only_at_or_below_rrp,
           f.states, f.keywords, f.max_price_aud, coalesce(f.include_sightings, true) as include_sightings
    from public.profiles pr
    join public.profile_private pp on pp.user_id = pr.id and pp.status = 'active'
    left join public.drop_alert_filters f on f.user_id = pr.id
  loop
    if u.games is not null and e.game is not null and not (e.game = any (u.games)) then continue; end if;
    if u.retailer_slugs is not null and not (e.retailer_slug = any (u.retailer_slugs)) then continue; end if;
    if u.event_types is not null and not (e.event_type::text = any (u.event_types)) then continue; end if;
    if coalesce(u.only_at_or_below_rrp, false) and e.rrp_tag = 'ABOVE_RRP' then continue; end if;
    if u.max_price_aud is not null and e.price_aud is not null and e.price_aud > u.max_price_aud then continue; end if;
    if e.s_id is not null and not u.include_sightings then continue; end if;
    if e.s_channel = 'in_store' and u.states is not null and not (e.s_state = any (u.states)) then continue; end if;
    if u.keywords is not null and cardinality(u.keywords) > 0
       and not exists (select 1 from unnest(u.keywords) k where e.title_lc like '%' || lower(k) || '%') then continue; end if;
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

-- ------------------------------------------------------ release calendar
create table public.release_events (
  id uuid primary key default gen_random_uuid(),
  game text not null references public.games (code),
  lang text not null references public.languages (code),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 3 and 120),
  kind text not null default 'set_release' check (kind in ('set_release', 'product_release', 'prerelease', 'preorder_open', 'retailer_date')),
  release_date date,
  date_precision text not null default 'day' check (date_precision in ('day', 'month', 'quarter', 'tbc')),
  confidence text not null default 'official' check (confidence in ('official', 'retailer', 'unconfirmed')),
  set_id uuid references public.sets (id) on delete set null,
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array'),  -- [{name, type, rrp_aud}]
  retailer_slugs text[],
  summary text check (char_length(summary) <= 300),
  body_md text check (char_length(body_md) <= 20000),
  source_name text,
  source_url text check (source_url ~ '^https://'),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game, slug),
  check (date_precision = 'tbc' or release_date is not null)
);
alter table public.release_events enable row level security;
create index release_events_date_idx on public.release_events (release_date) where published;
create trigger touch_release_events before update on public.release_events
  for each row execute function public.touch_updated_at();
create trigger audit_staff_write after insert or update or delete on public.release_events
  for each row execute function public.audit_staff_write();

create policy "release_events: public read" on public.release_events for select using (published or public.has_role('editor'));
create policy "release_events: editors write" on public.release_events for all
  using (public.has_role('editor')) with check (public.has_role('editor'));

create table public.release_reminders (
  user_id uuid not null references public.profiles (id) on delete cascade,
  release_event_id uuid not null references public.release_events (id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (user_id, release_event_id)
);
alter table public.release_reminders enable row level security;
create policy "release_reminders: owner" on public.release_reminders for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Sends "tomorrow" reminders (day precision only). Run daily at ~08:00 AEST.
create or replace function public.send_release_reminders(p_today date default (now() at time zone 'Australia/Sydney')::date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select rr.user_id, e.id, e.title, e.game, e.slug, e.release_date, e.kind
    from public.release_reminders rr
    join public.release_events e on e.id = rr.release_event_id
    where rr.sent_at is null and e.published and e.date_precision = 'day'
      and e.release_date between p_today and p_today + 1
  loop
    perform public.notify(r.user_id, 'release',
      r.title || case when r.release_date = p_today then ' is out today' else ' is out tomorrow' end,
      'Release date ' || to_char(r.release_date, 'Dy DD Mon YYYY') || '. Check the drops page for stock.',
      '/releases/' || r.game || '/' || r.slug || '/',
      jsonb_build_object('release_event_id', r.id), 'release', 'release:' || r.id || ':' || r.user_id);
    update public.release_reminders set sent_at = now() where user_id = r.user_id and release_event_id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.send_release_reminders(date) from anon, authenticated;
