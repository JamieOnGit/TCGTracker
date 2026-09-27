-- Integration tests for the schema, RLS and business rules enforced in the
-- database. Run with supabase/tests/run.sh (fresh DB each time).
\set ON_ERROR_STOP on
\set QUIET on

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Runs p_sql and passes only if it raises an error whose message contains p_like.
create function tests.throws(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_like || '%' then
      raise notice 'ok - % (raised: %)', p_msg, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % - wrong error: %', p_msg, sqlerrm;
  end;
  raise exception 'FAIL: % - expected an error containing "%"', p_msg, p_like;
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

create function tests.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
end $$;
grant execute on function tests.login(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------------ fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com', '{"username":"alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com',   '{"username":"bob"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com', '{"username":"carol"}'),
  ('00000000-0000-0000-0000-00000000000d', 'mod@example.com',   '{"username":"mod"}'),
  ('00000000-0000-0000-0000-00000000000e', 'prem@example.com',  '{"username":"prem"}');
update public.profile_private set role = 'moderator' where user_id = '00000000-0000-0000-0000-00000000000d';
update public.subscriptions set status = 'active', tier = 'premium' where user_id = '00000000-0000-0000-0000-00000000000e';

insert into public.sets (id, game, lang, code, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'pokemon',   'en', 'sv3pt5', '151', '151'),
  ('10000000-0000-0000-0000-000000000002', 'pokemon',   'jp', 'SV2a',   'Pokémon Card 151', 'sv2a-pokemon-card-151'),
  ('10000000-0000-0000-0000-000000000003', 'one-piece', 'en', 'OP05',   'Awakening of the New Era', 'op-05'),
  ('10000000-0000-0000-0000-000000000004', 'one-piece', 'jp', 'OP05',   '新時代の主役', 'op-05');
insert into public.cards (id, set_id, number, printed_total, name, slug, variant) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '199', '165', 'Charizard ex', '199-charizard-ex', 'sir'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '201', '165', 'Charizard ex', '201-charizard-ex', 'sar'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'OP05-119', null, 'Monkey.D.Luffy', 'op05-119-monkey-d-luffy-manga', 'manga'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'OP05-119', null, 'Monkey.D.Luffy', 'op05-119-monkey-d-luffy-manga', 'manga');

-- ------------------------------------------------------------ schema-wide
select tests.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'RLS is enabled on every table in public');

select tests.ok((select game from public.cards where id = '20000000-0000-0000-0000-000000000003') = 'one-piece'
  and (select lang from public.cards where id = '20000000-0000-0000-0000-000000000004') = 'jp',
  'cards inherit game and language from their set');

select tests.ok(public.slugify('Monkey.D.Luffy (Manga)') = 'monkey-d-luffy-manga', 'slugify');
select tests.ok(public.grade_key('PSA', 10) = 'psa-10' and public.grade_key('BGS', 9.5) = 'bgs-9.5'
  and public.grade_key(null, null) = 'raw', 'grade_key formatting');

-- ------------------------------------------------------ JP / EN separation
select tests.throws($$
  insert into public.card_external_ids (card_id, source, external_id, lang)
  values ('20000000-0000-0000-0000-000000000001', 'pricecharting', 'pc-jp-1', 'jp')
$$, 'does not match card language', 'a JP price record cannot be linked to an EN card');

select tests.throws($$
  update public.cards set counterpart_card_id = '20000000-0000-0000-0000-000000000003'
  where id = '20000000-0000-0000-0000-000000000001'
$$, 'other language', 'a counterpart must be the same game in the other language');

update public.cards set counterpart_card_id = '20000000-0000-0000-0000-000000000002'
where id = '20000000-0000-0000-0000-000000000001';
select tests.ok(true, 'EN Charizard links to its JP counterpart');

insert into public.card_external_ids (card_id, source, external_id, lang, variant, match_confidence, match_method) values
  ('20000000-0000-0000-0000-000000000001', 'pricecharting', 'pc-en-199', 'en', 'sir', 0.99, 'auto'),
  ('20000000-0000-0000-0000-000000000002', 'pricecharting', 'pc-jp-201', 'jp', 'sar', 0.98, 'auto'),
  ('20000000-0000-0000-0000-000000000003', 'pricecharting', 'pc-op-en-119', 'en', 'manga', 0.97, 'auto'),
  ('20000000-0000-0000-0000-000000000004', 'pricecharting', 'pc-op-jp-119', 'jp', 'manga', 0.97, 'auto');
select tests.throws($$
  insert into public.card_external_ids (card_id, source, external_id, lang)
  values ('20000000-0000-0000-0000-000000000003', 'pricecharting', 'pc-en-199', 'en')
$$, 'duplicate key', 'an external id maps to exactly one card (unique source+external_id)');

-- ---------------------------------------------------------------- redirects
update public.cards set slug = '199-charizard-ex-sir' where id = '20000000-0000-0000-0000-000000000001';
select tests.ok(
  (select to_path from public.redirects where from_path = '/cards/pokemon/en/151/199-charizard-ex/')
    = '/cards/pokemon/en/151/199-charizard-ex-sir/',
  'renaming a card slug writes a 301 for the card page');
select tests.ok(
  (select to_path from public.redirects where from_path = '/marketplace/pokemon/en/151/199-charizard-ex/')
    = '/marketplace/pokemon/en/151/199-charizard-ex-sir/',
  'and for the marketplace card page');
update public.cards set slug = '199-charizard-ex' where id = '20000000-0000-0000-0000-000000000001';
select tests.ok(
  not exists (select 1 from public.redirects where from_path = '/cards/pokemon/en/151/199-charizard-ex/')
  and (select to_path from public.redirects where from_path = '/cards/pokemon/en/151/199-charizard-ex-sir/')
    = '/cards/pokemon/en/151/199-charizard-ex/',
  'renaming back removes the loop and keeps the chain one hop');
update public.sets set slug = 'scarlet-violet-151' where id = '10000000-0000-0000-0000-000000000001';
select tests.ok(
  (select to_path from public.redirects where from_path = '/cards/pokemon/en/151/199-charizard-ex/')
    = '/cards/pokemon/en/scarlet-violet-151/199-charizard-ex/'
  and (select to_path from public.redirects where from_path = '/cards/pokemon/en/151/199-charizard-ex-sir/')
    = '/cards/pokemon/en/scarlet-violet-151/199-charizard-ex/',
  'renaming a set redirects every card in it, collapsing older chains');
update public.sets set slug = '151' where id = '10000000-0000-0000-0000-000000000001';

-- --------------------------------------------------------- listing lifecycle
-- Alice (Free) lists the EN Charizard in PSA 10.
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');

select tests.throws($$
  insert into public.listings (seller_id, listing_type, card_id, lang, grader, grade, title, slug, price_aud, location_state, status)
  values ('00000000-0000-0000-0000-00000000000a', 'graded_single', '20000000-0000-0000-0000-000000000001', 'en', 'PSA', 10,
          'Charizard ex PSA 10', 'charizard-ex-psa-10', 4650, 'VIC', 'active')
$$, 'start as draft', 'a seller cannot create a listing that is already active');

insert into public.listings (seller_id, listing_type, card_id, lang, grader, grade, cert_number, title, slug, price_aud, location_state)
values ('00000000-0000-0000-0000-00000000000a', 'graded_single', '20000000-0000-0000-0000-000000000001', 'en', 'PSA', 10,
        '12345678', 'Charizard ex PSA 10', 'charizard-ex-psa-10', 4650, 'VIC');

select tests.throws($$
  update public.listings set status = 'pending_review' where title = 'Charizard ex PSA 10'
$$, 'photos', 'submitting without front and back photos is refused');

insert into public.listing_images (listing_id, storage_path, kind, mime_type, bytes)
select id, 'a/1-front.jpg', 'slab-front', 'image/jpeg', 200000 from public.listings where title = 'Charizard ex PSA 10';
select tests.throws($$
  insert into public.listing_images (listing_id, storage_path, kind, mime_type, bytes)
  select id, 'a/1.gif', 'slab-back', 'image/gif', 1000 from public.listings where title = 'Charizard ex PSA 10'
$$, 'not allowed', 'uploads are restricted by type');
insert into public.listing_images (listing_id, storage_path, kind, mime_type, bytes)
select id, 'a/1-back.jpg', 'slab-back', 'image/jpeg', 200000 from public.listings where title = 'Charizard ex PSA 10';

update public.listings set status = 'pending_review' where title = 'Charizard ex PSA 10';
select tests.ok((select submitted_at is not null from public.listings where title = 'Charizard ex PSA 10'),
  'submission stamps submitted_at (quota counts from here)');

select tests.throws($$
  update public.listings set status = 'active' where title = 'Charizard ex PSA 10'
$$, 'cannot move', 'a seller cannot approve their own listing');

-- Pending listings are never public.
reset role;
set role anon;
select set_config('request.jwt.claims', '', false);
select tests.ok((select count(*) from public.listings) = 0, 'anon cannot see a pending listing');

-- Moderator approves.
reset role;
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000d');
update public.listings set status = 'active' where title = 'Charizard ex PSA 10';
select tests.ok((select approved_by = '00000000-0000-0000-0000-00000000000d' and expires_at > now() + interval '59 days'
  from public.listings where title = 'Charizard ex PSA 10'), 'approval stamps approver and expiry from settings');

reset role;
set role anon;
select set_config('request.jwt.claims', '', false);
select tests.ok((select count(*) from public.listings where status = 'active') = 1, 'anon can see the approved listing');
select tests.ok((select active_count = 1 and lowest_price_aud = 4650 from public.card_listing_stats
  where card_id = '20000000-0000-0000-0000-000000000001' and grade_key = 'psa-10'),
  'Buy-button stats: 1 active PSA 10 listing from A$4,650');
select tests.ok(not exists (select 1 from public.card_listing_stats
  where card_id = '20000000-0000-0000-0000-000000000002' and active_count > 0),
  'the JP Charizard has no listings: the EN listing never leaks onto the JP card');
reset role;

-- ------------------------------------------------------------------- quota
-- Alice (Free, limit 5) has used 1. Four more drafts submit; the sixth fails.
do $$
declare i int;
begin
  for i in 1..5 loop
    insert into public.listings (seller_id, listing_type, card_id, lang, condition, title, slug, price_aud, location_state)
    values ('00000000-0000-0000-0000-00000000000a', 'raw_single', '20000000-0000-0000-0000-000000000003', 'en', 'NM',
            'Luffy manga raw ' || i, 'luffy-manga-raw-' || i, 900 + i, 'NSW');
    insert into public.listing_images (listing_id, storage_path, kind)
    select id, 'a/' || i || 'f.jpg', 'front' from public.listings where title = 'Luffy manga raw ' || i
    union all
    select id, 'a/' || i || 'b.jpg', 'back' from public.listings where title = 'Luffy manga raw ' || i;
  end loop;
end $$;

set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
update public.listings set status = 'pending_review' where title in ('Luffy manga raw 1', 'Luffy manga raw 2', 'Luffy manga raw 3', 'Luffy manga raw 4');
select tests.ok((public.my_quota() ->> 'used')::int = 5 and (public.my_quota() ->> 'limit')::int = 5, 'quota shows 5 of 5 used');
select tests.throws($$
  update public.listings set status = 'pending_review' where title = 'Luffy manga raw 5'
$$, 'QUOTA_EXCEEDED', 'the 6th listing in a calendar month is blocked for a Free member');

-- Rejected listings still count by default...
reset role;
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000d');
update public.listings set status = 'rejected', rejection_reason = 'Photos unclear' where title = 'Luffy manga raw 1';
select tests.throws($$
  update public.listings set status = 'rejected' where title = 'Luffy manga raw 2'
$$, 'reason', 'rejecting requires a reason');
reset role;
select tests.ok(public.quota_used('00000000-0000-0000-0000-00000000000a') = 5, 'a rejected listing still counts toward quota');
-- ...unless the config says otherwise.
update public.site_settings set value = 'false' where key = 'quota.count_rejected';
select tests.ok(public.quota_used('00000000-0000-0000-0000-00000000000a') = 4, 'quota.count_rejected=false stops rejected listings counting');
update public.site_settings set value = 'true' where key = 'quota.count_rejected';

-- Premium lifts the limit to 30; a downgrade blocks new listings but leaves live ones.
update public.subscriptions set status = 'active', tier = 'premium' where user_id = '00000000-0000-0000-0000-00000000000a';
select tests.ok(public.quota_limit('00000000-0000-0000-0000-00000000000a') = 30, 'Premium quota is 30');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
update public.listings set status = 'pending_review' where title = 'Luffy manga raw 5';
reset role;
update public.subscriptions set status = 'canceled', tier = 'free' where user_id = '00000000-0000-0000-0000-00000000000a';
select tests.ok(public.quota_limit('00000000-0000-0000-0000-00000000000a') = 5
  and (select status from public.listings where title = 'Charizard ex PSA 10') = 'active',
  'after downgrade the Free quota applies again and existing live listings stay live');

-- Grace period: past_due keeps Premium until grace_until.
update public.subscriptions set status = 'past_due', grace_until = now() + interval '3 days' where user_id = '00000000-0000-0000-0000-00000000000a';
select tests.ok(public.effective_tier('00000000-0000-0000-0000-00000000000a') = 'premium', 'past_due within grace keeps Premium');
update public.subscriptions set grace_until = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-00000000000a';
select tests.ok(public.effective_tier('00000000-0000-0000-0000-00000000000a') = 'free', 'after grace the member is Free');

-- Owners can't edit what they're selling once submitted, or moderation fields.
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.throws($$
  update public.listings set grade = 9 where title = 'Charizard ex PSA 10'
$$, 'locked', 'item details are locked after submission');
select tests.throws($$
  update public.listings set cert_verified = true where title = 'Charizard ex PSA 10'
$$, 'moderation fields', 'a seller cannot mark their own cert as verified');
update public.listings set price_aud = 4500 where title = 'Charizard ex PSA 10';
reset role;
select tests.ok((select lowest_price_aud from public.card_listing_stats
  where card_id = '20000000-0000-0000-0000-000000000001' and grade_key = 'psa-10') = 4500,
  'price edits on a live listing update the Buy-button stats');

-- Banned words: fakes/proxies can't be submitted.
select tests.login('00000000-0000-0000-0000-00000000000b');
insert into public.listings (seller_id, listing_type, card_id, lang, condition, title, slug, price_aud, location_state)
values ('00000000-0000-0000-0000-00000000000b', 'raw_single', '20000000-0000-0000-0000-000000000004', 'jp', 'NM',
        'Luffy manga proxy card', 'luffy-manga-proxy-card', 50, 'QLD');
insert into public.listing_images (listing_id, storage_path, kind)
select id, 'b/f.jpg', 'front' from public.listings where title = 'Luffy manga proxy card'
union all select id, 'b/b.jpg', 'back' from public.listings where title = 'Luffy manga proxy card';
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.throws($$
  update public.listings set status = 'pending_review' where title = 'Luffy manga proxy card'
$$, 'not allowed', 'a listing mentioning proxies is refused');
reset role;

-- ------------------------------------------------------------- messaging
-- Bob opens a thread with Alice about her Charizard; Carol must not see it.
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000b');
insert into public.conversations (listing_id, buyer_id, seller_id)
select id, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c'
from public.listings where title = 'Charizard ex PSA 10';
select tests.ok((select seller_id from public.conversations limit 1) = '00000000-0000-0000-0000-00000000000a',
  'the seller on a thread comes from the listing, not the client');
insert into public.messages (conversation_id, sender_id, body)
select id, '00000000-0000-0000-0000-00000000000b', 'Hi! Is this still available? Pickup in Melbourne?' from public.conversations limit 1;
reset role;
select id as conv_id from public.conversations limit 1 \gset

set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.ok((select count(*) from public.messages) = 1, 'the seller can read the thread');
select tests.ok((select unread_count from public.my_inbox limit 1) = 1, 'unread count is 1 for the seller');
select public.mark_conversation_read(:'conv_id');
select tests.ok((select unread_count from public.my_inbox limit 1) = 0, 'marking read clears the unread count');

select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.ok((select count(*) from public.conversations) = 0, 'a third user cannot see the conversation');
select tests.ok((select count(*) from public.messages) = 0, 'a third user cannot read the messages');
select tests.throws(format($$
  insert into public.messages (conversation_id, sender_id, body)
  values (%L, '00000000-0000-0000-0000-00000000000c', 'let me in')
$$, :'conv_id'), 'not a participant', 'a third user cannot post into the thread');

-- Moderators can't browse threads...
select tests.login('00000000-0000-0000-0000-00000000000d');
select tests.ok((select count(*) from public.messages) = 0, 'moderators cannot read threads through RLS');
select tests.throws(format('select * from public.admin_read_reported_thread(%L)', :'conv_id'),
  'not been reported', 'a moderator cannot open an unreported thread');
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.throws(format('select * from public.admin_read_reported_thread(%L)', :'conv_id'),
  'not allowed', 'an ordinary user cannot use the admin thread reader');

-- ...until one is reported, and then every read is audit-logged.
select tests.login('00000000-0000-0000-0000-00000000000a');
insert into public.reports (reporter_id, target_type, target_id, reason)
values ('00000000-0000-0000-0000-00000000000a', 'conversation', :'conv_id', 'off_platform_payment');
select tests.login('00000000-0000-0000-0000-00000000000d');
select tests.ok((select count(*) from public.admin_read_reported_thread(:'conv_id')) = 1,
  'a moderator can open a reported thread');
reset role;
select tests.ok((select count(*) from public.admin_audit_log where action = 'thread.read') = 1, 'the read is audit-logged');
select tests.ok((select count(*) from public.admin_audit_log where action = 'listings.update') >= 1,
  'moderator listing approvals are audit-logged');

-- Blocking stops messages both ways.
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.throws($$
  insert into public.messages (conversation_id, sender_id, body)
  select id, '00000000-0000-0000-0000-00000000000b', 'hello?' from public.conversations limit 1
$$, 'blocked', 'a blocked user cannot keep messaging');
reset role;

-- --------------------------------------------------------------- drops
insert into public.retail_products (retailer_id, sku, url, title, game)
select id, 'OP09-BOX', 'https://example.test/op09', 'One Piece Card Game OP-09 Booster Box', 'one-piece'
from public.retailers where slug = 'jb-hi-fi';
insert into public.drop_events (retail_product_id, event_type, price_aud, rrp_aud, rrp_tag, dedupe_key)
select id, 'IN_STOCK', 199, 199, 'AT_RRP', 'jb-hi-fi:OP09-BOX:IN_STOCK:1' from public.retail_products;
select tests.ok((select public_at - occurred_at from public.drop_events limit 1) = interval '30 minutes',
  'public_at = occurred_at + drops.public_delay_minutes');
select tests.throws($$
  insert into public.drop_events (retail_product_id, event_type, dedupe_key)
  select id, 'IN_STOCK', 'jb-hi-fi:OP09-BOX:IN_STOCK:1' from public.retail_products
$$, 'duplicate key', 'drop events are deduplicated');

select set_config('request.jwt.claims', '', false);
set role anon;
select tests.ok((select count(*) from public.drop_events) = 0, 'a fresh drop is hidden from the public');
reset role;
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.ok((select count(*) from public.drop_events) = 0, 'and from Free members');
select tests.login('00000000-0000-0000-0000-00000000000e');
select tests.ok((select count(*) from public.drop_events) = 1, 'Premium members see it instantly');
reset role;
update public.drop_events set occurred_at = now() - interval '31 minutes', public_at = now() - interval '1 minute';
select set_config('request.jwt.claims', '', false);
set role anon;
select tests.ok((select count(*) from public.drop_events) = 1, 'after the delay it appears in the public history');
reset role;

-- -------------------------------------------- privilege escalation guards
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.throws($$
  update public.profile_private set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000b'
$$, 'privileged', 'a user cannot make themselves admin');
update public.subscriptions set status = 'active' where user_id = '00000000-0000-0000-0000-00000000000b';
select tests.ok((select status from public.subscriptions where user_id = '00000000-0000-0000-0000-00000000000b') = 'none',
  'a user cannot grant themselves Premium (no write policy on subscriptions)');
select tests.ok((select count(*) from public.site_settings where key = 'market.matcher_auto_accept') = 0,
  'operational settings are hidden from users');
reset role;

-- -------------------------------------- price -> card -> market cap -> buy
-- The brief's chain test (4.2) at the database level, for all four
-- game/language combinations: an external price record, via
-- card_external_ids, lands on the same card_id + grade as the market-cap row
-- and the Buy-button stats.
insert into public.market_cap_snapshots (card_id, grade_key, date, population, floor_aud, basis, market_cap_aud)
select c.id, 'psa-10', current_date, 100 + row_number() over (), 1000, 'external_ask', (100 + row_number() over ()) * 1000
from public.cards c;
refresh materialized view public.market_cap_rankings;

do $$
declare
  r record;
  v_card uuid;
begin
  for r in select * from public.card_external_ids where source = 'pricecharting' loop
    v_card := r.card_id;
    perform tests.ok(
      exists (select 1 from public.market_cap_rankings m where m.card_id = v_card and m.grade_key = 'psa-10'
               and m.lang = r.lang),
      format('price record %s -> card %s -> market cap row (same card, grade, language)', r.external_id, v_card));
  end loop;
end $$;
select tests.ok(
  (select m.card_id from public.market_cap_rankings m
     join public.card_listing_stats s on s.card_id = m.card_id and s.grade_key = m.grade_key
   where s.active_count > 0) = '20000000-0000-0000-0000-000000000001',
  'market cap row and Buy-button stats resolve to the same card_id and grade');

\echo 'All database tests passed'
