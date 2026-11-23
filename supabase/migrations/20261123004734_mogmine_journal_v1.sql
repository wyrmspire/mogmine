-- #176: MogMine journal tables on the shared showmob-dev project (D-012, docs/26 §3).
-- Additive only: every object below is named mogmine_*. Nothing here reads, alters or drops a showmob_ object,
-- auth settings or project config.
--
-- Row shape (every collection table): (user_id, id) primary key with client-generated text ids, the sanitized
-- domain record as `record jsonb` (nested arrays stay inside it; unknown fields are the catch-all), and
-- server-owned created_at / updated_at. Query columns (parents, flags) are GENERATED from `record`, so they can
-- never drift from it. Derived fields (docs/26 §2.5) are stripped by the adapter before a write.
--
-- Access (OD-2): RLS on every table. A row is visible and writable only when user_id = auth.uid() AND the caller
-- is in mogmine_allowed_users. Auth users are shared with Showmob, so a Showmob sign-up sees nothing here.
-- anon has no table privileges at all. The allow-list is seeded out of band (docs/26 §7), never in a migration.

-- ---------------------------------------------------------------------------------------------------------------
-- Allow-list and helpers
-- ---------------------------------------------------------------------------------------------------------------

create table public.mogmine_allowed_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);
alter table public.mogmine_allowed_users enable row level security;
revoke all on table public.mogmine_allowed_users from anon, authenticated;
grant select on table public.mogmine_allowed_users to authenticated;
create policy mogmine_allowed_users_read_own on public.mogmine_allowed_users
  for select to authenticated using (user_id = (select auth.uid()));
comment on table public.mogmine_allowed_users is 'MogMine allow-list (OD-2). Written only with the service role or SQL editor.';

-- Security definer so policies can check membership without granting reads on the allow-list.
create function public.mogmine_is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.mogmine_allowed_users a where a.user_id = auth.uid());
$$;
revoke all on function public.mogmine_is_allowed() from public, anon;
grant execute on function public.mogmine_is_allowed() to authenticated;

-- Server-owned bookkeeping: millisecond precision so `expectedUpdatedAt` round-trips through JS ISO strings.
create function public.mogmine_touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := date_trunc('milliseconds', clock_timestamp());
  if tg_op = 'INSERT' then
    new.created_at := new.updated_at;
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.mogmine_touch_row() from public, anon, authenticated;


-- ---------------------------------------------------------------------------------------------------------------
-- Collection tables (many rows per owner)
-- ---------------------------------------------------------------------------------------------------------------

create table public.mogmine_trades (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  symbol text generated always as (record->>'symbol') stored,
  status text generated always as (record->>'status') stored,
  entry_time text generated always as (record->>'entry_time') stored,
  account_id text generated always as (record->>'account_id') stored,
  playbook_id text generated always as (record->>'playbook_id') stored,
  is_sample boolean not null generated always as (coalesce((record->>'is_sample')::boolean, false)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_trades_entry_time_idx on public.mogmine_trades (user_id, entry_time);
create index mogmine_trades_account_id_idx on public.mogmine_trades (user_id, account_id);
create index mogmine_trades_is_sample_idx on public.mogmine_trades (user_id, is_sample);

create table public.mogmine_mood_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  trade_id text generated always as (record->>'trade_id') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_mood_records_trade_id_idx on public.mogmine_mood_records (user_id, trade_id);

create table public.mogmine_mood_candidates (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.mogmine_accounts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  archived boolean not null generated always as (coalesce((record->>'archived')::boolean, false)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_accounts_archived_idx on public.mogmine_accounts (user_id, archived);

create table public.mogmine_balance_checks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  account_id text generated always as (record->>'account_id') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_balance_checks_account_id_idx on public.mogmine_balance_checks (user_id, account_id);

create table public.mogmine_challenges (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.mogmine_playbooks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  archived boolean not null generated always as (coalesce((record->>'archived')::boolean, false)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_playbooks_archived_idx on public.mogmine_playbooks (user_id, archived);

create table public.mogmine_plans (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.mogmine_drills (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  trade_id text generated always as (record->>'trade_id') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_drills_trade_id_idx on public.mogmine_drills (user_id, trade_id);

create table public.mogmine_calls (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  trade_id text generated always as (record->>'trade_id') stored,
  plan_session_id text generated always as (record->>'plan_session_id') stored,
  playbook_id text generated always as (record->>'playbook_id') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_calls_trade_id_idx on public.mogmine_calls (user_id, trade_id);

create table public.mogmine_prompt_dismissals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  trade_id text generated always as (record->>'trade_id') stored,
  prompt_id text generated always as (record->>'prompt_id') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_prompt_dismissals_trade_id_idx on public.mogmine_prompt_dismissals (user_id, trade_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Singleton tables (one document per owner)
-- ---------------------------------------------------------------------------------------------------------------

create table public.mogmine_user_prefs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mogmine_mood_registries (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- RLS, grants and triggers for every journal table
-- ---------------------------------------------------------------------------------------------------------------

alter table public.mogmine_trades enable row level security;
revoke all on table public.mogmine_trades from anon;
create policy mogmine_trades_own on public.mogmine_trades for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_trades_touch before insert or update on public.mogmine_trades
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_mood_records enable row level security;
revoke all on table public.mogmine_mood_records from anon;
create policy mogmine_mood_records_own on public.mogmine_mood_records for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_mood_records_touch before insert or update on public.mogmine_mood_records
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_mood_candidates enable row level security;
revoke all on table public.mogmine_mood_candidates from anon;
create policy mogmine_mood_candidates_own on public.mogmine_mood_candidates for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_mood_candidates_touch before insert or update on public.mogmine_mood_candidates
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_accounts enable row level security;
revoke all on table public.mogmine_accounts from anon;
create policy mogmine_accounts_own on public.mogmine_accounts for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_accounts_touch before insert or update on public.mogmine_accounts
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_balance_checks enable row level security;
revoke all on table public.mogmine_balance_checks from anon;
create policy mogmine_balance_checks_own on public.mogmine_balance_checks for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_balance_checks_touch before insert or update on public.mogmine_balance_checks
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_challenges enable row level security;
revoke all on table public.mogmine_challenges from anon;
create policy mogmine_challenges_own on public.mogmine_challenges for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_challenges_touch before insert or update on public.mogmine_challenges
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_playbooks enable row level security;
revoke all on table public.mogmine_playbooks from anon;
create policy mogmine_playbooks_own on public.mogmine_playbooks for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_playbooks_touch before insert or update on public.mogmine_playbooks
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_plans enable row level security;
revoke all on table public.mogmine_plans from anon;
create policy mogmine_plans_own on public.mogmine_plans for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_plans_touch before insert or update on public.mogmine_plans
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_drills enable row level security;
revoke all on table public.mogmine_drills from anon;
create policy mogmine_drills_own on public.mogmine_drills for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_drills_touch before insert or update on public.mogmine_drills
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_calls enable row level security;
revoke all on table public.mogmine_calls from anon;
create policy mogmine_calls_own on public.mogmine_calls for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_calls_touch before insert or update on public.mogmine_calls
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_prompt_dismissals enable row level security;
revoke all on table public.mogmine_prompt_dismissals from anon;
create policy mogmine_prompt_dismissals_own on public.mogmine_prompt_dismissals for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_prompt_dismissals_touch before insert or update on public.mogmine_prompt_dismissals
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_user_prefs enable row level security;
revoke all on table public.mogmine_user_prefs from anon;
create policy mogmine_user_prefs_own on public.mogmine_user_prefs for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_user_prefs_touch before insert or update on public.mogmine_user_prefs
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_mood_registries enable row level security;
revoke all on table public.mogmine_mood_registries from anon;
create policy mogmine_mood_registries_own on public.mogmine_mood_registries for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_mood_registries_touch before insert or update on public.mogmine_mood_registries
  for each row execute function public.mogmine_touch_row();

-- ---------------------------------------------------------------------------------------------------------------
-- Cascade backstop (docs/26 §3 "with parent"). The command layer deletes children first; this catches any other
-- delete path. Foreign keys stay unenforced in v1 (children may arrive before parents in a restore).
-- `mogmine.skip_cascade` is set by mogmine_replace_rows so a backup restore of one type never wipes another.
-- ---------------------------------------------------------------------------------------------------------------

create function public.mogmine_cascade_children()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('mogmine.skip_cascade', true), '') = 'on' then
    return old;
  end if;
  if tg_table_name = 'mogmine_trades' then
    delete from public.mogmine_mood_records where user_id = old.user_id and trade_id = old.id;
    delete from public.mogmine_drills where user_id = old.user_id and trade_id = old.id;
    delete from public.mogmine_prompt_dismissals where user_id = old.user_id and trade_id = old.id;
  elsif tg_table_name = 'mogmine_accounts' then
    delete from public.mogmine_balance_checks where user_id = old.user_id and account_id = old.id;
  end if;
  return old;
end;
$$;
revoke all on function public.mogmine_cascade_children() from public, anon, authenticated;
create trigger mogmine_trades_cascade after delete on public.mogmine_trades
  for each row execute function public.mogmine_cascade_children();
create trigger mogmine_accounts_cascade after delete on public.mogmine_accounts
  for each row execute function public.mogmine_cascade_children();

-- ---------------------------------------------------------------------------------------------------------------
-- replaceAll (backup restore): delete + insert in one transaction. Security invoker, so RLS still applies.
-- p_rows is a jsonb array of sanitized records; each must carry a string `id`.
-- ---------------------------------------------------------------------------------------------------------------

create function public.mogmine_replace_rows(p_table text, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_table not in ('mogmine_trades', 'mogmine_mood_records', 'mogmine_mood_candidates', 'mogmine_accounts', 'mogmine_balance_checks', 'mogmine_challenges', 'mogmine_playbooks', 'mogmine_plans', 'mogmine_drills', 'mogmine_calls', 'mogmine_prompt_dismissals') then
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
