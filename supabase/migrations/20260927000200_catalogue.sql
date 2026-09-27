-- Catalogue: the one canonical card entity that market cap, listings, alerts,
-- news tags and URLs all reference (brief 4.4). JP and EN versions of a card
-- are separate rows with separate slugs, prices and listings; they are only
-- ever linked by counterpart_card_id, never merged.

create table public.games (
  code text primary key check (code in ('pokemon', 'one-piece')),
  name text not null,
  sort_order smallint not null default 0
);
alter table public.games enable row level security;

create table public.languages (
  code text primary key check (code in ('en', 'jp')),
  name text not null,
  sort_order smallint not null default 0
);
alter table public.languages enable row level security;

insert into public.games (code, name, sort_order) values
  ('pokemon', 'Pokémon TCG', 1),
  ('one-piece', 'One Piece Card Game', 2);
insert into public.languages (code, name, sort_order) values
  ('en', 'English', 1),
  ('jp', 'Japanese', 2);

-- Lowercase, hyphenated, ASCII slug. Used for every URL segment.
create or replace function public.slugify(p text) returns text
language sql immutable strict set search_path = public, extensions as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(lower(unaccent(replace(replace(p, '.', ' '), '''', ''))), '[^a-z0-9]+', '-', 'g'),
    '-{2,}', '-', 'g'))
$$;

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  game text not null references public.games (code),
  lang text not null references public.languages (code),
  code text not null,                -- e.g. sv3pt5 / SV2a / OP05
  name text not null,                -- e.g. "151" / "Awakening of the New Era"
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  series text,
  release_date date,
  total_cards integer,
  intro text,                        -- unique set-page copy (brief 7.5)
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game, lang, code),
  unique (game, lang, slug)
);
alter table public.sets enable row level security;
create trigger touch_sets before update on public.sets
  for each row execute function public.touch_updated_at();

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete restrict,
  -- game/lang are copied from the set by trigger so hot queries avoid a join.
  game text not null references public.games (code),
  lang text not null references public.languages (code),
  number text not null,              -- printed number: "199" (of 165), "OP05-119"
  printed_total text,                -- "165" for "199/165"
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), -- "{number}-{name}[-{variant}]"
  variant text not null default 'standard', -- standard, holo, reverse-holo, alt-art, sar, manga, parallel, promo...
  rarity text,
  release_date date,
  image_url text,
  image_source text,                 -- provenance, for image-rights review
  psa_spec_id text,
  counterpart_card_id uuid references public.cards (id) on delete set null,
  is_excluded boolean not null default false, -- admin: hide from rankings
  search tsvector generated always as (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(number, '') || ' ' || coalesce(variant, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (set_id, number, variant),
  unique (set_id, slug),
  check (counterpart_card_id is null or counterpart_card_id <> id)
);
alter table public.cards enable row level security;
create index cards_search_idx on public.cards using gin (search);
create index cards_name_trgm_idx on public.cards using gin (name gin_trgm_ops);
create index cards_game_lang_idx on public.cards (game, lang);
create index cards_psa_spec_idx on public.cards (psa_spec_id) where psa_spec_id is not null;
create trigger touch_cards before update on public.cards
  for each row execute function public.touch_updated_at();

create or replace function public.cards_inherit_set() returns trigger
language plpgsql as $$
begin
  select game, lang into new.game, new.lang from public.sets where id = new.set_id;
  return new;
end $$;
create trigger cards_inherit_set before insert or update of set_id on public.cards
  for each row execute function public.cards_inherit_set();

-- A counterpart must be the same game in the OTHER language.
create or replace function public.check_counterpart() returns trigger
language plpgsql as $$
declare
  v_other record;
begin
  if new.counterpart_card_id is null then
    return new;
  end if;
  select game, lang into v_other from public.cards where id = new.counterpart_card_id;
  if v_other.game <> new.game or v_other.lang = new.lang then
    raise exception 'counterpart must be the same game in the other language';
  end if;
  return new;
end $$;
create trigger cards_check_counterpart before insert or update of counterpart_card_id on public.cards
  for each row execute function public.check_counterpart();

-- Every external price/population record maps to exactly one catalogue card.
create table public.card_external_ids (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards (id) on delete cascade,
  source text not null,              -- e.g. 'psa-spec', 'pricecharting'
  external_id text not null,
  lang text not null references public.languages (code),
  variant text,
  match_confidence numeric(4, 3) check (match_confidence between 0 and 1),
  match_method text not null default 'manual', -- auto | manual | admin
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);
alter table public.card_external_ids enable row level security;
create index card_external_ids_card_idx on public.card_external_ids (card_id);

-- The external record's language must match the card's. This is the guard
-- that stops a JP price landing on an EN card.
create or replace function public.check_external_lang() returns trigger
language plpgsql as $$
begin
  if new.lang <> (select lang from public.cards where id = new.card_id) then
    raise exception 'external id language (%) does not match card language', new.lang;
  end if;
  return new;
end $$;
create trigger card_external_ids_lang before insert or update on public.card_external_ids
  for each row execute function public.check_external_lang();

-- Low-confidence or unmatched external records wait here for an admin
-- (brief 4.2, 10). Nothing is silently dropped or mis-linked.
create type public.mapping_status as enum ('pending', 'approved', 'rejected', 'created_card');

create table public.mapping_queue (
  id bigint generated always as identity primary key,
  source text not null,
  external_id text not null,
  payload jsonb not null,            -- the raw record: name, set, number, lang, variant...
  game text references public.games (code),
  lang text references public.languages (code),
  suggested_card_id uuid references public.cards (id) on delete set null,
  confidence numeric(4, 3),
  reasons jsonb not null default '[]'::jsonb,
  status public.mapping_status not null default 'pending',
  resolved_card_id uuid references public.cards (id) on delete set null,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);
alter table public.mapping_queue enable row level security;
create index mapping_queue_pending_idx on public.mapping_queue (status, confidence desc) where status = 'pending';

create table public.sealed_products (
  id uuid primary key default gen_random_uuid(),
  game text not null references public.games (code),
  lang text not null references public.languages (code),
  set_id uuid references public.sets (id) on delete set null,
  type text not null,                -- booster-box, etb, booster-bundle, starter-deck, premium-collection...
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  rrp_aud numeric(10, 2),
  image_url text,
  release_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game, lang, slug)
);
alter table public.sealed_products enable row level security;
create trigger touch_sealed before update on public.sealed_products
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ URLs & redirects
create table public.redirects (
  from_path text primary key check (from_path ~ '^/'),
  to_path text not null check (to_path ~ '^/'),
  code smallint not null default 301 check (code in (301, 308, 410)),
  created_at timestamptz not null default now(),
  check (from_path <> to_path)
);
alter table public.redirects enable row level security;

-- Adds a redirect and keeps the table chain- and loop-free: anything that
-- pointed at the old path now points straight at the new one.
create or replace function public.add_redirect(p_from text, p_to text, p_code smallint default 301)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_from = p_to then
    return;
  end if;
  delete from public.redirects where from_path = p_to;           -- new path is live again
  update public.redirects set to_path = p_to where to_path = p_from; -- collapse chains
  insert into public.redirects (from_path, to_path, code) values (p_from, p_to, p_code)
  on conflict (from_path) do update set to_path = excluded.to_path, code = excluded.code, created_at = now();
end $$;

create or replace function public.set_path(p_set_id uuid) returns text
language sql stable set search_path = public as $$
  select '/cards/' || game || '/' || lang || '/' || slug || '/' from public.sets where id = p_set_id
$$;

create or replace function public.card_path(p_card_id uuid) returns text
language sql stable set search_path = public as $$
  select '/cards/' || s.game || '/' || s.lang || '/' || s.slug || '/' || c.slug || '/'
  from public.cards c join public.sets s on s.id = c.set_id where c.id = p_card_id
$$;

create or replace function public.card_market_path(p_card_id uuid) returns text
language sql stable set search_path = public as $$
  select '/marketplace/' || s.game || '/' || s.lang || '/' || s.slug || '/' || c.slug || '/'
  from public.cards c join public.sets s on s.id = c.set_id where c.id = p_card_id
$$;

-- Slug changes never break URLs (brief 7.1): write 301s for every path that
-- contained the old slug.
create or replace function public.redirect_on_card_slug_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_set record;
begin
  if new.slug = old.slug and new.set_id = old.set_id then
    return new;
  end if;
  select game, lang, slug into v_set from public.sets where id = old.set_id;
  perform public.add_redirect(
    '/cards/' || v_set.game || '/' || v_set.lang || '/' || v_set.slug || '/' || old.slug || '/',
    public.card_path(new.id));
  perform public.add_redirect(
    '/marketplace/' || v_set.game || '/' || v_set.lang || '/' || v_set.slug || '/' || old.slug || '/',
    public.card_market_path(new.id));
  return new;
end $$;
create trigger cards_slug_redirect after update of slug, set_id on public.cards
  for each row execute function public.redirect_on_card_slug_change();

create or replace function public.redirect_on_set_slug_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_card record;
  v_old_base text := old.game || '/' || old.lang || '/' || old.slug || '/';
  v_new_base text := new.game || '/' || new.lang || '/' || new.slug || '/';
begin
  if new.slug = old.slug then
    return new;
  end if;
  perform public.add_redirect('/cards/' || v_old_base, '/cards/' || v_new_base);
  perform public.add_redirect('/market-cap/' || v_old_base, '/market-cap/' || v_new_base);
  for v_card in select slug from public.cards where set_id = new.id loop
    perform public.add_redirect('/cards/' || v_old_base || v_card.slug || '/', '/cards/' || v_new_base || v_card.slug || '/');
    perform public.add_redirect('/marketplace/' || v_old_base || v_card.slug || '/', '/marketplace/' || v_new_base || v_card.slug || '/');
  end loop;
  return new;
end $$;
create trigger sets_slug_redirect after update of slug on public.sets
  for each row execute function public.redirect_on_set_slug_change();

-- --------------------------------------------------------------- policies
create policy "games: public read" on public.games for select using (true);
create policy "games: admin write" on public.games for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "languages: public read" on public.languages for select using (true);
create policy "languages: admin write" on public.languages for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "sets: public read" on public.sets for select using (true);
create policy "sets: admin write" on public.sets for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "cards: public read" on public.cards for select using (true);
create policy "cards: admin write" on public.cards for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "card_external_ids: public read" on public.card_external_ids for select using (true);
create policy "card_external_ids: admin write" on public.card_external_ids for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "mapping_queue: admin only" on public.mapping_queue for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "sealed_products: public read" on public.sealed_products for select using (true);
create policy "sealed_products: admin write" on public.sealed_products for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "redirects: public read" on public.redirects for select using (true);
create policy "redirects: admin write" on public.redirects for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
