-- Lock down SECURITY DEFINER chat functions that PostgREST exposes at /rest/v1/rpc.
-- Not applied to the hosted database by this commit. Apply after merge.
--
-- messages_insert (authenticated) calls is_banned and has_current_terms, so that role
-- keeps EXECUTE on those two. anon does not: no policy for anon calls them.
-- purge_chat is only the pg_cron job. The three trigger functions are only fired by
-- triggers; direct EXECUTE is not required for an insert (checked in scripts/test-chat-sql.mjs).
-- postgres / supabase_admin keep purge_chat so the existing cron command still runs.
-- They also keep is_banned and has_current_terms so the security-definer triggers and the
-- moderation views (which call is_banned) still work when the owner is not a superuser.

revoke all on function public.purge_chat() from public, anon, authenticated;
revoke all on function public.messages_before_insert() from public, anon, authenticated;
revoke all on function public.reports_before_insert() from public, anon, authenticated;
revoke all on function public.reports_after_insert() from public, anon, authenticated;

revoke all on function public.is_banned(uuid) from public, anon, authenticated;
grant execute on function public.is_banned(uuid) to authenticated;

revoke all on function public.has_current_terms(uuid) from public, anon, authenticated;
grant execute on function public.has_current_terms(uuid) to authenticated;

do $$
declare r text;
begin
  foreach r in array array['postgres', 'supabase_admin']
  loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function public.purge_chat() to %I', r);
      execute format('grant execute on function public.is_banned(uuid) to %I', r);
      execute format('grant execute on function public.has_current_terms(uuid) to %I', r);
    end if;
  end loop;
end $$;

-- Fixed search_path. daily_handle is not security definer, but it is called from one
-- and was flagged as search_path-mutable. moderation.* is operator-only (schema usage
-- is already revoked from anon/authenticated) and had no search_path at all.
alter function public.daily_handle(uuid) set search_path = public;
alter function moderation.delete_message(bigint) set search_path = public;
alter function moderation.dismiss(bigint) set search_path = public;
alter function moderation.ban(uuid, text, integer) set search_path = public;
alter function moderation.unban(uuid) set search_path = public;
