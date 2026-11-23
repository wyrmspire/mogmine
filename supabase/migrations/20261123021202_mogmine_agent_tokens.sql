-- #185: revocable agent tokens and the agent audit log. mogmine_ objects only (D-012).
-- A token's plaintext is shown once in the browser and never stored: only its SHA-256 hex hash is kept.
-- The signed-in, allow-listed owner creates, lists and revokes their own tokens through RLS (anon key + session).
-- The server resolves a Bearer token to its owner with the service role (server-only, always by token_hash), then
-- acts as that owner with the owner's own session, so the journal tables' RLS and the allow-list still apply.

create table public.mogmine_agent_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text not null check (token_prefix ~ '^mmk_[A-Za-z0-9_-]{4,12}$'),
  scopes text[] not null default array['read']::text[]
    check (cardinality(scopes) between 1 and 2 and scopes <@ array['read', 'write']::text[]),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index mogmine_agent_tokens_user_idx on public.mogmine_agent_tokens (user_id, created_at desc);
alter table public.mogmine_agent_tokens enable row level security;
revoke all on table public.mogmine_agent_tokens from anon, authenticated;
-- The owner never reads token_hash back; they insert it once and can only set revoked_at afterwards.
grant select (id, user_id, label, token_prefix, scopes, created_at, last_used_at, revoked_at)
  on table public.mogmine_agent_tokens to authenticated;
grant insert (user_id, label, token_hash, token_prefix, scopes) on table public.mogmine_agent_tokens to authenticated;
grant update (revoked_at) on table public.mogmine_agent_tokens to authenticated;
grant select, insert, update, delete on table public.mogmine_agent_tokens to service_role;
create policy mogmine_agent_tokens_read_own on public.mogmine_agent_tokens for select to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
create policy mogmine_agent_tokens_insert_own on public.mogmine_agent_tokens for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
-- Revoke only: the new row must be revoked, so a revoked token can never be brought back.
create policy mogmine_agent_tokens_revoke_own on public.mogmine_agent_tokens for update to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()))
  with check (user_id = (select auth.uid()) and revoked_at is not null);
comment on table public.mogmine_agent_tokens is 'MogMine agent API tokens (#185). SHA-256 hash only; plaintext shown once.';

create table public.mogmine_agent_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_id uuid references public.mogmine_agent_tokens (id) on delete set null,
  at timestamptz not null default now(),
  method text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  path text not null check (char_length(path) <= 300),
  record_type text check (char_length(record_type) <= 60),
  record_id text check (char_length(record_id) <= 200),
  status integer not null check (status between 100 and 599),
  outcome text not null check (char_length(outcome) <= 40)
);
create index mogmine_agent_audit_user_at_idx on public.mogmine_agent_audit (user_id, at desc);
create index mogmine_agent_audit_token_idx on public.mogmine_agent_audit (token_id);
alter table public.mogmine_agent_audit enable row level security;
revoke all on table public.mogmine_agent_audit from anon, authenticated;
grant select on table public.mogmine_agent_audit to authenticated;
grant select, insert on table public.mogmine_agent_audit to service_role;
create policy mogmine_agent_audit_read_own on public.mogmine_agent_audit for select to authenticated
  using (user_id = (select auth.uid()) and (select public.mogmine_is_allowed()));
comment on table public.mogmine_agent_audit is 'MogMine agent API audit log (#185). Written by the server only.';
