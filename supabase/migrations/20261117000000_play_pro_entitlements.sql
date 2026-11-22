-- Server-owned Play subscriptions and complimentary founding-tester grants.
-- No client access to purchase tokens, subscription state, or founder lists.
create table if not exists public.pro_purchases (
  token_sha256 text primary key check (token_sha256 ~ '^[a-f0-9]{64}$'),
  purchase_token text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null default 'patrol_radar_pro',
  state text not null default 'UNKNOWN',
  active boolean not null default false,
  expires_at timestamptz,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pro_purchases_user on public.pro_purchases (user_id, expires_at desc);

create table if not exists public.pro_founders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text
);
-- Populate with SHA-256 of random single-use 24+ character founder codes.
-- Do NOT store plaintext codes or a list of Play tester email addresses in this table.
create table if not exists public.pro_founder_codes (
  code_sha256 text primary key check (code_sha256 ~ '^[a-f0-9]{64}$'),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz,
  expires_at timestamptz,
  note text
);

alter table public.pro_purchases enable row level security;
alter table public.pro_founders enable row level security;
alter table public.pro_founder_codes enable row level security;
revoke all on public.pro_purchases, public.pro_founders, public.pro_founder_codes from PUBLIC, anon, authenticated;
grant all on public.pro_purchases, public.pro_founders, public.pro_founder_codes to service_role;

-- Atomic one-time claim; callable by the trusted Edge Function only.
create or replace function public.claim_pro_founder_code(p_uid uuid, p_code_sha256 text)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed text;
begin
  update public.pro_founder_codes set claimed_by=p_uid, claimed_at=now()
    where code_sha256=p_code_sha256 and claimed_by is null and
      (expires_at is null or expires_at > now())
    returning code_sha256 into claimed;
  if claimed is null then return false; end if;
  insert into public.pro_founders(user_id, note)
    values(p_uid, 'single-use founding tester code') on conflict(user_id) do nothing;
  return true;
end $$;
revoke all on function public.claim_pro_founder_code(uuid, text) from PUBLIC, anon, authenticated;
grant execute on function public.claim_pro_founder_code(uuid, text) to service_role;

comment on table public.pro_purchases is
  'Private token data; only service-role Edge Functions can read or change verified entitlements.';
comment on table public.pro_founders is
  'Permanent free Pro, independent of Google subscription cancellation/expiration.';
