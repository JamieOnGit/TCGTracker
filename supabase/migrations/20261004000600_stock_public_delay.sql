-- Live stock for members; visitors see it 10 minutes later.
--
-- Free and Premium members see each store's stock live (current_*). Visitors
-- who aren't signed in, and search engines, see the same pages with each
-- listing as it was stock.public_delay_minutes (10) ago: public_*. Pages stay
-- complete and indexable; signing up (free) is what unlocks live stock.
--
-- public_* is refreshed every minute by the workers (job public_stock ->
-- refresh_public_stock()) from the state history, so it is exactly the
-- state each listing had at the cut-off, not a guess.

alter table public.retail_products
  add column if not exists public_availability public.availability not null default 'unknown',
  add column if not exists public_price_aud numeric(10, 2),
  add column if not exists public_change_at timestamptz;

insert into public.site_settings (key, value, description, is_public) values
  ('stock.public_delay_minutes', '10', 'Visitors who are not signed in see store stock this many minutes late (members see it live)', true)
on conflict (key) do nothing;

-- Bring every listing's public state up to the cut-off. Only listings whose
-- public state lags their live one are looked at, so a run is cheap.
create or replace function public.refresh_public_stock() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz := now() - make_interval(mins => coalesce(public.setting_int('stock.public_delay_minutes'), 10));
  v_n integer;
begin
  with due as (
    select p.id, s.availability, s.price_aud, s.observed_at
      from public.retail_products p
      cross join lateral (
        select st.availability, st.price_aud, st.observed_at
          from public.retail_product_states st
         where st.retail_product_id = p.id and st.observed_at <= v_cutoff
         order by st.observed_at desc
         limit 1
      ) s
     where p.last_change_at is not null
       and p.public_change_at is distinct from p.last_change_at
       and s.observed_at is distinct from p.public_change_at
  )
  update public.retail_products p
     set public_availability = d.availability, public_price_aud = d.price_aud, public_change_at = d.observed_at
    from due d
   where p.id = d.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.refresh_public_stock() from public, anon, authenticated;

select public.refresh_public_stock();

-- The /stock/ hub's per-store counts, as visitors see them (delayed).
create or replace function public.stock_overview_public(p_game text default null)
returns table (
  slug text,
  listings integer,
  in_stock integer,
  preorder integer,
  last_change_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select r.slug,
         count(p.id)::integer,
         (count(p.id) filter (where p.public_availability in ('in_stock_online', 'in_stock_cnc', 'in_stock_both')))::integer,
         (count(p.id) filter (where p.public_availability = 'preorder'))::integer,
         max(p.public_change_at)
    from public.retailers r
    left join public.retail_products p
      on p.retailer_id = r.id
     and p.game is not null
     and not p.is_marketplace_seller
     and p.last_seen_at > now() - interval '14 days'
     and (p_game is null or p.game = p_game)
   group by r.slug
$$;
grant execute on function public.stock_overview_public(text) to anon, authenticated;

create index if not exists retail_products_public_in_stock_idx on public.retail_products (public_change_at desc)
  where public_availability in ('in_stock_online', 'in_stock_cnc', 'in_stock_both', 'preorder');
