-- JustTCG as the card price source (2 Oct 2026). Replaces PriceCharting,
-- whose Legendary plan is internal-use only. JustTCG's paid plans include a
-- commercial licence to display prices, price history and derived metrics
-- such as market cap (Terms §7.1), without asking for permission.
-- (workers/tcgworkers/sources/pricing/justtcg.py, justtcg_ingest.py)
--
-- * justtcg_sets: JustTCG set id + language -> our set. One JustTCG set can
--   hold both English and Japanese printings (One Piece), and our catalogue
--   keeps those as separate sets, so the key is (justtcg_set_id, lang).
--   New sets are auto-mapped by name (confirmed = false) for an admin to
--   check, like pricecharting_consoles. refreshed_at drives which sets the
--   next run fetches (oldest first, within the request budget);
--   history_backfilled_at records the one-off price-history backfill.
-- * Prices land in price_points with source 'justtcg' and honest per-grader
--   grade keys: psa-10, psa-9, bgs-9.5, cgc-10, sgc-10 (raw = Near Mint).

create table public.justtcg_sets (
  id bigint generated always as identity primary key,
  justtcg_set_id text not null,
  justtcg_game text not null,              -- JustTCG game id, e.g. 'pokemon', 'one-piece-card-game'
  game text not null references public.games (code),
  lang text not null references public.languages (code),
  set_name text not null,
  set_id uuid references public.sets (id) on delete set null,
  confirmed boolean not null default false, -- an admin checked the mapping
  excluded boolean not null default false,
  excluded_reason text,
  refreshed_at timestamptz,
  history_backfilled_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (justtcg_set_id, lang)
);
alter table public.justtcg_sets enable row level security;
create index justtcg_sets_review_idx on public.justtcg_sets (confirmed) where not confirmed and not excluded;
create trigger touch_justtcg_sets before update on public.justtcg_sets
  for each row execute function public.touch_updated_at();
create trigger audit_staff_write after insert or update or delete on public.justtcg_sets
  for each row execute function public.audit_staff_write();
create policy "justtcg_sets: admin" on public.justtcg_sets for all
  using (public.has_role('admin')) with check (public.has_role('admin'));

insert into public.site_settings (key, value, description, is_public) values
  ('justtcg.games',
   '[{"id": "pokemon", "game": "pokemon", "lang": null}, {"id": "pokemon-japan", "game": "pokemon", "lang": "jp"}, {"id": "one-piece-card-game", "game": "one-piece", "lang": null}]',
   'JustTCG games to fetch and how they map to ours (lang null = read each printing''s language)', false),
  ('justtcg.companies', '["PSA", "BGS", "CGC", "SGC"]', 'Grading companies whose JustTCG prices we store (PSA drives market cap)', false),
  ('justtcg.raw_prices', 'false', 'Also store Near Mint raw prices (graded=include, which costs more per request)', false),
  ('justtcg.max_requests_per_run', '1500', 'Cap on JustTCG requests per run (Professional plan: 5,000 a day; the job runs every 4 hours)', false),
  ('justtcg.refresh_hours', '20', 'A set is fetched again once its prices are this many hours old', false),
  ('justtcg.history_window', '"1y"', 'Price history fetched once per set to backfill charts: 7d, 30d, 90d, 180d or 1y', false),
  ('justtcg.store_types', '["sold", "ask"]',
   'How JustTCG market prices are stored: "sold" = daily snapshot (feeds last sale and 30-day median), "ask" = current external value (gives every priced card a floor)', false),
  ('justtcg.fx_max_age_days', '7', 'Refuse to convert USD prices with an FX rate older than this', false)
on conflict (key) do nothing;
