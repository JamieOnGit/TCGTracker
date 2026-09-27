-- Membership & billing (brief 2). Stripe webhooks are the single source of
-- truth: only the service role (the webhook handler) writes here.

create table public.subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  tier public.tier not null default 'free',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'none'
    check (status in ('none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,           -- set when a payment fails; Premium kept until then
  last_event_at timestamptz,         -- Stripe event.created of the last applied event (ordering guard)
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

-- Idempotency: each Stripe event is applied once.
create table public.stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
alter table public.stripe_events enable row level security;

-- Effective tier = what the member gets right now. Mirrors
-- web/src/lib/domain/tier.ts (effectiveTier); both are unit tested.
create or replace function public.effective_tier(p_user uuid) returns public.tier
language sql stable security definer set search_path = public as $$
  select case
    when pp.tier_override is not null then pp.tier_override
    when s.status in ('active', 'trialing') then 'premium'::public.tier
    when s.status = 'past_due' and s.grace_until is not null and s.grace_until > now() then 'premium'::public.tier
    else 'free'::public.tier
  end
  from public.profiles p
  left join public.profile_private pp on pp.user_id = p.id
  left join public.subscriptions s on s.user_id = p.id
  where p.id = p_user
$$;

create or replace function public.is_premium(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.effective_tier(p_user) = 'premium'
$$;

create or replace function public.create_free_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger profiles_create_subscription after insert on public.profiles
  for each row execute function public.create_free_subscription();

create policy "subscriptions: owner or admin reads" on public.subscriptions for select
  using (user_id = auth.uid() or public.has_role('admin'));
create policy "stripe_events: admin reads" on public.stripe_events for select
  using (public.has_role('admin'));
