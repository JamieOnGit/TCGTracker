-- Marketplace (brief 5). Classifieds only in v1: no payment or escrow, but
-- listing ids are stable and `orders` can reference them later.
--
-- Lifecycle: draft -> pending_review -> active -> sold | expired | removed
--                                   \-> rejected (with reason)
-- enforced by listings_enforce_lifecycle() below.

create type public.listing_type as enum ('graded_single', 'raw_single', 'sealed');
create type public.listing_status as enum ('draft', 'pending_review', 'active', 'rejected', 'sold', 'expired', 'removed');
create type public.card_condition as enum ('NM', 'LP', 'MP', 'HP', 'DMG');

create table public.listings (
  id bigint generated always as identity (start with 100001) primary key,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  listing_type public.listing_type not null,
  card_id uuid references public.cards (id) on delete restrict,
  sealed_product_id uuid references public.sealed_products (id) on delete restrict,
  lang text not null references public.languages (code),
  grader text,
  grade numeric(3, 1),
  grade_key text generated always as (public.grade_key(grader, grade)) stored,
  cert_number text check (cert_number ~ '^[0-9]{6,12}$'),
  cert_verified boolean not null default false,
  cert_mismatch boolean not null default false,
  cert_payload jsonb,                -- what the grader's cert API returned
  condition public.card_condition,
  title text not null check (char_length(title) between 3 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '' check (char_length(description) <= 4000),
  price_aud numeric(12, 2) not null check (price_aud > 0 and price_aud < 10000000),
  qty integer not null default 1 check (qty between 1 and 999),
  location_state public.au_state not null,
  postcode text check (postcode ~ '^[0-9]{4}$'),
  shipping jsonb not null default '{"pickup": false, "options": []}'::jsonb,
  status public.listing_status not null default 'draft',
  rejection_reason text,
  change_request text,
  submitted_at timestamptz,          -- first submission; drives quota counting
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  expires_at timestamptz,
  sold_at timestamptz,
  removed_at timestamptz,
  removed_reason text,
  featured_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored,
  check ((card_id is null) <> (sealed_product_id is null)),
  check (listing_type <> 'sealed' or sealed_product_id is not null),
  check (listing_type = 'sealed' or card_id is not null),
  check (listing_type <> 'graded_single' or (grader is not null and grade is not null)),
  check (listing_type = 'graded_single' or (grader is null and grade is null and cert_number is null)),
  check (listing_type <> 'raw_single' or condition is not null),
  check (grade is null or (grade >= 1 and grade <= 10))
);
alter table public.listings enable row level security;

-- The Buy-button query (brief 12): active count + lowest price per card+grade.
create index listings_buy_button_idx on public.listings (card_id, grade_key, status, price_aud);
create index listings_seller_idx on public.listings (seller_id, submitted_at desc);
create index listings_status_idx on public.listings (status, approved_at desc);
create index listings_search_idx on public.listings using gin (search);
create trigger touch_listings before update on public.listings
  for each row execute function public.touch_updated_at();

create table public.listing_images (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  storage_path text not null,
  kind text not null check (kind in ('front', 'back', 'slab-front', 'slab-back', 'other')),
  position smallint not null default 0,
  width integer,
  height integer,
  bytes integer check (bytes > 0),
  mime_type text,
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
alter table public.listing_images enable row level security;
create index listing_images_listing_idx on public.listing_images (listing_id, position);

create or replace function public.check_listing_image() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_types jsonb := public.setting('uploads.allowed_image_types');
begin
  if new.mime_type is not null and not (v_types ? new.mime_type) then
    raise exception 'image type % not allowed', new.mime_type using errcode = '22023';
  end if;
  if new.bytes is not null and new.bytes > public.setting_int('uploads.max_image_bytes') then
    raise exception 'image too large' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger listing_images_check before insert or update on public.listing_images
  for each row execute function public.check_listing_image();

-- Cached Buy-button data per card + grade, kept exact by trigger so the
-- homepage never runs an aggregate per row.
create table public.card_listing_stats (
  card_id uuid not null references public.cards (id) on delete cascade,
  grade_key text not null,
  active_count integer not null default 0,
  lowest_price_aud numeric(12, 2),
  updated_at timestamptz not null default now(),
  primary key (card_id, grade_key)
);
alter table public.card_listing_stats enable row level security;

create or replace function public.refresh_card_listing_stats(p_card uuid, p_grade_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_card is null then
    return;
  end if;
  insert into public.card_listing_stats (card_id, grade_key, active_count, lowest_price_aud, updated_at)
  select p_card, p_grade_key, count(*), min(price_aud), now()
  from public.listings
  where card_id = p_card and grade_key = p_grade_key and status = 'active'
  on conflict (card_id, grade_key) do update
    set active_count = excluded.active_count,
        lowest_price_aud = excluded.lowest_price_aud,
        updated_at = now();
end $$;

create or replace function public.listings_maintain_stats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_card_listing_stats(old.card_id, old.grade_key);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_card_listing_stats(new.card_id, new.grade_key);
  end if;
  return null;
end $$;
create trigger listings_stats after insert or update or delete on public.listings
  for each row execute function public.listings_maintain_stats();

-- ------------------------------------------------------------------ quota
-- Period key in the member's timezone, e.g. '2026-09'.
create or replace function public.user_timezone(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select timezone from public.profile_private where user_id = p_user),
    public.setting_text('quota.default_timezone'),
    'Australia/Melbourne')
$$;

create or replace function public.quota_limit(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select quota_override from public.profile_private where user_id = p_user),
    case public.effective_tier(p_user)
      when 'premium' then public.setting_int('quota.premium_per_period')
      else public.setting_int('quota.free_per_period')
    end)
$$;

-- Listings submitted in the current period. Mirrors
-- web/src/lib/domain/quota.ts (countQuotaUsage). A listing counts from its
-- FIRST submission; rejected ones count unless quota.count_rejected=false.
create or replace function public.quota_used(p_user uuid, p_at timestamptz default now()) returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := public.user_timezone(p_user);
  v_start timestamptz;
  v_count_rejected boolean := public.setting_bool('quota.count_rejected');
  v_n integer;
begin
  if public.setting_text('quota.period') = 'rolling_30_days' then
    v_start := p_at - interval '30 days';
  else
    v_start := (date_trunc('month', p_at at time zone v_tz)) at time zone v_tz;
  end if;
  select count(*) into v_n
  from public.listings
  where seller_id = p_user
    and submitted_at is not null
    and submitted_at >= v_start
    and submitted_at <= p_at
    and (v_count_rejected or status <> 'rejected');
  return v_n;
end $$;

-- The brief's listing_quota_usage(user_id, period, count), derived from
-- listings so it can never drift from the rule that enforces it.
create view public.listing_quota_usage with (security_invoker = true) as
select
  l.seller_id as user_id,
  to_char(l.submitted_at at time zone public.user_timezone(l.seller_id), 'YYYY-MM') as period,
  count(*) filter (where public.setting_bool('quota.count_rejected') or l.status <> 'rejected')::integer as count
from public.listings l
where l.submitted_at is not null
group by 1, 2;

create or replace function public.my_quota() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'used', public.quota_used(auth.uid()),
    'limit', public.quota_limit(auth.uid()),
    'tier', public.effective_tier(auth.uid()),
    'period', public.setting_text('quota.period'),
    'timezone', public.user_timezone(auth.uid()))
$$;

-- -------------------------------------------------------------- lifecycle
create or replace function public.listings_enforce_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_is_system boolean := auth.uid() is null;          -- service role / workers
  v_is_mod boolean := public.has_role('moderator');
  v_is_owner boolean := v_actor = coalesce(old.seller_id, new.seller_id);
  v_photos integer;
  v_recent integer;
begin
  if tg_op = 'INSERT' then
    if not v_is_system then
      if new.status <> 'draft' then
        raise exception 'new listings start as draft' using errcode = '22023';
      end if;
      if not public.is_active_user(v_actor) then
        raise exception 'account is not active' using errcode = '42501';
      end if;
      new.cert_verified := false;
      new.cert_mismatch := false;
      new.approved_by := null;
      new.approved_at := null;
      new.featured_until := null;
      new.submitted_at := null;
    end if;
    return new;
  end if;

  -- UPDATE ----------------------------------------------------------------
  if not v_is_system and not v_is_mod then
    -- Owners cannot touch moderation or system fields.
    if (new.seller_id, new.approved_by, new.approved_at, new.featured_until, new.cert_verified,
        new.cert_mismatch, new.cert_payload, new.rejection_reason, new.change_request, new.submitted_at,
        new.expires_at, new.removed_reason)
       is distinct from
       (old.seller_id, old.approved_by, old.approved_at, old.featured_until, old.cert_verified,
        old.cert_mismatch, old.cert_payload, old.rejection_reason, old.change_request, old.submitted_at,
        old.expires_at, old.removed_reason) then
      raise exception 'not allowed to change moderation fields' using errcode = '42501';
    end if;
    -- Once live, what is being sold can't change: withdraw and relist instead.
    if old.status not in ('draft') and
       (new.listing_type, new.card_id, new.sealed_product_id, new.lang, new.grader, new.grade, new.cert_number, new.condition)
       is distinct from
       (old.listing_type, old.card_id, old.sealed_product_id, old.lang, old.grader, old.grade, old.cert_number, old.condition) then
      raise exception 'item details are locked after submission' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    case
      -- Seller submits for review.
      when old.status = 'draft' and new.status = 'pending_review' and (v_is_owner or v_is_system) then
        select count(*) into v_photos from public.listing_images
          where listing_id = new.id and kind in ('front', 'back', 'slab-front', 'slab-back');
        if v_photos < public.setting_int('listings.min_photos') then
          raise exception 'at least % photos (front and back) are required', public.setting_int('listings.min_photos')
            using errcode = '22023';
        end if;
        if new.submitted_at is null then
          -- Serialise a seller's submissions so two tabs can't both take the last slot.
          perform pg_advisory_xact_lock(hashtext('listing-quota:' || new.seller_id::text));
          select count(*) into v_recent from public.listings
            where seller_id = new.seller_id and submitted_at > now() - interval '1 hour';
          if v_recent >= public.setting_int('listings.max_submissions_per_hour') then
            raise exception 'RATE_LIMITED: too many listings submitted in the last hour' using errcode = 'P0001';
          end if;
          if public.quota_used(new.seller_id) >= public.quota_limit(new.seller_id) then
            raise exception 'QUOTA_EXCEEDED: listing quota for this period is used up' using errcode = 'P0001';
          end if;
          new.submitted_at := now();
        end if;
        new.change_request := null;
        -- Optional: trusted sellers skip review (off by default).
        if public.setting_bool('listings.auto_approve_trusted')
           and exists (select 1 from public.profile_private where user_id = new.seller_id and trusted_seller)
           and not new.cert_mismatch then
          new.status := 'active';
          new.approved_at := now();
          new.expires_at := now() + make_interval(days => public.setting_int('listings.expiry_days'));
        end if;
      -- Moderation.
      when old.status = 'pending_review' and new.status = 'active' and (v_is_mod or v_is_system) then
        new.approved_by := coalesce(new.approved_by, v_actor);
        new.approved_at := now();
        new.expires_at := now() + make_interval(days => public.setting_int('listings.expiry_days'));
      when old.status = 'pending_review' and new.status = 'rejected' and (v_is_mod or v_is_system) then
        if coalesce(trim(new.rejection_reason), '') = '' then
          raise exception 'a rejection reason is required' using errcode = '22023';
        end if;
      when old.status = 'pending_review' and new.status = 'draft' and (v_is_mod or v_is_system) then
        -- "request changes": back to the seller; resubmitting won't count again.
        if coalesce(trim(new.change_request), '') = '' then
          raise exception 'say what needs changing' using errcode = '22023';
        end if;
      -- Seller or moderator closes a live listing.
      when old.status = 'active' and new.status = 'sold' and (v_is_owner or v_is_mod or v_is_system) then
        new.sold_at := now();
      when old.status in ('active', 'pending_review', 'draft') and new.status = 'removed' and (v_is_owner or v_is_mod or v_is_system) then
        new.removed_at := now();
      when old.status = 'active' and new.status = 'expired' and (v_is_mod or v_is_system) then
        null;
      -- Renewal of an expired listing (already approved once; no new quota).
      when old.status = 'expired' and new.status = 'active' and (v_is_owner or v_is_mod or v_is_system) then
        new.expires_at := now() + make_interval(days => public.setting_int('listings.expiry_days'));
      else
        raise exception 'listing cannot move from % to %', old.status, new.status using errcode = '22023';
    end case;
  end if;
  return new;
end $$;
create trigger listings_lifecycle before insert or update on public.listings
  for each row execute function public.listings_enforce_lifecycle();

-- Seller renews an active listing close to expiry (renewal email link).
create or replace function public.renew_listing(p_listing bigint) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_new timestamptz;
begin
  update public.listings
     set expires_at = now() + make_interval(days => public.setting_int('listings.expiry_days'))
   where id = p_listing and seller_id = auth.uid() and status = 'active'
   returning expires_at into v_new;
  if v_new is null then
    raise exception 'listing not found or not active' using errcode = 'P0002';
  end if;
  return v_new;
end $$;

-- -------------------------------------------------- saved searches & wishlist
create table public.saved_searches (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) <= 80),
  query jsonb not null,              -- {game, lang, set_id, grade_key, price_max, state, listing_type, q}
  email_alerts boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.saved_searches enable row level security;
create index saved_searches_user_idx on public.saved_searches (user_id);

-- Also backs "Set alert" (notify me when listed) on the market cap table.
create table public.wishlist_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  card_id uuid references public.cards (id) on delete cascade,
  sealed_product_id uuid references public.sealed_products (id) on delete cascade,
  grade_key text,                    -- null = any grade
  max_price_aud numeric(12, 2),
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  check ((card_id is null) <> (sealed_product_id is null))
);
alter table public.wishlist_items enable row level security;
create unique index wishlist_unique_idx on public.wishlist_items
  (user_id, coalesce(card_id, sealed_product_id), coalesce(grade_key, '*'));
create index wishlist_card_idx on public.wishlist_items (card_id, grade_key);

-- ---------------------------------------------------------- trust & safety
create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('listing', 'user', 'conversation', 'message')),
  target_id text not null,
  reason text not null check (reason in ('scam', 'counterfeit', 'misrepresented', 'offensive', 'spam', 'off_platform_payment', 'other')),
  details text check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
create index reports_open_idx on public.reports (status, created_at) where status = 'open';
create index reports_target_idx on public.reports (target_type, target_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;

create table public.banned_words (
  word citext primary key,
  severity text not null default 'block' check (severity in ('block', 'flag'))
);
alter table public.banned_words enable row level security;
insert into public.banned_words (word, severity) values
  ('proxy', 'block'), ('replica', 'block'), ('orica', 'block'),
  ('paypal friends', 'flag'), ('friends and family', 'flag'), ('crypto only', 'flag'),
  ('western union', 'flag'), ('gift card', 'flag');

-- Titles/descriptions containing blocked words can't be submitted; flagged
-- words are allowed but surfaced to moderators.
create or replace function public.listing_banned_words(p_text text) returns table (word citext, severity text)
language sql stable security definer set search_path = public as $$
  select b.word, b.severity from public.banned_words b
  where lower(p_text) like '%' || lower(b.word::text) || '%'
$$;

create or replace function public.listings_check_words() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending_review' and exists (
    select 1 from public.listing_banned_words(new.title || ' ' || new.description) where severity = 'block'
  ) then
    raise exception 'listing contains words that are not allowed (fakes/proxies are banned)' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger listings_words before update of status on public.listings
  for each row execute function public.listings_check_words();

-- --------------------------------------------------------------- policies
create policy "listings: public sees live and historical" on public.listings for select
  using (status in ('active', 'sold', 'expired') or seller_id = auth.uid() or public.has_role('moderator'));
create policy "listings: owner creates" on public.listings for insert
  with check (seller_id = auth.uid());
create policy "listings: owner updates" on public.listings for update
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());
create policy "listings: moderators update" on public.listings for update
  using (public.has_role('moderator')) with check (public.has_role('moderator'));
create policy "listings: owner deletes drafts" on public.listings for delete
  using (seller_id = auth.uid() and status = 'draft');

create policy "listing_images: visible with listing" on public.listing_images for select
  using (exists (select 1 from public.listings l where l.id = listing_id));
create policy "listing_images: owner manages while draft" on public.listing_images for all
  using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid() and l.status = 'draft'))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid() and l.status = 'draft'));
create policy "listing_images: moderators manage" on public.listing_images for all
  using (public.has_role('moderator')) with check (public.has_role('moderator'));

create policy "card_listing_stats: public read" on public.card_listing_stats for select using (true);

create policy "saved_searches: owner" on public.saved_searches for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "wishlist: owner" on public.wishlist_items for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "reports: reporter creates" on public.reports for insert
  with check (reporter_id = auth.uid() and status = 'open');
create policy "reports: reporter or moderator reads" on public.reports for select
  using (reporter_id = auth.uid() or public.has_role('moderator'));
create policy "reports: moderators resolve" on public.reports for update
  using (public.has_role('moderator')) with check (public.has_role('moderator'));

create policy "blocks: owner" on public.blocks for all
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
create policy "blocks: moderators read" on public.blocks for select using (public.has_role('moderator'));

create policy "banned_words: moderators" on public.banned_words for all
  using (public.has_role('moderator')) with check (public.has_role('moderator'));

-- ------------------------------------------------------------ storage
-- Listing photos and message attachments live in private Supabase Storage
-- buckets with type and size limits. Skipped when the storage schema is
-- absent (plain-Postgres tests).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('listing-images', 'listing-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
      ('message-attachments', 'message-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    -- Uploads go under {user_id}/...; only the owner may write there.
    execute $p$
      create policy "listing images: owner uploads" on storage.objects for insert to authenticated
      with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
    execute $p$
      create policy "listing images: owner deletes" on storage.objects for delete to authenticated
      using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
    execute $p$
      create policy "attachments: owner uploads" on storage.objects for insert to authenticated
      with check (bucket_id = 'message-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  end if;
end $$;

-- What the public listing URL should do (brief 7.4), without exposing the
-- listing itself: rejected/removed rows are invisible under RLS, but their URL
-- must still answer 410 rather than 404. Returns only status, the title (the
-- canonical URL slug is derived from it), and the card's marketplace path.
-- Draft/pending titles are withheld so they never leak.
create or replace function public.listing_url_status(p_listing bigint)
returns table (status public.listing_status, title text, closed_at timestamptz, card_market_path text)
language sql stable security definer set search_path = public as $$
  select l.status,
         case when l.status in ('active', 'sold', 'expired') then l.title end,
         coalesce(l.sold_at, case when l.status = 'expired' then l.expires_at end),
         case when l.card_id is not null then public.card_market_path(l.card_id) else '/marketplace/' end
  from public.listings l where l.id = p_listing
$$;
