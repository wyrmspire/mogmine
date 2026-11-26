-- #70: shared MES/MNQ market archive (D-012, docs/26 §4).
-- Additive only. These shared rows have no user_id: authenticated users may
-- read them, while only the server-side service role may write them.

create table public.mogmine_market_candles (
  symbol text not null check (symbol in ('MES=F', 'MNQ=F')),
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '1h')),
  ts timestamptz not null check (ts = date_trunc('minute', ts)),
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null default 0 check (volume >= 0),
  source text not null check (source in ('databento', 'yahoo_finance')),
  ingested_at timestamptz not null default now(),
  primary key (symbol, timeframe, ts),
  check (high >= greatest(open, close) and low <= least(open, close) and high >= low)
);

comment on table public.mogmine_market_candles is
  'Shared bar-level market archive. Upserted only by the service role.';

create table public.mogmine_market_coverage (
  symbol text not null check (symbol in ('MES=F', 'MNQ=F')),
  timeframe text not null check (timeframe in ('1m', '5m', '15m', '1h')),
  session_date date not null,
  expected_bars integer check (expected_bars is null or expected_bars >= 0),
  received_bars integer not null default 0 check (received_bars >= 0),
  missing_ranges jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_ranges) = 'array'),
  status text not null check (status in ('complete', 'partial', 'missing', 'closed')),
  source text not null check (source in ('databento', 'yahoo_finance')),
  updated_at timestamptz not null default now(),
  primary key (symbol, timeframe, session_date)
);

comment on table public.mogmine_market_coverage is
  'Per-session archive coverage. session_date is the CME trading-session end date.';

alter table public.mogmine_market_candles enable row level security;
alter table public.mogmine_market_candles force row level security;
alter table public.mogmine_market_coverage enable row level security;
alter table public.mogmine_market_coverage force row level security;

revoke all on table public.mogmine_market_candles from public, anon, authenticated;
revoke all on table public.mogmine_market_coverage from public, anon, authenticated;
grant select on table public.mogmine_market_candles to authenticated;
grant select on table public.mogmine_market_coverage to authenticated;
grant select, insert, update, delete on table public.mogmine_market_candles to service_role;
grant select, insert, update, delete on table public.mogmine_market_coverage to service_role;

create policy mogmine_market_candles_shared_read
  on public.mogmine_market_candles
  for select
  to authenticated
  using (true);

create policy mogmine_market_coverage_shared_read
  on public.mogmine_market_coverage
  for select
  to authenticated
  using (true);

-- No authenticated insert, update, or delete policies. The service role is the
-- sole writer and bypasses RLS. anon has no privileges.
