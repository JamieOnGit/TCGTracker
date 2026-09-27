-- Messaging & notifications (brief 6).
-- Only the two participants can read a thread. Admins cannot read threads
-- through RLS at all: they call admin_read_reported_thread(), which only
-- works for REPORTED threads and writes an audit-log row every time.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id bigint not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  buyer_last_read_at timestamptz,
  seller_last_read_at timestamptz,
  unique (listing_id, buyer_id),
  check (buyer_id <> seller_id)
);
alter table public.conversations enable row level security;
create index conversations_buyer_idx on public.conversations (buyer_id, last_message_at desc);
create index conversations_seller_idx on public.conversations (seller_id, last_message_at desc);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  attachment_path text,
  attachment_bytes integer,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create or replace function public.is_participant(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations
    where id = p_conversation and auth.uid() in (buyer_id, seller_id)
  )
$$;

create or replace function public.is_blocked_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a)
  )
$$;

-- Opening a conversation: seller comes from the listing (never from the
-- client), the listing must be live, and neither side may have blocked the other.
create or replace function public.conversations_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_listing record;
begin
  select seller_id, status into v_listing from public.listings where id = new.listing_id;
  if v_listing is null or v_listing.status <> 'active' then
    raise exception 'listing is not available' using errcode = '22023';
  end if;
  new.seller_id := v_listing.seller_id;
  if auth.uid() is not null then
    new.buyer_id := auth.uid();
  end if;
  if new.buyer_id = new.seller_id then
    raise exception 'you cannot message yourself' using errcode = '22023';
  end if;
  if public.is_blocked_between(new.buyer_id, new.seller_id) then
    raise exception 'messaging is blocked between these users' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger conversations_before_insert before insert on public.conversations
  for each row execute function public.conversations_before_insert();

create or replace function public.messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_conv record;
  v_other uuid;
  v_recent integer;
begin
  select * into v_conv from public.conversations where id = new.conversation_id;
  if v_conv.id is null then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if auth.uid() is not null then
    new.sender_id := auth.uid();
  end if;
  if new.sender_id not in (v_conv.buyer_id, v_conv.seller_id) then
    raise exception 'not a participant' using errcode = '42501';
  end if;
  if not public.is_active_user(new.sender_id) then
    raise exception 'account is not active' using errcode = '42501';
  end if;
  v_other := case when new.sender_id = v_conv.buyer_id then v_conv.seller_id else v_conv.buyer_id end;
  if public.is_blocked_between(new.sender_id, v_other) then
    raise exception 'messaging is blocked between these users' using errcode = '42501';
  end if;
  select count(*) into v_recent from public.messages
    where sender_id = new.sender_id and created_at > now() - interval '1 minute';
  if v_recent >= public.setting_int('messages.max_per_minute') then
    raise exception 'RATE_LIMITED: slow down' using errcode = 'P0001';
  end if;
  if new.attachment_bytes is not null and new.attachment_bytes > public.setting_int('messages.max_attachment_bytes') then
    raise exception 'attachment too large' using errcode = '22023';
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         buyer_last_read_at = case when new.sender_id = buyer_id then new.created_at else buyer_last_read_at end,
         seller_last_read_at = case when new.sender_id = seller_id then new.created_at else seller_last_read_at end
   where id = new.conversation_id;
  return null;
end $$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

create or replace function public.mark_conversation_read(p_conversation uuid) returns void
language sql security definer set search_path = public as $$
  update public.conversations
     set buyer_last_read_at = case when auth.uid() = buyer_id then now() else buyer_last_read_at end,
         seller_last_read_at = case when auth.uid() = seller_id then now() else seller_last_read_at end
   where id = p_conversation and auth.uid() in (buyer_id, seller_id)
$$;

-- Inbox with unread counts for the current user.
create view public.my_inbox with (security_invoker = true) as
select
  c.id,
  c.listing_id,
  c.buyer_id,
  c.seller_id,
  c.last_message_at,
  (select count(*) from public.messages m
    where m.conversation_id = c.id
      and m.sender_id <> auth.uid()
      and m.created_at > coalesce(case when auth.uid() = c.buyer_id then c.buyer_last_read_at else c.seller_last_read_at end, '-infinity'))::integer as unread_count
from public.conversations c
where auth.uid() in (c.buyer_id, c.seller_id);

-- ------------------------------------------------------------ notifications
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,                -- message | listing_status | saved_search | wishlist | drop | billing | system
  title text not null,
  body text,
  url text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Per alert type x channel (brief 6.2 preferences centre). Missing row =
-- the default in notification_default().
create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  alert_type text not null check (alert_type in (
    'message', 'listing_status', 'listing_expiring', 'saved_search', 'wishlist',
    'drop', 'billing', 'weekly_digest', 'marketing')),
  channel text not null check (channel in ('email', 'onsite', 'discord')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, alert_type, channel)
);
alter table public.notification_preferences enable row level security;

-- Marketing and the digest are opt-in (Spam Act 2003); transactional alerts
-- default on. Discord is off until a member links it.
create or replace function public.notification_default(p_type text, p_channel text) returns boolean
language sql immutable as $$
  select case
    when p_channel = 'discord' then false
    when p_type in ('weekly_digest', 'marketing') then false
    else true
  end
$$;

create or replace function public.wants_notification(p_user uuid, p_type text, p_channel text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select enabled from public.notification_preferences
      where user_id = p_user and alert_type = p_type and channel = p_channel),
    public.notification_default(p_type, p_channel))
$$;

-- Drop-alert filters: which games and retailers a Premium member wants.
create table public.drop_alert_filters (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  games text[] not null default array['pokemon', 'one-piece'],
  retailer_slugs text[],             -- null = all retailers
  event_types text[],                -- null = all event types
  only_at_or_below_rrp boolean not null default false,
  discord_user_id text,
  updated_at timestamptz not null default now()
);
alter table public.drop_alert_filters enable row level security;

create table public.email_log (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  template text not null,
  to_email text not null,
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'bounced', 'complained', 'suppressed')),
  dedupe_key text unique,            -- prevents duplicate sends (e.g. batched message digests)
  error text,
  created_at timestamptz not null default now()
);
alter table public.email_log enable row level security;
create index email_log_user_idx on public.email_log (user_id, created_at desc);

-- One-click unsubscribe tokens (RFC 8058 List-Unsubscribe-Post).
create table public.unsubscribe_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  alert_type text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.unsubscribe_tokens enable row level security;

-- --------------------------------------------------------------- policies
create policy "conversations: participants read" on public.conversations for select
  using (auth.uid() in (buyer_id, seller_id));
create policy "conversations: buyers open" on public.conversations for insert
  with check (buyer_id = auth.uid());

create policy "messages: participants read" on public.messages for select
  using (public.is_participant(conversation_id));
create policy "messages: participants send" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_participant(conversation_id));

create policy "notifications: owner reads" on public.notifications for select
  using (user_id = auth.uid());
create policy "notifications: owner marks read" on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "notification_preferences: owner" on public.notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "drop_alert_filters: owner" on public.drop_alert_filters for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "email_log: admin reads" on public.email_log for select
  using (public.has_role('admin'));
-- unsubscribe_tokens: service role only (no policies).
