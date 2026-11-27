-- #70 follow-up: permanent source precedence, archive-run log and unadjusted
-- contract-roll ledger. Additive on the shared showmob-dev project (D-012):
-- only mogmine_ objects are created or altered.

create table public.mogmine_market_archive_jobs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  kind text not null check (kind in ('daily', 'backfill', 'repair', 'forward_fill')),
  source text not null check (source in ('databento', 'yahoo_finance')),
  symbol text check (symbol is null or symbol in ('MES=F', 'MNQ=F')),
  timeframe text not null default '1m' check (timeframe in ('1m', '5m', '15m', '1h')),
  range_from timestamptz,
  range_to timestamptz,
  status text not null check (status in ('started', 'success', 'partial', 'failed')),
  bars_upserted integer not null default 0 check (bars_upserted >= 0),
  last_error text,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object')
);

create index mogmine_market_archive_jobs_started_idx
  on public.mogmine_market_archive_jobs (started_at desc);
create index mogmine_market_archive_jobs_status_idx
  on public.mogmine_market_archive_jobs (status, started_at desc);

comment on table public.mogmine_market_archive_jobs is
  'One row per bounded archive run. Written only by the service role.';

create table public.mogmine_market_rolls (
  symbol text not null check (symbol in ('MES=F', 'MNQ=F')),
  session_date date not null,
  from_contract text not null check (from_contract ~ '^(MES|MNQ)[HMUZ][0-9]$'),
  to_contract text not null check (to_contract ~ '^(MES|MNQ)[HMUZ][0-9]$'),
  spread numeric not null,
  source text not null check (source in ('databento', 'yahoo_finance')),
  detected_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  primary key (symbol, session_date),
  check (from_contract <> to_contract)
);

comment on table public.mogmine_market_rolls is
  'Unadjusted continuous-series rolls. spread is new minus old in points from overlapping outright trades.';

-- A Yahoo upsert may refresh another Yahoo row, but it can never replace a
-- Databento row. Databento writes may replace either source. Returning OLD is
-- deliberate: a mixed batch remains idempotent without failing at its overlap.
create function public.mogmine_preserve_databento_candle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source = 'databento' and new.source <> 'databento' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.mogmine_preserve_databento_candle() from public, anon, authenticated;

create trigger mogmine_market_candles_preserve_databento
  before update on public.mogmine_market_candles
  for each row execute function public.mogmine_preserve_databento_candle();

alter table public.mogmine_market_archive_jobs enable row level security;
alter table public.mogmine_market_archive_jobs force row level security;
alter table public.mogmine_market_rolls enable row level security;
alter table public.mogmine_market_rolls force row level security;

revoke all on table public.mogmine_market_archive_jobs from public, anon, authenticated;
revoke all on table public.mogmine_market_rolls from public, anon, authenticated;
grant select on table public.mogmine_market_archive_jobs to authenticated;
grant select on table public.mogmine_market_rolls to authenticated;
grant select, insert, update, delete on table public.mogmine_market_archive_jobs to service_role;
grant select, insert, update, delete on table public.mogmine_market_rolls to service_role;

create policy mogmine_market_archive_jobs_shared_read
  on public.mogmine_market_archive_jobs for select to authenticated using (true);
create policy mogmine_market_rolls_shared_read
  on public.mogmine_market_rolls for select to authenticated using (true);

-- Databento roll dates use the highest-volume outright for each complete CME
-- 17:00-16:00 Chicago session. The spread is the median (new - old) of the
-- first 60 common one-minute closes after that session opens.
insert into public.mogmine_market_rolls
  (symbol, session_date, from_contract, to_contract, spread, source, evidence)
values
  ('MES=F', '2026-03-16', 'MESH6', 'MESM6', 49.50, 'databento',
    '{"method":"first_60_common_1m_close_median","common_minutes":1380,"first_difference":49.5}'::jsonb),
  ('MES=F', '2026-06-15', 'MESM6', 'MESU6', 63.00, 'databento',
    '{"method":"first_60_common_1m_close_median","common_minutes":1380,"first_difference":62.75}'::jsonb),
  ('MES=F', '2026-09-14', 'MESU6', 'MESZ6', 66.75, 'databento',
    '{"method":"first_60_common_1m_close_median","common_minutes":1380,"first_difference":67.25}'::jsonb)
on conflict (symbol, session_date) do update set
  from_contract = excluded.from_contract,
  to_contract = excluded.to_contract,
  spread = excluded.spread,
  source = excluded.source,
  evidence = excluded.evidence;

-- No authenticated write policies. service_role is the sole writer and
-- bypasses RLS; anon has no privileges on either table or the trigger function.
