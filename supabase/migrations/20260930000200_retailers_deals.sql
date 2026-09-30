-- More stores members can report from, and eBay deal alerts (owner request
-- 2026-09-30, inspired by PokéMafia Restocker's "eBay sniper").
--
-- 1. Retailers with no monitor (adapter 'none') so members can report
--    sightings anywhere Pokémon / One Piece product is sold, including
--    independent game stores (store name required).
-- 2. eBay deals: the workers search eBay Australia through eBay's official
--    Browse API for listings well below our market value (Buy It Now) and
--    auctions ending soon under value. Premium sees them live; members who
--    wishlisted the card are alerted. Off until the eBay developer keys exist.

insert into public.retailers (slug, name, base_url, adapter, enabled) values
  ('toymate',          'Toymate',               'https://www.toymate.com.au',       'none', false),
  ('myer',             'Myer',                  'https://www.myer.com.au',          'none', false),
  ('amazon-au',        'Amazon Australia',      'https://www.amazon.com.au',        'none', false),
  ('costco-au',        'Costco',                'https://www.costco.com.au',        'none', false),
  ('officeworks',      'Officeworks',           'https://www.officeworks.com.au',   'none', false),
  ('zing-pop-culture', 'Zing Pop Culture',      'https://www.zingpopculture.com.au','none', false),
  ('woolworths',       'Woolworths',            'https://www.woolworths.com.au',    'none', false),
  ('coles',            'Coles',                 'https://www.coles.com.au',         'none', false),
  ('local-game-store', 'Independent game store','https://tcgtracker.com.au',          'none', false)
on conflict (slug) do nothing;

-- Monitored = has a real adapter. Admins can only switch monitoring on for those.
alter table public.retailers add column if not exists monitored boolean
  generated always as (adapter <> 'none') stored;
alter table public.retailers add constraint retailers_enable_needs_adapter check (not enabled or adapter <> 'none');

-- Independent stores need a store name; online reports make no sense there.
create or replace function public.sightings_store_rules() returns trigger
language plpgsql as $$
begin
  if (select slug from public.retailers where id = new.retailer_id) = 'local-game-store' then
    if new.channel <> 'in_store' then
      raise exception 'independent store reports must be in store' using errcode = '22023';
    end if;
    if coalesce(trim(new.store_name), '') = '' then
      raise exception 'please add the store name' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger sightings_store_rules before insert on public.sightings
  for each row execute function public.sightings_store_rules();

-- ------------------------------------------------------------ eBay deals
insert into public.site_settings (key, value, description, is_public) values
  ('deals.enabled',                'false', 'Search eBay AU for below-market listings (needs eBay developer keys)', true),
  ('deals.min_discount_pct',       '20',    'Buy It Now listings at least this far below market value count as deals', true),
  ('deals.auction_ending_minutes', '120',   'Auctions ending within this window and under value count as deals', true),
  ('deals.max_cards_per_run',      '150',   'Cards checked per run (eBay allows 5,000 Browse API calls a day by default)', false),
  ('deals.public_delay_minutes',   '1440',  'Free members and the public see deals this long after they are found', true)
on conflict (key) do nothing;

create table public.ebay_deals (
  id bigint generated always as identity primary key,
  item_id text not null unique,                 -- eBay item id
  card_id uuid not null references public.cards (id) on delete cascade,
  grade_key text not null,
  title text not null,
  buying_option text not null check (buying_option in ('FIXED_PRICE', 'AUCTION')),
  price_aud numeric(10, 2) not null check (price_aud > 0),
  shipping_aud numeric(10, 2),
  market_aud numeric(10, 2) not null check (market_aud > 0),
  discount_pct numeric(5, 1) not null,
  bid_count integer,
  end_time timestamptz,
  url text not null check (url ~ '^https://'),  -- affiliate-tracked when EPN is set up
  image_url text,
  seller_feedback_pct numeric(5, 1),
  found_at timestamptz not null default now(),
  public_at timestamptz not null,
  gone_at timestamptz,
  alerted_at timestamptz
);
alter table public.ebay_deals enable row level security;
create index ebay_deals_recent_idx on public.ebay_deals (found_at desc) where gone_at is null;
create index ebay_deals_card_idx on public.ebay_deals (card_id, grade_key);

create or replace function public.ebay_deals_set_public_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.public_at is null then
    new.public_at := new.found_at + make_interval(mins => coalesce(public.setting_int('deals.public_delay_minutes'), 1440));
  end if;
  return new;
end $$;
create trigger ebay_deals_public_at before insert on public.ebay_deals
  for each row execute function public.ebay_deals_set_public_at();

-- Same paywall as drops: Premium and staff live, everyone else after the delay.
create policy "ebay_deals: delayed public, instant premium" on public.ebay_deals for select using (
  public_at <= now() or public.is_premium(auth.uid()) or public.has_role('moderator')
);

-- Wishlist watchers of the card (grade matching or "any grade") are told.
-- Premium: straight away. Free: when the deal goes public (usually gone by then,
-- which is the honest upsell). Uses the wishlist alert preferences.
create or replace function public.ebay_deals_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  w record;
  v_card record;
  v_title text;
begin
  select c.name, c.number, s.name as set_name, c.lang, c.game, s.slug as set_slug, c.slug as card_slug into v_card
  from public.cards c join public.sets s on s.id = c.set_id where c.id = new.card_id;
  v_title := v_card.name || ' #' || v_card.number || ' ' || upper(replace(new.grade_key, '-', ' ')) || ' on eBay for A$' || new.price_aud
             || ' (' || round(new.discount_pct) || '% under value)';
  for w in
    select distinct on (wi.user_id) wi.user_id
    from public.wishlist_items wi
    join public.profile_private pp on pp.user_id = wi.user_id and pp.status = 'active'
    where wi.card_id = new.card_id and (wi.grade_key is null or wi.grade_key = new.grade_key)
      and (wi.max_price_aud is null or new.price_aud <= wi.max_price_aud)
  loop
    perform public.notify(w.user_id, 'wishlist', v_title,
      case when new.buying_option = 'AUCTION' then 'Auction ending ' || to_char(new.end_time at time zone 'Australia/Sydney', 'HH12:MI am Dy') || ' (Sydney time).'
           else 'Buy It Now on eBay Australia.' end,
      '/deals/', jsonb_build_object('deal_id', new.id, 'card_id', new.card_id,
        'buying_option', new.buying_option, 'price_aud', new.price_aud, 'shipping_aud', new.shipping_aud,
        'market_aud', new.market_aud, 'discount_pct', new.discount_pct, 'end_time', new.end_time,
        'card_path', '/cards/' || v_card.game || '/' || v_card.lang || '/' || v_card.set_slug || '/' || v_card.card_slug || '/'), 'deal',
      'deal:' || new.id || ':' || w.user_id,
      case when public.is_premium(w.user_id) then now() else new.public_at end);
  end loop;
  return null;
end $$;
create trigger ebay_deals_notify after insert on public.ebay_deals
  for each row execute function public.ebay_deals_notify();

-- Cards worth checking: wishlisted cards first, then the highest-value ranked cards.
create or replace function public.deal_watch_cards(p_limit integer default 150)
returns table (card_id uuid, grade_key text, market_aud numeric, name text, number text, set_name text, lang text, game text)
language sql stable security definer set search_path = public as $$
  with wanted as (
    select wi.card_id, coalesce(wi.grade_key, 'psa-10') as grade_key, 0 as pri
    from public.wishlist_items wi where wi.card_id is not null
    group by 1, 2
  ),
  top as (
    select r.card_id, r.grade_key, 1 as pri from public.market_cap_rankings r
    where r.grade_key in ('psa-10', 'psa-9') order by r.floor_aud desc nulls last limit p_limit
  ),
  pick as (
    select distinct on (card_id, grade_key) card_id, grade_key, pri from (select * from wanted union all select * from top) u
    order by card_id, grade_key, pri
  )
  select p.card_id, p.grade_key, r.floor_aud, c.name, c.number, s.name, c.lang, c.game
  from pick p
  join public.market_cap_rankings r on r.card_id = p.card_id and r.grade_key = p.grade_key
  join public.cards c on c.id = p.card_id
  join public.sets s on s.id = c.set_id
  where r.floor_aud > 0
  order by p.pri, r.floor_aud desc
  limit p_limit
$$;
revoke execute on function public.deal_watch_cards(integer) from anon, authenticated;
