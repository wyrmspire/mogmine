-- PL-3: editable tag registry on the shared showmob-dev project (D-012, docs/design-2026-11-24/01-playbook-lab.md §5, Q-6).
-- MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP). Written by a worker; never applied by a worker.
-- Additive only: every object below is named mogmine_*. Nothing here reads, alters or drops another app's tables,
-- auth settings or project config.
--
-- Same singleton pattern as mogmine_mood_registries (20261123004734_mogmine_journal_v1.sql): one document per owner,
-- primary key user_id, the sanitized TagRegistry as `record jsonb`. Access is the journal rule: own rows AND allow-listed.

create table public.mogmine_tag_registries (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mogmine_tag_registries enable row level security;
revoke all on table public.mogmine_tag_registries from anon;
grant select, insert, update, delete on table public.mogmine_tag_registries to authenticated, service_role;
create policy mogmine_tag_registries_own on public.mogmine_tag_registries for all to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create trigger mogmine_tag_registries_touch before insert or update on public.mogmine_tag_registries
  for each row execute function public.mogmine_touch_row();
