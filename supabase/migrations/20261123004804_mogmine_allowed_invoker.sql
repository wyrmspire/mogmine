-- #176 follow-up (security advisor 0029): `mogmine_is_allowed()` no longer needs SECURITY DEFINER. Signed-in users
-- can already read their own allow-list row (policy mogmine_allowed_users_read_own), so the check runs as the
-- caller. Policies are unchanged. mogmine_ objects only.
create or replace function public.mogmine_is_allowed()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.mogmine_allowed_users a where a.user_id = (select auth.uid()));
$$;
revoke all on function public.mogmine_is_allowed() from public, anon;
grant execute on function public.mogmine_is_allowed() to authenticated;
