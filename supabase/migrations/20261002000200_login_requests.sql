-- Cross-device sign-in (2 Oct 2026).
--
-- A magic link signs in whichever browser opens it. When someone asks to sign
-- in on a computer but opens the email on their phone, the phone (now signed
-- in) can approve the computer's request, and the computer, which is polling
-- with a secret only it holds (an httpOnly cookie), is then signed in too.
--
-- Only the website's server touches this table, with the service role. RLS is
-- on with no policies, so the public API can neither read nor write it.
create table public.login_requests (
  id uuid primary key default gen_random_uuid(),
  -- sha256 of the secret in the requesting browser's cookie, hex.
  secret_hash text not null,
  email text not null,
  next_path text not null default '/account/',
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  approved_user_id uuid,
  approved_email text,
  approved_at timestamptz,
  consumed_at timestamptz
);

alter table public.login_requests enable row level security;
revoke all on public.login_requests from anon, authenticated;

create index login_requests_created_at on public.login_requests (created_at);
