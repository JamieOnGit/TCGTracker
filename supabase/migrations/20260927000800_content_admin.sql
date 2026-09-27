-- Content (news CMS), public API keys, and the admin audit log (brief 8, 10).

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category text not null check (category in ('pokemon', 'one-piece', 'market', 'drops', 'guides', 'grading')),
  title text not null,
  dek text,                          -- standfirst / meta description fallback
  body_md text not null default '',
  hero_image_url text,
  hero_image_alt text,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'scheduled', 'published', 'archived')),
  auto_generated boolean not null default false, -- market-mover / drop recap drafts need editorial review
  published_at timestamptz,
  author_id uuid references public.profiles (id),
  seo_title text,
  seo_description text,
  canonical_override text,
  og_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('scheduled', 'published') or published_at is not null)
);
alter table public.articles enable row level security;
create index articles_published_idx on public.articles (status, published_at desc);
create trigger touch_articles before update on public.articles
  for each row execute function public.touch_updated_at();

create table public.article_tags (
  article_id uuid not null references public.articles (id) on delete cascade,
  tag_type text not null check (tag_type in ('card', 'set', 'game', 'sealed_product')),
  card_id uuid references public.cards (id) on delete cascade,
  set_id uuid references public.sets (id) on delete cascade,
  game text references public.games (code),
  sealed_product_id uuid references public.sealed_products (id) on delete cascade,
  check (num_nonnulls(card_id, set_id, game, sealed_product_id) = 1)
);
alter table public.article_tags enable row level security;
create unique index article_tags_unique_idx on public.article_tags
  (article_id, tag_type, coalesce(card_id::text, set_id::text, game, sealed_product_id::text));
create index article_tags_card_idx on public.article_tags (card_id) where card_id is not null;
create index article_tags_set_idx on public.article_tags (set_id) where set_id is not null;

-- ------------------------------------------------------------ public API keys
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  prefix text not null unique,       -- shown to the user, e.g. "tcg_live_ab12"
  key_hash text not null unique,     -- sha-256 of the secret; the secret is shown once
  plan text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  requests_per_minute integer not null default 30,
  requests_per_day integer not null default 1000,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.api_keys enable row level security;

-- ------------------------------------------------------------ audit log
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role public.app_role,
  action text not null,              -- e.g. 'listings.update', 'thread.read'
  target_type text not null,
  target_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id);

-- Logs every write a STAFF member makes to the tables below, whoever else
-- they are. Service-role (worker) writes have no auth.uid() and are logged
-- by pipeline_runs instead.
create or replace function public.audit_staff_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role;
  v_target text;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_role := public.current_role_of(auth.uid());
  if v_role = 'user' then
    return null;
  end if;
  v_target := coalesce(
    to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id',
    to_jsonb(new) ->> 'key', to_jsonb(old) ->> 'key',
    to_jsonb(new) ->> 'user_id', to_jsonb(old) ->> 'user_id',
    to_jsonb(new) ->> 'from_path', to_jsonb(old) ->> 'from_path');
  insert into public.admin_audit_log (actor_id, actor_role, action, target_type, target_id, before, after)
  values (
    auth.uid(), v_role, tg_table_name || '.' || lower(tg_op), tg_table_name, v_target,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'site_settings', 'profiles', 'profile_private', 'sets', 'cards', 'card_external_ids', 'mapping_queue',
    'sealed_products', 'redirects', 'price_points', 'listings', 'listing_images', 'reports', 'banned_words',
    'retailers', 'rrp_reference', 'watchlist', 'drop_events', 'articles', 'article_tags', 'api_keys'
  ] loop
    execute format(
      'create trigger audit_staff_write after insert or update or delete on public.%I
         for each row execute function public.audit_staff_write()', t);
  end loop;
end $$;

-- Admins may read a message thread ONLY if it has been reported, and every
-- read is logged (brief 6.1).
create or replace function public.admin_read_reported_thread(p_conversation uuid)
returns table (id bigint, sender_id uuid, body text, attachment_path text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('moderator') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reports r
    where (r.target_type = 'conversation' and r.target_id = p_conversation::text)
       or (r.target_type = 'message' and r.target_id in (
            select m.id::text from public.messages m where m.conversation_id = p_conversation))
  ) then
    raise exception 'thread has not been reported' using errcode = '42501';
  end if;
  insert into public.admin_audit_log (actor_id, actor_role, action, target_type, target_id)
  values (auth.uid(), public.current_role_of(auth.uid()), 'thread.read', 'conversations', p_conversation::text);
  return query
    select m.id, m.sender_id, m.body, m.attachment_path, m.created_at
    from public.messages m where m.conversation_id = p_conversation order by m.created_at;
end $$;

-- --------------------------------------------------------------- policies
create policy "articles: published are public" on public.articles for select
  using ((status = 'published' and published_at <= now()) or public.has_role('editor'));
create policy "articles: editors write" on public.articles for all
  using (public.has_role('editor')) with check (public.has_role('editor'));

create policy "article_tags: public read" on public.article_tags for select using (true);
create policy "article_tags: editors write" on public.article_tags for all
  using (public.has_role('editor')) with check (public.has_role('editor'));

create policy "api_keys: owner reads" on public.api_keys for select
  using (user_id = auth.uid() or public.has_role('admin'));
create policy "api_keys: owner revokes" on public.api_keys for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Keys are created by a server route (service role) so the secret is only
-- ever generated server-side.

create policy "audit: admins read" on public.admin_audit_log for select
  using (public.has_role('admin'));
-- No insert/update/delete policies: the log is append-only via triggers and
-- security-definer functions.
