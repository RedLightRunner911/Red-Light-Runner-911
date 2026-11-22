-- 1) Paid and founder entitlements must survive deletion of an auth user.
--    ON DELETE CASCADE silently erased a paying subscriber's purchase record (and a founder's
--    permanent grant) whenever an anonymous user was deleted or cleaned up. RESTRICT makes that
--    deletion fail until an operator deliberately moves or removes the entitlement. SET NULL was
--    rejected: user_id is NOT NULL by design, and the ownership trigger blocks owner changes anyway.
alter table public.pro_purchases drop constraint if exists pro_purchases_user_id_fkey;
alter table public.pro_purchases add constraint pro_purchases_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;
alter table public.pro_founders drop constraint if exists pro_founders_user_id_fkey;
alter table public.pro_founders add constraint pro_founders_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;

-- 2) Founder provenance + reinstall recovery key (SHA-256 of the per-app Android ID; never raw).
alter table public.pro_founders add column if not exists source text not null default 'manual';
alter table public.pro_founders add column if not exists first_install_at timestamptz;
alter table public.pro_founders add column if not exists account_hash text
  check (account_hash is null or account_hash ~ '^[a-f0-9]{64}$');
create index if not exists pro_founders_account_hash on public.pro_founders (account_hash);

-- Automatic founder claim from the Android app (service role only).
-- 'granted'   : self-reported first install strictly before the founding cutoff.
-- 'recovered' : same phone (account hash) already holds a founder grant under an older anonymous user.
-- 'ineligible': neither. The cutoff is fixed here so a caller cannot widen it.
create or replace function public.claim_pro_founder_install(p_uid uuid, p_first_install timestamptz, p_account_hash text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_account_hash is not null and p_account_hash !~ '^[a-f0-9]{64}$' then
    p_account_hash := null;
  end if;
  if p_first_install is not null
     and p_first_install >= timestamptz '2026-10-01 00:00:00+00'
     and p_first_install <  timestamptz '2026-11-16 19:54:00-06' then
    insert into public.pro_founders(user_id, note, source, first_install_at, account_hash)
      values (p_uid, 'automatic: self-reported Android install before founding cutoff', 'install_date', p_first_install, p_account_hash)
      on conflict (user_id) do update
        set account_hash = coalesce(public.pro_founders.account_hash, excluded.account_hash),
            first_install_at = coalesce(public.pro_founders.first_install_at, excluded.first_install_at);
    return 'granted';
  end if;
  if p_account_hash is not null and exists (
       select 1 from public.pro_founders where account_hash = p_account_hash and user_id <> p_uid) then
    insert into public.pro_founders(user_id, note, source, account_hash)
      values (p_uid, 'automatic: reinstall on a phone that already held a founder grant', 'device_recovery', p_account_hash)
      on conflict (user_id) do nothing;
    return 'recovered';
  end if;
  return 'ineligible';
end $$;
revoke all on function public.claim_pro_founder_install(uuid, timestamptz, text) from PUBLIC, anon, authenticated;
grant execute on function public.claim_pro_founder_install(uuid, timestamptz, text) to service_role;

-- 3) Verified reinstall recovery may move a purchase between anonymous users. Every other owner
--    change stays rejected by the trigger (concurrent-claim protection from 20261118000000).
create or replace function public.reject_pro_purchase_reassignment()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.user_id is distinct from new.user_id
     and coalesce(current_setting('patrolradar.pro_relink', true), '') <> 'on' then
    raise exception 'Play purchase ownership cannot be reassigned';
  end if;
  return new;
end $$;

-- Called by the Edge Function only after Google reported obfuscatedExternalAccountId equal to the
-- account hash presented by the calling device. Compare-and-set on the expected previous owner.
create or replace function public.relink_pro_purchase(p_token_sha256 text, p_from uuid, p_to uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare moved int;
begin
  perform set_config('patrolradar.pro_relink', 'on', true);
  update public.pro_purchases set user_id = p_to, updated_at = now()
    where token_sha256 = p_token_sha256 and user_id = p_from;
  get diagnostics moved = row_count;
  perform set_config('patrolradar.pro_relink', 'off', true);
  return moved = 1;
end $$;
revoke all on function public.relink_pro_purchase(text, uuid, uuid) from PUBLIC, anon, authenticated;
grant execute on function public.relink_pro_purchase(text, uuid, uuid) to service_role;
