-- The drops sitemap needs, for every store and every state, when its last
-- public drop happened (a page is listed only while it has recent activity).
-- It used to ask once per store and once per state (~60 requests, ~11 s);
-- this answers in one. SECURITY INVOKER: the caller's row-level security
-- applies, so an anonymous caller sees exactly the public, delayed history.
create or replace function public.drop_page_last_events()
returns table (kind text, key text, last_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select 'retailer'::text, r.slug, max(d.occurred_at)
    from public.drop_events d
    join public.retailers r on r.id = d.retailer_id
   group by r.slug
  union all
  select 'state'::text, s.state::text, max(d.occurred_at)
    from public.drop_events d
    join public.sightings s on s.id = d.sighting_id
   where s.state is not null
   group by s.state
$$;
grant execute on function public.drop_page_last_events() to anon, authenticated;
