-- Product images from Scrydex (cards and sealed products, Pokémon EN/JP and
-- One Piece). The images job (tcgworkers.jobs.images) fills
-- cards.image_url and sealed_products.image_url with Scrydex's own image
-- URLs and records the Scrydex id in image_source. An image set by hand
-- (any other image_source) is never overwritten.

alter table public.sealed_products
  add column if not exists image_source text; -- provenance, for image-rights review: 'scrydex:<id>', 'manual'...

-- Which Scrydex expansions have been synced, so a daily run only fetches new,
-- recent or stale expansions (each page costs one Scrydex credit).
create table public.scrydex_expansions (
  game text not null references public.games (code),
  expansion_id text not null,
  lang text not null references public.languages (code),
  name text not null,
  release_date date,
  synced_at timestamptz not null,
  matched_cards integer not null default 0,
  primary key (game, expansion_id)
);
alter table public.scrydex_expansions enable row level security;
-- Workers only (service role); no public policies.

insert into public.site_settings (key, value, description, is_public) values
  ('images.scrydex_max_requests_per_run', '1500', 'Cap on Scrydex requests (credits) per images run. Starter plan: 5,000 credits a month.', false),
  ('images.recent_days', '90', 'Re-check expansions released in the last N days on every run (new cards, final images)', false),
  ('images.resync_days', '30', 'Re-check every other expansion after N days', false)
on conflict (key) do nothing;
