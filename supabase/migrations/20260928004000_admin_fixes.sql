-- Admin console follow-ups.

-- 1. Settings can be cleared to a real JSON null (PostgREST sends SQL NULL for
--    a JSON null, which site_settings.value rejects). Admin-only, audit-logged
--    by the site_settings trigger.
create or replace function public.admin_set_setting(p_key text, p_value text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.site_settings
     set value = p_value::jsonb, updated_by = auth.uid(), updated_at = now()
   where key = p_key;
  if not found then
    raise exception 'unknown setting %', p_key using errcode = 'P0002';
  end if;
end $$;

-- 2. Staff accounts that approved listings or resolved reports can still be deleted.
alter table public.listings drop constraint if exists listings_approved_by_fkey;
alter table public.listings add constraint listings_approved_by_fkey foreign key (approved_by) references public.profiles (id) on delete set null;
alter table public.reports drop constraint if exists reports_resolved_by_fkey;
alter table public.reports add constraint reports_resolved_by_fkey foreign key (resolved_by) references public.profiles (id) on delete set null;
