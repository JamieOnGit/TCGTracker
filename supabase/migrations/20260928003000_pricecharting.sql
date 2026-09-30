-- PriceCharting ingestion (workers/tcgworkers/sources/pricing/pricecharting.py,
-- docs/research/07-retailers-pricing-ebay.md §D).
--
-- * pricecharting_consoles: PriceCharting "console" (set) name -> our set.
--   Unknown consoles are auto-mapped (to a set with the same name, or a new
--   auto-created set) with confirmed = false, for an admin to review.
--   Excluded consoles (Pokémon Chinese/Korean, One Piece Carddass) are kept
--   with excluded = true so the admin can see what was skipped and why.
-- * sets.auto_created / cards.auto_created: rows the worker created from
--   PriceCharting data because no catalogue match existed. Each auto-created
--   card also gets a mapping_queue row (status 'created_card') so an admin
--   can confirm or merge it.
-- * Grade 7/8/9/9.5 PriceCharting prices are grader-agnostic ("Graded 9 by a
--   grading company"). They are stored with grader 'ANY' -> grade_key 'any-9'
--   etc., never as psa-9, so the site can label them "Grade 9 (any grader)".

alter table public.sets add column if not exists auto_created boolean not null default false;
alter table public.cards add column if not exists auto_created boolean not null default false;

create table public.pricecharting_consoles (
  id bigint generated always as identity primary key,
  console_name text not null unique,       -- e.g. 'Pokemon Japanese Scarlet & Violet 151'
  game text references public.games (code),
  lang text references public.languages (code),
  set_name text,                           -- console name without the game/language prefix
  set_id uuid references public.sets (id) on delete set null,
  confirmed boolean not null default false, -- an admin checked the mapping
  excluded boolean not null default false,  -- not OPCG / not EN or JP: never ingested
  excluded_reason text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (excluded or (game is not null and lang is not null))
);
alter table public.pricecharting_consoles enable row level security;
create index pricecharting_consoles_review_idx on public.pricecharting_consoles (confirmed) where not confirmed and not excluded;
create trigger touch_pricecharting_consoles before update on public.pricecharting_consoles
  for each row execute function public.touch_updated_at();
create trigger audit_staff_write after insert or update or delete on public.pricecharting_consoles
  for each row execute function public.audit_staff_write();
create policy "pricecharting_consoles: admin" on public.pricecharting_consoles for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

insert into public.site_settings (key, value, description, is_public) values
  ('pricecharting.store_types', '["sold", "ask"]',
   'How PriceCharting values are stored: "sold" = daily snapshot (feeds last sale and 30-day median), "ask" = current external ask (gives every priced card a floor)', false),
  ('pricecharting.max_api_calls', '300', 'Cap on PriceCharting API calls per run when the CSV is unavailable (1 call/second)', false),
  ('pricecharting.fx_max_age_days', '7', 'Refuse to convert USD prices with an FX rate older than this', false)
on conflict (key) do nothing;
