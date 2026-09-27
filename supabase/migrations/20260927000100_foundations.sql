-- Foundations: extensions, enums, settings, users/roles and the helper
-- functions every RLS policy leans on.
--
-- Conventions
--   * Row Level Security is enabled on EVERY table in `public`. A test
--     (supabase/tests/rls.test.sql) fails the build if one is missed.
--   * Business rules (prices, quotas, intervals, thresholds) live in
--     `site_settings`, never in code or SQL literals. Read them with
--     public.setting(key).
--   * Staff writes are audit-logged by triggers (see 20260927000800).

create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- --------------------------------------------------------------- enums
create type public.app_role as enum ('user', 'editor', 'moderator', 'admin');
create type public.account_status as enum ('active', 'suspended', 'banned');
create type public.tier as enum ('free', 'premium');
create type public.au_state as enum ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA');

-- --------------------------------------------------------------- settings
create table public.site_settings (
  key text primary key,
  value jsonb not null,
  description text,
  is_public boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;

-- Every business rule the brief says must be configurable. Values are the
-- brief's defaults; change them in the admin console, not here.
insert into public.site_settings (key, value, description) values
  ('billing.currency',                   '"AUD"',               'Display and billing currency'),
  ('billing.premium_monthly_cents',      '1299',                'Premium monthly price in AUD cents, GST inclusive'),
  ('billing.premium_annual_cents',       'null',                'Annual price in AUD cents (null = not offered yet)'),
  ('billing.founder_monthly_cents',      'null',                'Founder price in AUD cents (null = not offered)'),
  ('billing.gst_inclusive',              'true',                'Prices shown include GST'),
  ('billing.grace_period_days',          '7',                   'Days a past_due subscription keeps Premium before downgrade'),
  ('quota.free_per_period',              '5',                   'Listings a Free member may submit per quota period'),
  ('quota.premium_per_period',           '30',                  'Listings a Premium member may submit per quota period'),
  ('quota.period',                       '"calendar_month"',    'calendar_month | rolling_30_days'),
  ('quota.count_rejected',               'true',                'Rejected listings still count toward the quota'),
  ('quota.default_timezone',             '"Australia/Melbourne"','Timezone used for calendar-month quotas when a user has none'),
  ('listings.expiry_days',               '60',                  'Days an approved listing stays active'),
  ('listings.expiry_warning_days',       '5',                   'Days before expiry to send the renewal email'),
  ('listings.sold_visible_days',         '90',                  'Days a sold/expired listing stays live before 301 to the card marketplace page'),
  ('listings.min_photos',                '2',                   'Minimum photos per listing (front and back)'),
  ('listings.auto_approve_trusted',      'false',               'Skip review for trusted sellers'),
  ('listings.max_submissions_per_hour',  '10',                  'Rate limit on listing submissions per user'),
  ('messages.max_per_minute',            '20',                  'Rate limit on messages sent per user'),
  ('messages.max_attachment_bytes',      '5242880',             'Largest message attachment (5 MB)'),
  ('uploads.allowed_image_types',        '["image/jpeg","image/png","image/webp"]', 'Upload MIME allowlist'),
  ('uploads.max_image_bytes',            '10485760',            'Largest listing photo (10 MB)'),
  ('market.primary_grade',               '"psa-10"',            'Grade shown by default on the market cap view'),
  ('market.outlier_min_ratio',           '0.5',                 'Asks below this fraction of the 30-day sold median are ignored as outliers'),
  ('market.outlier_min_sales',           '3',                   'Sold data points needed before the outlier rule applies'),
  ('market.floor_refresh_hours',         '4',                   'How often floor prices are recomputed'),
  ('market.population_refresh_hours',    '24',                  'How often population data is ingested'),
  ('market.fx_refresh_hours',            '24',                  'How often FX rates are refreshed'),
  ('market.external_ask_max_age_days',  '7',                   'External asks older than this are ignored for the floor'),
  ('market.matcher_auto_accept',         '0.95',                'Auto-matcher confidence at/above which a price record is linked without review'),
  ('features.external_buy_fallback',     'false',               'Show an external (affiliate) buy link when no listings exist'),
  ('features.discord_alerts',            'false',               'Deliver drop alerts to Discord'),
  ('drops.public_delay_minutes',         '30',                  'Delay before a drop event appears in the public history'),
  ('drops.free_delayed_alerts',          'false',               'Send Free members delayed drop alerts'),
  ('drops.suppress_above_rrp_pct',       '50',                  'Suppress marketplace-seller listings on retailer sites this far above RRP (percent)'),
  ('drops.rrp_tolerance_pct',            '2',                    'Within this percent of RRP counts as AT RRP'),
  ('drops.zero_product_alert_cycles',    '5',                   'Adapter health alert after this many empty cycles'),
  ('site.announcement',                  'null',                'Announcement banner text (null = none)');

-- A few settings are operational rather than public.
update public.site_settings set is_public = false
where key in ('market.matcher_auto_accept', 'listings.max_submissions_per_hour', 'messages.max_per_minute');

-- Typed read of a setting. SECURITY DEFINER so triggers running as an
-- ordinary user can read non-public settings.
create or replace function public.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.site_settings where key = p_key
$$;

create or replace function public.setting_int(p_key text) returns integer
language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::integer from public.site_settings where key = p_key
$$;

create or replace function public.setting_num(p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::numeric from public.site_settings where key = p_key
$$;

create or replace function public.setting_bool(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((value #>> '{}')::boolean, false) from public.site_settings where key = p_key
$$;

create or replace function public.setting_text(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value #>> '{}' from public.site_settings where key = p_key
$$;

-- --------------------------------------------------------------- users
-- Public profile: only what may be shown on a seller page.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username citext not null unique
    check (username ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  display_name text check (char_length(display_name) <= 60),
  avatar_url text,
  location_state public.au_state,
  bio text check (char_length(bio) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Private profile: owner and staff only. Contact details are never exposed
-- to other users (brief 6.1).
create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role public.app_role not null default 'user',
  status public.account_status not null default 'active',
  suspended_until timestamptz,
  timezone text not null default 'Australia/Melbourne',
  postcode text check (postcode ~ '^[0-9]{4}$'),
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  tier_override public.tier,
  quota_override integer check (quota_override >= 0),
  trusted_seller boolean not null default false,
  staff_notes text,
  updated_at timestamptz not null default now()
);
alter table public.profile_private enable row level security;

create or replace function public.current_role_of(p_user uuid) returns public.app_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profile_private where user_id = p_user), 'user'::public.app_role)
$$;

-- True when the calling user holds any of the given roles. Admin implies all.
create or replace function public.has_role(variadic p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profile_private
    where user_id = auth.uid()
      and status = 'active'
      and (role = 'admin' or role = any (p_roles))
  )
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin', 'moderator', 'editor')
$$;

create or replace function public.is_active_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profile_private
    where user_id = p_user
      and (status = 'active' or (status = 'suspended' and suspended_until is not null and suspended_until < now()))
  )
$$;

-- New auth user -> profile rows. Username comes from sign-up metadata or a
-- generated fallback the user can change later.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
begin
  if v_username !~ '^[a-z0-9][a-z0-9_-]{2,29}$'
     or exists (select 1 from public.profiles where username = v_username) then
    v_username := 'collector-' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  insert into public.profiles (id, username) values (new.id, v_username);
  insert into public.profile_private (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may edit their own private profile, but not the fields that grant
-- privileges. Staff changes go through the admin console (audit-logged).
create or replace function public.guard_profile_private() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.has_role('admin') then
    return new; -- service role / migrations / admins
  end if;
  if public.has_role('moderator') and new.user_id <> auth.uid() then
    -- moderators may suspend/ban, nothing else
    if (new.role, new.tier_override, new.quota_override, new.trusted_seller)
       is distinct from (old.role, old.tier_override, old.quota_override, old.trusted_seller) then
      raise exception 'only admins can change roles, tiers or quotas' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.role, new.status, new.suspended_until, new.tier_override, new.quota_override,
      new.trusted_seller, new.staff_notes)
     is distinct from (old.role, old.status, old.suspended_until, old.tier_override,
      old.quota_override, old.trusted_seller, old.staff_notes) then
    raise exception 'not allowed to change privileged profile fields' using errcode = '42501';
  end if;
  if new.marketing_opt_in and not old.marketing_opt_in then
    new.marketing_opt_in_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger guard_profile_private
  before update on public.profile_private
  for each row execute function public.guard_profile_private();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------- policies
create policy "settings: public ones readable by all"
  on public.site_settings for select
  using (is_public or public.is_staff());
create policy "settings: admins write"
  on public.site_settings for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "profiles: readable by all"
  on public.profiles for select using (true);
create policy "profiles: owner updates"
  on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles: staff update"
  on public.profiles for update
  using (public.has_role('moderator')) with check (public.has_role('moderator'));

create policy "profile_private: owner or staff reads"
  on public.profile_private for select
  using (user_id = auth.uid() or public.has_role('moderator'));
create policy "profile_private: owner updates"
  on public.profile_private for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profile_private: moderators update"
  on public.profile_private for update
  using (public.has_role('moderator')) with check (public.has_role('moderator'));
