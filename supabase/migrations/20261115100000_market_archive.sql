-- M0 candle archive (issue #70).
-- One observation per (symbol, timeframe, ts). This supersedes the jsonb-per-session
-- blob proposed in docs/09 §8; session coverage lives in market_coverage (AC-03).
-- Symbols are Yahoo tickers MES=F and MNQ=F only (OD-15). Auth and RLS ship with
-- the first table (OD-2, B-40). Writes are service-role only; authenticated users
-- may read. Anon has no access.

create table if not exists public.market_candles (
  symbol text not null check (symbol in ('MES=F', 'MNQ=F')),
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '1h')),
  ts timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null default 0,
  source text not null default 'yahoo_finance' check (source in ('yahoo_finance')),
  ingested_at timestamptz not null default now(),
  primary key (symbol, timeframe, ts)
);

comment on table public.market_candles is
  'Bar-level market observations. Unique on (symbol, timeframe, ts). Written only by the service role.';

create table if not exists public.market_coverage (
  symbol text not null check (symbol in ('MES=F', 'MNQ=F')),
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '1h')),
  session_date date not null,
  expected_bars integer,
  received_bars integer not null default 0,
  missing_ranges jsonb not null default '[]'::jsonb,
  status text not null check (status in ('complete', 'partial', 'missing', 'closed')),
  updated_at timestamptz not null default now(),
  primary key (symbol, timeframe, session_date)
);

comment on table public.market_coverage is
  'Per-session coverage for the candle archive (AC-03). Weekends with no expected bars are closed. Holiday awareness waits on issue #65.';

create table if not exists public.market_archive_jobs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  kind text not null check (kind in ('daily', 'backfill', 'repair')),
  symbol text check (symbol is null or symbol in ('MES=F', 'MNQ=F')),
  timeframe text not null default '1m' check (timeframe in ('1m', '5m', '15m', '1h')),
  range_from timestamptz,
  range_to timestamptz,
  status text not null check (status in ('started', 'success', 'partial', 'failed')),
  bars_upserted integer not null default 0,
  last_error text,
  result jsonb not null default '{}'::jsonb
);

comment on table public.market_archive_jobs is
  'Ingestion-run log (AC-02, AC-04). One row per 8-day (or smaller) batch so a failed batch can be retried on its own.';

create index if not exists market_archive_jobs_status_started_idx
  on public.market_archive_jobs (status, started_at desc);

create index if not exists market_archive_jobs_batch_idx
  on public.market_archive_jobs (kind, symbol, timeframe, range_from, range_to);

alter table public.market_candles enable row level security;
alter table public.market_coverage enable row level security;
alter table public.market_archive_jobs enable row level security;

alter table public.market_candles force row level security;
alter table public.market_coverage force row level security;
alter table public.market_archive_jobs force row level security;

revoke all on table public.market_candles from public, anon, authenticated;
revoke all on table public.market_coverage from public, anon, authenticated;
revoke all on table public.market_archive_jobs from public, anon, authenticated;

grant select on table public.market_candles to authenticated;
grant select on table public.market_coverage to authenticated;
grant select on table public.market_archive_jobs to authenticated;

drop policy if exists market_candles_read_authenticated on public.market_candles;
create policy market_candles_read_authenticated
  on public.market_candles
  for select
  to authenticated
  using (true);

drop policy if exists market_coverage_read_authenticated on public.market_coverage;
create policy market_coverage_read_authenticated
  on public.market_coverage
  for select
  to authenticated
  using (true);

drop policy if exists market_archive_jobs_read_authenticated on public.market_archive_jobs;
create policy market_archive_jobs_read_authenticated
  on public.market_archive_jobs
  for select
  to authenticated
  using (true);

-- No insert, update, or delete policies. The service role bypasses RLS and is
-- the only writer. Authenticated users cannot mutate these tables even with a
-- stolen anon key (B-40, B-54).
