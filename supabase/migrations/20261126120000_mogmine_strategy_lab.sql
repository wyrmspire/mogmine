-- SL-15a: Strategy Lab recipes, runs and the 1m bar cache (docs/design-2026-11-24/09-strategy-lab.md §11.2, D-012).
-- MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP). Written by a worker; never applied by a worker.
-- Additive only: every object below is named mogmine_*. Nothing here reads, alters or removes another app's tables,
-- auth settings or project config.
--
-- Recipes and runs follow the journal row pattern (user_id default auth.uid(), text id, record jsonb, own rows AND
-- allow-listed, touch trigger). Every recipe version is kept: primary key (user_id, id, version).
-- mogmine_bars_1m is shared market data with no user_id: authenticated users read it, only service_role writes it.

create table public.mogmine_strategy_recipes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  version integer not null check (version >= 1),
  playbook_id text null,
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  archived boolean not null generated always as (coalesce((record->>'archived')::boolean, false)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id, version)
);
create index mogmine_strategy_recipes_playbook_idx on public.mogmine_strategy_recipes (user_id, playbook_id);

create table public.mogmine_strategy_runs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  recipe_id text not null,
  recipe_version integer not null,
  summary jsonb not null,
  matches jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index mogmine_strategy_runs_recipe_idx on public.mogmine_strategy_runs (user_id, recipe_id, created_at desc);

create table public.mogmine_bars_1m (
  symbol text not null,
  time timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume integer null,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, time)
);

alter table public.mogmine_strategy_recipes enable row level security;
revoke all on table public.mogmine_strategy_recipes from anon;
grant select, insert, update, delete on table public.mogmine_strategy_recipes to authenticated, service_role;
create policy mogmine_strategy_recipes_own on public.mogmine_strategy_recipes for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_strategy_recipes_touch before insert or update on public.mogmine_strategy_recipes
  for each row execute function public.mogmine_touch_row();

alter table public.mogmine_strategy_runs enable row level security;
revoke all on table public.mogmine_strategy_runs from anon;
grant select, insert, update, delete on table public.mogmine_strategy_runs to authenticated, service_role;
create policy mogmine_strategy_runs_own on public.mogmine_strategy_runs for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_strategy_runs_touch before insert or update on public.mogmine_strategy_runs
  for each row execute function public.mogmine_touch_row();

-- Bar cache: read-only for signed-in, allow-listed users. No write policy and no authenticated write grant:
-- the archive job writes with the service_role key only.
alter table public.mogmine_bars_1m enable row level security;
revoke all on table public.mogmine_bars_1m from anon;
create policy mogmine_bars_1m_read on public.mogmine_bars_1m for select to authenticated
  using ((select public.mogmine_is_allowed()));
grant select on table public.mogmine_bars_1m to authenticated;
grant select, insert, update, delete on table public.mogmine_bars_1m to service_role;
