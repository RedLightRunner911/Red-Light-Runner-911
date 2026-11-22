-- Preserve first-claim ownership even during concurrent Play verification requests.
-- A client must not be able to reassign another user's verified purchase via upsert.
create or replace function public.reject_pro_purchase_reassignment()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.user_id is distinct from new.user_id then
    raise exception 'Play purchase ownership cannot be reassigned';
  end if;
  return new;
end $$;

drop trigger if exists pro_purchase_owner_immutable on public.pro_purchases;
create trigger pro_purchase_owner_immutable
  before update of user_id on public.pro_purchases
  for each row execute function public.reject_pro_purchase_reassignment();
