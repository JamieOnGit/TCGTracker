-- TCG Trade: owner decisions of 2026-09-28, plus the delivery plumbing for
-- every alert the site sends (email outbox, drop-alert fan-out, message,
-- listing-status and wishlist/saved-search alerts).
--
-- Decisions applied here (all still editable in the admin console):
--   * Brand "TCG Trade", https://tcgtrade.com.au
--   * Premium A$12.99/month incl. GST (unchanged seed)
--   * Free members DO get drop alerts, 1 day (1440 min) after the event;
--     the public drop history uses the same delay
--   * eBay fallback on the Buy button is ON; affiliate details are entered in
--     the admin console and applied to every card's eBay link
--   * JB Hi-Fi approved and enabled; Target Australia added

-- ------------------------------------------------------------- settings
update public.site_settings set value = '1440' where key = 'drops.public_delay_minutes';
update public.site_settings set value = 'true' where key = 'drops.free_delayed_alerts';
update public.site_settings set value = 'true' where key = 'features.external_buy_fallback';

insert into public.site_settings (key, value, description, is_public) values
  ('site.name',                       '"TCG Trade"',                 'Brand name', true),
  ('site.url',                        '"https://tcgtrade.com.au"',   'Canonical origin', true),
  ('site.support_email',              '"hello@tcgtrade.com.au"',     'Support address shown to users', true),
  ('drops.free_delay_minutes',        '1440',                        'Free members receive drop alerts this long after the event', true),
  ('ebay.enabled',                    'true',                        'Show "Check eBay" when no marketplace listings exist', true),
  ('ebay.site',                       '"ebay.com.au"',               'eBay site searched', true),
  ('ebay.affiliate_enabled',          'false',                       'Wrap eBay links with eBay Partner Network tracking', true),
  ('ebay.campaign_id',                'null',                        'EPN campaign id (campid) — appears in public links anyway', true),
  ('ebay.custom_id',                  '"tcgtrade"',                  'EPN customid (sub-id) prefix; the card id is appended', true),
  ('ebay.rotation_id',                '"705-53470-19255-0"',         'EPN rotation id for eBay Australia (mkrid)', true),
  ('market.rank_by_price_until_population', 'true',                  'Until licensed population data exists, rank by PSA 10 price instead of market cap (labelled)', true),
  ('email.from',                      '"TCG Trade <alerts@tcgtrade.com.au>"', 'Sender for alert emails', false),
  ('email.message_batch_minutes',     '10',                          'New-message emails are batched per conversation over this window', false)
on conflict (key) do update set value = excluded.value, description = excluded.description;

-- ----------------------------------------------------------- retailers
update public.retailers set enabled = true, watch_interval_seconds = 90, discovery_interval_seconds = 300
  where slug = 'jb-hi-fi';
insert into public.retailers (slug, name, base_url, adapter, enabled)
values ('target-au', 'Target', 'https://www.target.com.au', 'target_au', false)
on conflict (slug) do nothing;

-- ------------------------------------------------------------ email outbox
-- Everything the site emails goes through here. The worker sends due rows
-- via the email provider, retries with back-off, and never sends a
-- dedupe_key twice.
create table public.email_outbox (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  to_email text not null,
  template text not null,           -- message | listing_status | listing_expiring | wishlist | saved_search | drop | billing | admin_alert
  data jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  send_after timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'suppressed')),
  attempts integer not null default 0,
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.email_outbox enable row level security;
create index email_outbox_due_idx on public.email_outbox (send_after) where status = 'queued';
create policy "email_outbox: admin reads" on public.email_outbox for select using (public.has_role('admin'));

create or replace function public.user_email(p_user uuid) returns text
language sql stable security definer set search_path = public, auth as $$
  select email from auth.users where id = p_user
$$;
revoke execute on function public.user_email(uuid) from anon, authenticated;

-- Queue an on-site notification and (if the member wants it) an email.
create or replace function public.notify(
  p_user uuid, p_type text, p_title text, p_body text, p_url text, p_data jsonb,
  p_email_template text default null, p_dedupe text default null, p_send_after timestamptz default now()
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  if public.wants_notification(p_user, p_type, 'onsite') then
    insert into public.notifications (user_id, type, title, body, url, data)
    values (p_user, p_type, p_title, p_body, p_url, coalesce(p_data, '{}'::jsonb));
  end if;
  if p_email_template is not null and public.wants_notification(p_user, p_type, 'email') then
    v_email := public.user_email(p_user);
    if v_email is not null then
      insert into public.email_outbox (user_id, to_email, template, data, dedupe_key, send_after)
      values (p_user, v_email, p_email_template,
              coalesce(p_data, '{}'::jsonb) || jsonb_build_object('title', p_title, 'body', p_body, 'url', p_url),
              p_dedupe, p_send_after)
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
end $$;
revoke execute on function public.notify(uuid, text, text, text, text, jsonb, text, text, timestamptz) from anon, authenticated;

-- ------------------------------------------------------- message alerts
-- One email per conversation per batch window, not one per message.
create or replace function public.messages_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_conv record;
  v_to uuid;
  v_window integer := coalesce(public.setting_int('email.message_batch_minutes'), 10);
  v_bucket bigint;
  v_title text;
begin
  select c.*, l.title as listing_title into v_conv
  from public.conversations c join public.listings l on l.id = c.listing_id
  where c.id = new.conversation_id;
  v_to := case when new.sender_id = v_conv.buyer_id then v_conv.seller_id else v_conv.buyer_id end;
  v_bucket := floor(extract(epoch from new.created_at) / (v_window * 60));
  v_title := 'New message about ' || v_conv.listing_title;
  perform public.notify(
    v_to, 'message', v_title, left(new.body, 140), '/messages/' || new.conversation_id || '/',
    jsonb_build_object('conversation_id', new.conversation_id, 'listing_id', v_conv.listing_id),
    'message', 'msg:' || new.conversation_id || ':' || v_to || ':' || v_bucket,
    new.created_at + make_interval(mins => v_window));
  return null;
end $$;
create trigger messages_notify after insert on public.messages
  for each row execute function public.messages_notify();

-- ------------------------------------------------- listing status alerts
create or replace function public.listings_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text := '/account/listings/';
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'active' and old.status = 'pending_review' then
    perform public.notify(new.seller_id, 'listing_status', 'Your listing is live', new.title,
      '/marketplace/listing/' || new.id || '/', jsonb_build_object('listing_id', new.id, 'status', 'active'),
      'listing_status', 'listing:' || new.id || ':active:' || coalesce(new.approved_at::text, ''));
  elsif new.status = 'rejected' then
    perform public.notify(new.seller_id, 'listing_status', 'Your listing was not approved',
      new.title || ' — ' || coalesce(new.rejection_reason, ''), v_url,
      jsonb_build_object('listing_id', new.id, 'status', 'rejected', 'reason', new.rejection_reason),
      'listing_status', 'listing:' || new.id || ':rejected');
  elsif new.status = 'draft' and old.status = 'pending_review' then
    perform public.notify(new.seller_id, 'listing_status', 'Changes requested on your listing',
      new.title || ' — ' || coalesce(new.change_request, ''), v_url,
      jsonb_build_object('listing_id', new.id, 'status', 'changes_requested', 'reason', new.change_request),
      'listing_status', 'listing:' || new.id || ':changes:' || md5(coalesce(new.change_request, '')));
  elsif new.status = 'expired' then
    perform public.notify(new.seller_id, 'listing_status', 'Your listing has expired — renew it in one click',
      new.title, v_url, jsonb_build_object('listing_id', new.id, 'status', 'expired'),
      'listing_status', 'listing:' || new.id || ':expired:' || coalesce(new.expires_at::text, ''));
  end if;

  -- A listing going live triggers wishlist and saved-search matches.
  if new.status = 'active' and old.status <> 'active' then
    perform public.match_new_listing(new.id);
  end if;
  return null;
end $$;
create trigger listings_notify after update of status on public.listings
  for each row execute function public.listings_notify();

-- Wishlist ("notify me when listed") and saved searches.
create or replace function public.match_new_listing(p_listing bigint) returns integer
language plpgsql security definer set search_path = public as $$
declare
  l record;
  r record;
  v_n integer := 0;
  v_game text;
  v_set uuid;
begin
  select * into l from public.listings where id = p_listing;
  select c.game, c.set_id into v_game, v_set from public.cards c where c.id = l.card_id;

  for r in
    select w.* from public.wishlist_items w
    where w.user_id <> l.seller_id
      and ((l.card_id is not null and w.card_id = l.card_id) or (l.sealed_product_id is not null and w.sealed_product_id = l.sealed_product_id))
      and (w.grade_key is null or w.grade_key = l.grade_key)
      and (w.max_price_aud is null or l.price_aud <= w.max_price_aud)
  loop
    perform public.notify(r.user_id, 'wishlist', 'Now listed: ' || l.title,
      'A$' || to_char(l.price_aud, 'FM999,999,990.00') || ' · ' || l.location_state,
      '/marketplace/listing/' || l.id || '/', jsonb_build_object('listing_id', l.id),
      'wishlist', 'wish:' || r.id || ':' || l.id);
    update public.wishlist_items set last_notified_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;

  for r in
    select s.* from public.saved_searches s
    where s.user_id <> l.seller_id and s.email_alerts
      and (s.query ->> 'game' is null or s.query ->> 'game' = v_game)
      and (s.query ->> 'lang' is null or s.query ->> 'lang' = l.lang)
      and (s.query ->> 'set_id' is null or (s.query ->> 'set_id')::uuid = v_set)
      and (s.query ->> 'card_id' is null or (s.query ->> 'card_id')::uuid = l.card_id)
      and (s.query ->> 'grade_key' is null or s.query ->> 'grade_key' = l.grade_key)
      and (s.query ->> 'listing_type' is null or s.query ->> 'listing_type' = l.listing_type::text)
      and (s.query ->> 'state' is null or s.query ->> 'state' = l.location_state::text)
      and (s.query ->> 'price_max' is null or l.price_aud <= (s.query ->> 'price_max')::numeric)
      and (s.query ->> 'price_min' is null or l.price_aud >= (s.query ->> 'price_min')::numeric)
      and (s.query ->> 'q' is null or l.search @@ websearch_to_tsquery('simple', s.query ->> 'q'))
  loop
    perform public.notify(r.user_id, 'saved_search', 'New match for "' || r.name || '"', l.title,
      '/marketplace/listing/' || l.id || '/', jsonb_build_object('listing_id', l.id, 'saved_search_id', r.id),
      'saved_search', 'search:' || r.id || ':' || l.id);
    update public.saved_searches set last_notified_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.match_new_listing(bigint) from anon, authenticated;

-- --------------------------------------------------------- drop alerts
-- Fan-out rows, one per member x channel. Premium: deliver_at = the event.
-- Free (if enabled): deliver_at = event + drops.free_delay_minutes. The
-- worker re-checks the member's tier at send time, so a Free member can
-- never receive an instant alert, and a lapsed Premium member falls back to
-- the delayed schedule.
create table public.drop_alert_deliveries (
  id bigint generated always as identity primary key,
  drop_event_id bigint not null references public.drop_events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('email', 'onsite', 'discord')),
  tier_at_enqueue public.tier not null,
  deliver_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  sent_at timestamptz,
  error text,
  unique (drop_event_id, user_id, channel)
);
alter table public.drop_alert_deliveries enable row level security;
create index drop_alert_deliveries_due_idx on public.drop_alert_deliveries (deliver_at) where status = 'queued';
create policy "drop deliveries: owner reads" on public.drop_alert_deliveries for select using (user_id = auth.uid());

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
  select d.*, p.game, r.slug as retailer_slug into e
  from public.drop_events d
  join public.retail_products p on p.id = d.retail_product_id
  join public.retailers r on r.id = p.retailer_id
  where d.id = p_event;
  if e.id is null or e.suppressed then
    return 0;
  end if;
  for u in
    select pr.id as user_id, f.games, f.retailer_slugs, f.event_types, f.only_at_or_below_rrp
    from public.profiles pr
    join public.profile_private pp on pp.user_id = pr.id and pp.status = 'active'
    left join public.drop_alert_filters f on f.user_id = pr.id
  loop
    if u.games is not null and e.game is not null and not (e.game = any (u.games)) then continue; end if;
    if u.retailer_slugs is not null and not (e.retailer_slug = any (u.retailer_slugs)) then continue; end if;
    if u.event_types is not null and not (e.event_type::text = any (u.event_types)) then continue; end if;
    if coalesce(u.only_at_or_below_rrp, false) and e.rrp_tag = 'ABOVE_RRP' then continue; end if;
    v_tier := public.effective_tier(u.user_id);
    if v_tier = 'free' and not v_free_on then continue; end if;
    foreach ch in array array['email', 'onsite', 'discord'] loop
      if not public.wants_notification(u.user_id, 'drop', ch) then continue; end if;
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

create or replace function public.drop_events_enqueue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.enqueue_drop_alerts(new.id);
  return null;
end $$;
create trigger drop_events_enqueue after insert on public.drop_events
  for each row execute function public.drop_events_enqueue();

-- Due deliveries with the tier rule re-applied at send time. Returns rows
-- that are safe to send now; reschedules the rest.
create or replace function public.claim_due_drop_alerts(p_limit integer default 500)
returns table (delivery_id bigint, user_id uuid, channel text, drop_event_id bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_free_delay integer := coalesce(public.setting_int('drops.free_delay_minutes'), 1440);
begin
  -- A member who is no longer Premium waits for the Free schedule.
  update public.drop_alert_deliveries d
     set deliver_at = e.occurred_at + make_interval(mins => v_free_delay)
    from public.drop_events e
   where e.id = d.drop_event_id and d.status = 'queued' and d.deliver_at <= now()
     and d.deliver_at < e.occurred_at + make_interval(mins => v_free_delay)
     and public.effective_tier(d.user_id) <> 'premium';
  return query
    select d.id, d.user_id, d.channel, d.drop_event_id
    from public.drop_alert_deliveries d
    where d.status = 'queued' and d.deliver_at <= now()
    order by d.deliver_at
    limit p_limit
    for update skip locked;
end $$;
revoke execute on function public.claim_due_drop_alerts(integer) from anon, authenticated;

-- Default drop-alert filters for every new member (all games, all retailers).
create or replace function public.create_default_drop_filters() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.drop_alert_filters (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger profiles_default_drop_filters after insert on public.profiles
  for each row execute function public.create_default_drop_filters();
insert into public.drop_alert_filters (user_id) select id from public.profiles on conflict do nothing;

-- ------------------------------------------------------------- realtime
-- Near-real-time messaging and the notification bell (brief 6.1).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications, public.conversations;
  end if;
end $$;
