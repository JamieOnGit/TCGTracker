-- Card images from free and official sources, so every card gets one
-- without Scrydex:
--   * Pokémon: TCGdex and pokemontcg.io (open card databases);
--   * One Piece: Bandai's official card list images (print ids from optcgapi.com);
--   * anything still missing: the card's TCGplayer product image, found by the
--     exact TCGplayer product id JustTCG gives for each card.
-- An image set by hand (image_source 'manual') is still never replaced.

alter table public.cards
  add column if not exists tcgplayer_id bigint; -- TCGplayer product id, from JustTCG (exact, per print)

-- Cards JustTCG created or an admin approved already carry the id in their
-- mapping record; the prices job fills in the rest on its next pass.
update public.cards c
   set tcgplayer_id = (q.payload ->> 'tcgplayer_id')::bigint
  from public.mapping_queue q
 where q.source = 'justtcg'
   and q.status in ('created_card', 'approved')
   and q.resolved_card_id = c.id
   and q.payload ->> 'tcgplayer_id' ~ '^[0-9]{1,15}$'
   and c.tcgplayer_id is null;

insert into public.site_settings (key, value, description, is_public) values
  ('images.tcgplayer_fallback', 'true', 'Cards no open source has an image for use their TCGplayer product image (by the exact TCGplayer id from JustTCG)', false),
  ('images.pokemontcg_max_requests_per_run', '120', 'Cap on pokemontcg.io requests per images run (it allows 1,000 a day without a key)', false),
  ('images.max_image_checks_per_run', '3000', 'Cap on image addresses checked (one HEAD request each) per images run', false)
on conflict (key) do nothing;
