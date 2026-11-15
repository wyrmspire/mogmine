-- PLANNED, NOT APPLIED. M1 / AC-08.
-- Do not move this file into supabase/migrations/ until the owner accepts a
-- journal cutover off localStorage. The app does not read or write these tables.
--
-- Sketch only: column names follow docs/06 where they exist, with RLS from the
-- first row (OD-2). Soft deletes and an updated_at version are included so a
-- later sync can be added without a rewrite.

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  direction text not null check (direction in ('LONG', 'SHORT')),
  entry_time timestamptz not null,
  exit_time timestamptz not null,
  entry_price numeric not null,
  exit_price numeric not null,
  stop_loss_price numeric,
  planned_target_price numeric,
  key_level_price numeric,
  quantity integer,
  note text not null default '',
  review_status text not null default 'new',
  playbook_id text,
  quick_tags text[] not null default '{}',
  pre_trade_thesis text not null default '',
  management_notes text not null default '',
  post_exit_notes text not null default '',
  flagged boolean not null default false,
  is_sample boolean not null default false,
  fixture_version integer,
  annotations_modified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.trade_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trade_id uuid not null references public.trades (id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.trade_annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trade_id uuid not null references public.trades (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.trades enable row level security;
alter table public.trade_notes enable row level security;
alter table public.trade_annotations enable row level security;
alter table public.trades force row level security;
alter table public.trade_notes force row level security;
alter table public.trade_annotations force row level security;

revoke all on table public.trades, public.trade_notes, public.trade_annotations
  from public, anon, authenticated;

grant select, insert, update, delete on table public.trades to authenticated;
grant select, insert, update, delete on table public.trade_notes to authenticated;
grant select, insert, update, delete on table public.trade_annotations to authenticated;

create policy trades_owner_all on public.trades
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy trade_notes_owner_all on public.trade_notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy trade_annotations_owner_all on public.trade_annotations
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
