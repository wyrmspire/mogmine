-- Agent write safety: request replay protection and structured, non-prose audit metadata.
-- No request body, bearer token, token hash, or user-authored prose is stored here.

create table public.mogmine_agent_idempotency (
  user_id uuid not null references auth.users (id) on delete cascade,
  token_id uuid references public.mogmine_agent_tokens (id) on delete set null,
  endpoint text not null check (char_length(endpoint) between 1 and 300),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('in_flight', 'completed')),
  status integer check (status is null or status between 200 and 299),
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint, idempotency_key),
  check ((state = 'in_flight' and status is null and response_body is null)
    or (state = 'completed' and status is not null and response_body is not null))
);
create index mogmine_agent_idempotency_created_idx on public.mogmine_agent_idempotency (user_id, created_at desc);
alter table public.mogmine_agent_idempotency enable row level security;
revoke all on table public.mogmine_agent_idempotency from anon, authenticated;
grant select, insert, update, delete on table public.mogmine_agent_idempotency to service_role;
comment on table public.mogmine_agent_idempotency is 'Agent POST create replay records; body is the already-returned JSON response, never a secret or instruction source.';

alter table public.mogmine_agent_audit
  add column if not exists request_id text check (request_id is null or char_length(request_id) <= 80),
  add column if not exists decision_code text check (decision_code is null or decision_code ~ '^[a-z0-9_:-]{1,80}$'),
  add column if not exists decision_version text check (decision_version is null or decision_version ~ '^[a-z0-9_.:-]{1,80}$');
create index mogmine_agent_audit_request_idx on public.mogmine_agent_audit (user_id, request_id);
