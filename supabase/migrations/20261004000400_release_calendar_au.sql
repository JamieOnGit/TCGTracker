-- Release calendar, filled automatically with Australian dates.
--
-- Sources (workers job "releases", every 6 hours):
--   * One Piece: Bandai's official English site, edition "NA/EU/OC" (OC =
--     Oceania), so official Australian dates.
--   * Pokémon (and anything else an Australian store lists): the street date
--     JB Hi-Fi publishes on its pre-orders, grouped by set. Marked "Retailer
--     listing". pokemon.com is closed to automated access, so official
--     Pokémon dates are still added by an editor in Admin -> Releases.
--
-- An editor stays in charge: editing an automatic release locks it (the sync
-- never overwrites it again), and deleting one stops it coming back.

-- The store's own release date for each product we track (pre-orders).
alter table public.retail_products
  add column if not exists release_date date;

alter table public.release_events
  add column if not exists external_key text unique,     -- e.g. 'bandai:op18', 'jb:pokemon:en:me04:2026-11-06'
  add column if not exists locked boolean not null default false;

-- A signed-in editor changing an automatic release locks it. The workers
-- connect without a user (auth.uid() is null), so their updates don't.
create or replace function public.lock_release_on_staff_edit() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.external_key is not null and auth.uid() is not null then
    new.locked := true;
  end if;
  return new;
end $$;
drop trigger if exists lock_release_on_staff_edit on public.release_events;
create trigger lock_release_on_staff_edit before update on public.release_events
  for each row execute function public.lock_release_on_staff_edit();

-- Deleted automatic releases are remembered so the sync doesn't add them back.
create table if not exists public.release_dismissed (
  external_key text primary key,
  dismissed_at timestamptz not null default now()
);
alter table public.release_dismissed enable row level security;
-- Workers only (service role); no public policies.

create or replace function public.remember_dismissed_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.external_key is not null then
    insert into public.release_dismissed (external_key) values (old.external_key) on conflict do nothing;
  end if;
  return old;
end $$;
revoke execute on function public.remember_dismissed_release() from public, anon, authenticated;
drop trigger if exists remember_dismissed_release on public.release_events;
create trigger remember_dismissed_release after delete on public.release_events
  for each row execute function public.remember_dismissed_release();

insert into public.site_settings (key, value, description, is_public) values
  ('releases.auto_sync', 'true', 'Fill the release calendar automatically from Bandai (One Piece, Oceania) and Australian retailer pre-order dates', false)
on conflict (key) do nothing;
