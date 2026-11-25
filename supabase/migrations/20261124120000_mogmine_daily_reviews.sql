-- DR-1b: daily reviews on the shared showmob-dev project (D-012, docs/design-2026-11-24/06 §2.1, Q-3).
-- MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP). Written by a worker; never applied by a worker.
-- Additive only: every object below is named mogmine_*. Nothing here reads, alters or drops another app's tables,
-- auth settings or project config.
--
-- Same jsonb row pattern as mogmine_plans (20261123004734_mogmine_journal_v1.sql): (user_id, id) primary key, the
-- sanitized review as `record jsonb`, and generated query columns. One review per (session_date, account_id) per
-- owner; account_id null = the whole day (Q-3). Access is the journal rule: own rows AND allow-listed.

create table public.mogmine_daily_reviews (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  session_date text not null generated always as (record->>'session_date') stored,
  account_id text generated always as (record->>'account_id') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- One review per (session_date, account_id) per owner. coalesce makes the null (whole-day) scope unique too.
create unique index mogmine_daily_reviews_scope_idx on public.mogmine_daily_reviews (user_id, session_date, coalesce(account_id, ''));

alter table public.mogmine_daily_reviews enable row level security;
revoke all on table public.mogmine_daily_reviews from anon;
grant select, insert, update, delete on table public.mogmine_daily_reviews to authenticated, service_role;
create policy mogmine_daily_reviews_own on public.mogmine_daily_reviews for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_daily_reviews_touch before insert or update on public.mogmine_daily_reviews
  for each row execute function public.mogmine_touch_row();

-- replaceAll (backup restore) gains the new table. Same body as mogmine_replace_rows in the journal migration,
-- with 'mogmine_daily_reviews' added to the allow-list.
create or replace function public.mogmine_replace_rows(p_table text, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_table not in ('mogmine_trades', 'mogmine_mood_records', 'mogmine_mood_candidates', 'mogmine_accounts', 'mogmine_balance_checks', 'mogmine_challenges', 'mogmine_playbooks', 'mogmine_plans', 'mogmine_drills', 'mogmine_calls', 'mogmine_prompt_dismissals', 'mogmine_daily_reviews') then
    raise exception 'not a mogmine collection table: %', p_table using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  perform set_config('mogmine.skip_cascade', 'on', true);
  execute format('delete from public.%I where user_id = auth.uid()', p_table);
  execute format('insert into public.%I (user_id, id, record) select auth.uid(), r->>''id'', r from jsonb_array_elements($1) as r', p_table)
    using p_rows;
  perform set_config('mogmine.skip_cascade', 'off', true);
end;
$$;
revoke all on function public.mogmine_replace_rows(text, jsonb) from public, anon;
grant execute on function public.mogmine_replace_rows(text, jsonb) to authenticated;
