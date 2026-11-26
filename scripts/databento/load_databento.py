#!/usr/bin/env python3
"""Authoritatively load derived Databento 1m bars into the MogMine archive."""

from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

import pandas as pd

from archive_db import ManagementDb, finish_job, json_recordset, session_window, start_job


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("parquet", type=Path)
    parser.add_argument("--from-session", type=date.fromisoformat, required=True)
    parser.add_argument("--to-session", type=date.fromisoformat, required=True)
    return parser.parse_args()


def load_session(db: ManagementDb, frame: pd.DataFrame, session_day: date) -> int:
    start, end = session_window(session_day)
    rows = [
        {
            "symbol": "MES=F",
            "timeframe": "1m",
            "ts": row.ts.isoformat(),
            "open": row.open,
            "high": row.high,
            "low": row.low,
            "close": row.close,
            "volume": int(row.volume),
            "source": "databento",
        }
        for row in frame.itertuples(index=False)
    ]
    payload = json_recordset(rows)
    result = db.execute(
        f"""
with removed_yahoo as (
  delete from public.mogmine_market_candles
  where symbol='MES=F' and timeframe='1m' and source='yahoo_finance'
    and ts >= '{start.isoformat()}' and ts < '{end.isoformat()}'
  returning 1
), upserted as (
  insert into public.mogmine_market_candles
    (symbol,timeframe,ts,open,high,low,close,volume,source)
  select symbol,timeframe,ts,open,high,low,close,volume,source
  from jsonb_to_recordset({payload}) as x(
    symbol text,timeframe text,ts timestamptz,open numeric,high numeric,
    low numeric,close numeric,volume numeric,source text)
  on conflict (symbol,timeframe,ts) do update set
    open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,
    volume=excluded.volume,source=excluded.source,ingested_at=now()
  returning 1
), covered as (
  insert into public.mogmine_market_coverage
    (symbol,timeframe,session_date,expected_bars,received_bars,missing_ranges,status,source)
  values ('MES=F','1m','{session_day.isoformat()}',{len(rows)},{len(rows)},'[]','complete','databento')
  on conflict (symbol,timeframe,session_date) do update set
    expected_bars=excluded.expected_bars,received_bars=excluded.received_bars,
    missing_ranges=excluded.missing_ranges,status=excluded.status,
    source=excluded.source,updated_at=now()
)
select (select count(*) from upserted) as rows_upserted,
       (select count(*) from removed_yahoo) as yahoo_removed
"""
    )
    print(f"{session_day}: {result[0]['rows_upserted']} Databento, {result[0]['yahoo_removed']} Yahoo removed")
    return int(result[0]["rows_upserted"])


def main() -> None:
    args = parse_args()
    frame = pd.read_parquet(args.parquet)
    dates = pd.to_datetime(frame["session_date"]).dt.date
    frame = frame[(dates >= args.from_session) & (dates <= args.to_session)].copy()
    if frame.empty:
        raise SystemExit("No bars in the requested session range")
    db = ManagementDb()
    job = start_job(db, kind="backfill", source="databento", range_from=frame.ts.min(), range_to=frame.ts.max())
    total = 0
    try:
        for session_day, bars in frame.groupby("session_date", sort=True):
            total += load_session(db, bars, pd.Timestamp(session_day).date())
        finish_job(db, job, status="success", bars=total, result={"sessions": frame.session_date.nunique()})
    except Exception as exc:
        finish_job(db, job, status="failed", bars=total, result={}, error=str(exc))
        raise


if __name__ == "__main__":
    main()
