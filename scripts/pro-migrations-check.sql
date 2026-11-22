-- Behavior checks for the Pro billing migrations. Run by scripts/test-pro-migrations.sh on a throwaway DB.
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into public.pro_purchases(token_sha256, purchase_token, user_id)
  values (repeat('a',64), 'tok', '11111111-1111-1111-1111-111111111111');
-- Losing concurrent claim (upsert onto an owned token) is rejected by the trigger.
do $$ begin
  insert into public.pro_purchases(token_sha256, purchase_token, user_id)
    values (repeat('a',64), 'tok', '22222222-2222-2222-2222-222222222222')
    on conflict (token_sha256) do update set user_id = excluded.user_id;
  raise exception 'FAIL: reassignment allowed';
exception when raise_exception then
  if sqlerrm not like '%ownership cannot be reassigned%' then raise; end if;
end $$;
-- Same-owner refresh still works.
insert into public.pro_purchases(token_sha256, purchase_token, user_id, active)
  values (repeat('a',64), 'tok', '11111111-1111-1111-1111-111111111111', true)
  on conflict (token_sha256) do update set user_id = excluded.user_id, active = excluded.active;
-- Compare-and-set relink: wrong expected owner moves nothing; correct one moves; flag resets.
do $$ begin
  if public.relink_pro_purchase(repeat('a',64), '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111') then raise exception 'FAIL: CAS'; end if;
  if not public.relink_pro_purchase(repeat('a',64), '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222') then raise exception 'FAIL: relink'; end if;
  begin
    update public.pro_purchases set user_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL: bypass flag leaked';
  exception when raise_exception then
    if sqlerrm not like '%ownership cannot be reassigned%' then raise; end if;
  end;
end $$;
-- Deleting the owning auth user is refused (no silent loss of a paid record).
do $$ begin
  delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
  raise exception 'FAIL: cascade';
exception when restrict_violation or foreign_key_violation then null; end $$;
-- Founder auto-claim: before cutoff grants, at cutoff does not, bogus early time does not, device recovery works.
insert into auth.users values ('33333333-3333-3333-3333-333333333333'), ('44444444-4444-4444-4444-444444444444');
do $$ declare r text; begin
  r := public.claim_pro_founder_install('11111111-1111-1111-1111-111111111111', '2026-11-16 19:53:59-06', repeat('c',64));
  if r <> 'granted' then raise exception 'FAIL grant %', r; end if;
  r := public.claim_pro_founder_install('33333333-3333-3333-3333-333333333333', '2026-11-16 19:54:00-06', null);
  if r <> 'ineligible' then raise exception 'FAIL cutoff %', r; end if;
  r := public.claim_pro_founder_install('33333333-3333-3333-3333-333333333333', '2020-01-01', null);
  if r <> 'ineligible' then raise exception 'FAIL floor %', r; end if;
  r := public.claim_pro_founder_install('44444444-4444-4444-4444-444444444444', '2026-12-01', repeat('c',64));
  if r <> 'recovered' then raise exception 'FAIL recovery %', r; end if;
  r := public.claim_pro_founder_install('33333333-3333-3333-3333-333333333333', null, repeat('d',64));
  if r <> 'ineligible' then raise exception 'FAIL unknown device %', r; end if;
  if (select count(*) from public.pro_founders) <> 2 then raise exception 'FAIL founder count'; end if;
end $$;
-- Clients have no access to tables or RPCs.
do $$ begin
  if has_table_privilege('authenticated', 'public.pro_purchases', 'select') or has_table_privilege('anon', 'public.pro_founders', 'insert')
     or has_function_privilege('authenticated', 'public.relink_pro_purchase(text,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.claim_pro_founder_install(uuid,timestamptz,text)', 'execute')
  then raise exception 'FAIL: client privileges'; end if;
end $$;
select 'pro migrations OK' as result;
