-- #176 follow-up: this project's default privileges give new public tables no DML grants (only REFERENCES,
-- TRIGGER, TRUNCATE), so PostgREST answered 42501 before RLS ran. Grant exactly what the adapter uses.
-- RLS still decides which rows: own rows AND allow-listed (mogmine_is_allowed). anon gets nothing.
-- service_role (server-only, bypasses RLS) can manage the allow-list. mogmine_ objects only.
grant select, insert, update, delete on table public.mogmine_trades to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_mood_records to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_mood_candidates to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_accounts to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_balance_checks to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_challenges to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_playbooks to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_plans to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_drills to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_calls to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_prompt_dismissals to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_user_prefs to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_mood_registries to authenticated, service_role;
grant select, insert, update, delete on table public.mogmine_allowed_users to service_role;
