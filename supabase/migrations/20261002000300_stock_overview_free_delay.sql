-- Stock overview and a 5-minute free delay (2 Oct 2026).
--
-- 1. stock_overview(): per-store counts for the /stock/ hub: TCG listings we
--    track, how many are in stock / on pre-order now, and the latest change.
--    Reads only what anon can already read (retailers, retail_products), so
--    it runs as the caller. Marketplace sellers and listings not seen for two
--    weeks (delisted) are left out of the counts.
-- 2. Free members now get drop alerts 5 minutes after Premium (was 24 hours),
--    and the public drop history shows events after 5 minutes too.

create or replace function public.stock_overview(p_game text default null)
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
         (count(p.id) filter (where p.current_availability in ('in_stock_online', 'in_stock_cnc', 'in_stock_both')))::integer,
         (count(p.id) filter (where p.current_availability = 'preorder'))::integer,
         max(p.last_change_at)
    from public.retailers r
    left join public.retail_products p
      on p.retailer_id = r.id
     and p.game is not null
     and not p.is_marketplace_seller
     and p.last_seen_at > now() - interval '14 days'
     and (p_game is null or p.game = p_game)
   group by r.slug
$$;

grant execute on function public.stock_overview(text) to anon, authenticated;

update public.site_settings set value = '5', updated_at = now()
 where key in ('drops.free_delay_minutes', 'drops.public_delay_minutes');

-- Bring forward what was already waiting under the old 24-hour delay.
update public.drop_events
   set public_at = occurred_at + interval '5 minutes'
 where public_at > now() and public_at > occurred_at + interval '5 minutes';

update public.drop_alert_deliveries d
   set deliver_at = greatest(e.occurred_at + interval '5 minutes', now())
  from public.drop_events e
 where e.id = d.drop_event_id
   and d.status = 'queued'
   and d.tier_at_enqueue = 'free'
   and d.deliver_at > e.occurred_at + interval '5 minutes';
