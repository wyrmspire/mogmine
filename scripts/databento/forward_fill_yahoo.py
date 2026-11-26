#!/usr/bin/env python3
"""Carry MES=F 1m forward from Databento using bounded Yahoo windows."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd
import requests

from archive_db import ManagementDb, finish_job, json_recordset, session_window, start_job, timestamp_session_date
from trades_to_1m import session_dates

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
QUARTERS = "HMUZ"
TICK = 0.25


def next_contract(contract: str) -> str:
    prefix, month, year = contract[:-2], contract[-2], int(contract[-1])
    index = QUARTERS.index(month)
    return f"{prefix}{QUARTERS[(index + 1) % 4]}{(year + (index == 3)) % 10}"


def yahoo_contract(contract: str, reference_year: int) -> str:
    digit = int(contract[-1])
    decade = reference_year - reference_year % 10
    year = decade + digit
    if year < reference_year - 2:
        year += 10
    if year > reference_year + 7:
        year -= 10
    return f"{contract[:-1]}{year % 100:02d}.CME"


def fetch_yahoo(symbol: str, start: datetime, end: datetime) -> pd.DataFrame:
    parts: list[pd.DataFrame] = []
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + timedelta(days=7), end)
        response = requests.get(
            YAHOO_URL.format(symbol=symbol),
            params={"period1": int(cursor.timestamp()), "period2": int(chunk_end.timestamp()), "interval": "1m"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=60,
        )
        response.raise_for_status()
        result = response.json()["chart"]["result"][0]
        quote = result["indicators"]["quote"][0]
        frame = pd.DataFrame(
            {"ts": pd.to_datetime(result.get("timestamp", []), unit="s", utc=True),
             **{key: quote.get(key, []) for key in ("open", "high", "low", "close", "volume")}}
        )
        frame = frame.dropna(subset=["open", "high", "low", "close"])
        frame = frame[(frame.ts >= cursor) & (frame.ts < chunk_end) & (frame.ts.dt.second == 0)]
        parts.append(frame)
        cursor = chunk_end
    if not parts:
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume", "session_date"])
    frame = pd.concat(parts, ignore_index=True).drop_duplicates("ts", keep="last").sort_values("ts")
    frame["session_date"] = session_dates(frame.ts).dt.date
    return frame


def contract_match(continuous: pd.DataFrame, current: pd.DataFrame, following: pd.DataFrame) -> dict[str, Any]:
    merged = continuous[["ts", "close"]].merge(
        current[["ts", "close"]], on="ts", suffixes=("_continuous", "_current")
    ).merge(following[["ts", "close"]], on="ts")
    merged = merged.rename(columns={"close": "close_following"})
    if len(merged) < 30:
        raise ValueError("Fewer than 30 common contract bars; cannot identify Yahoo's contract")
    current_error = (merged.close_continuous - merged.close_current).abs()
    following_error = (merged.close_continuous - merged.close_following).abs()
    votes_following = following_error < current_error
    following_share = float(votes_following.mean())
    selected = "following" if following_share > 0.5 else "current"
    minority = min(int(votes_following.sum()), int((~votes_following).sum()))
    selected_error = following_error if selected == "following" else current_error
    if minority > max(5, len(merged) // 50):
        raise ValueError(f"Yahoo continuous series appears to switch contract inside one session ({minority} minority bars)")
    if float(selected_error.median()) > TICK:
        raise ValueError(f"Yahoo continuous series is more than one tick from both candidate contracts")
    spread = (merged.close_following - merged.close_current).iloc[:60].median()
    current_volume = int(current.volume.fillna(0).sum())
    following_volume = int(following.volume.fillna(0).sum())
    return {
        "selected": selected,
        "common_bars": len(merged),
        "following_vote_share": round(following_share, 6),
        "median_abs_error": float(selected_error.median()),
        "spread": float(spread),
        "current_volume": current_volume,
        "following_volume": following_volume,
        "volume_leader": "following" if following_volume > current_volume else "current",
    }


def upsert_yahoo_session(db: ManagementDb, frame: pd.DataFrame, session_day: date) -> int:
    start, end = session_window(session_day)
    rows = [
        {"symbol": "MES=F", "timeframe": "1m", "ts": row.ts.isoformat(),
         "open": row.open, "high": row.high, "low": row.low, "close": row.close,
         "volume": 0 if pd.isna(row.volume) else int(row.volume), "source": "yahoo_finance"}
        for row in frame.itertuples(index=False)
    ]
    payload = json_recordset(rows)
    result = db.execute(f"""
with removed as (
  delete from public.mogmine_market_candles where symbol='MES=F' and timeframe='1m'
    and source='yahoo_finance' and ts >= '{start.isoformat()}' and ts < '{end.isoformat()}'
), upserted as (
  insert into public.mogmine_market_candles (symbol,timeframe,ts,open,high,low,close,volume,source)
  select symbol,timeframe,ts,open,high,low,close,volume,source
  from jsonb_to_recordset({payload}) as x(symbol text,timeframe text,ts timestamptz,
    open numeric,high numeric,low numeric,close numeric,volume numeric,source text)
  on conflict (symbol,timeframe,ts) do update set open=excluded.open,high=excluded.high,
    low=excluded.low,close=excluded.close,volume=excluded.volume,source=excluded.source,ingested_at=now()
  where public.mogmine_market_candles.source <> 'databento'
  returning 1
), covered as (
  insert into public.mogmine_market_coverage
    (symbol,timeframe,session_date,expected_bars,received_bars,missing_ranges,status,source)
  values ('MES=F','1m','{session_day.isoformat()}',null,{len(rows)},'[]','partial','yahoo_finance')
  on conflict (symbol,timeframe,session_date) do update set
    expected_bars=excluded.expected_bars,received_bars=excluded.received_bars,
    missing_ranges=excluded.missing_ranges,status=excluded.status,source=excluded.source,updated_at=now()
  where public.mogmine_market_coverage.source <> 'databento'
)
select count(*) as rows_upserted from upserted
""")
    return int(result[0]["rows_upserted"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--now", type=datetime.fromisoformat)
    args = parser.parse_args()
    now = args.now.replace(tzinfo=timezone.utc) if args.now and args.now.tzinfo is None else (args.now or datetime.now(timezone.utc))
    now = now.astimezone(timezone.utc).replace(second=0, microsecond=0)
    db = ManagementDb()
    last_databento_value = db.execute(
        "select max(ts) last_ts from public.mogmine_market_candles where source='databento'"
    )[0]["last_ts"]
    last_archived_value = db.execute(
        "select max(ts) last_ts from public.mogmine_market_candles where symbol='MES=F' and timeframe='1m'"
    )[0]["last_ts"]
    last_databento = pd.Timestamp(last_databento_value).to_pydatetime()
    last_archived = pd.Timestamp(last_archived_value).to_pydatetime()
    roll = db.execute("select to_contract from public.mogmine_market_rolls where symbol='MES=F' order by session_date desc limit 1")[0]
    current_contract = str(roll["to_contract"])
    following_contract = next_contract(current_contract)
    active_contract = current_contract
    archive_session = timestamp_session_date(last_archived)
    fetch_start = session_window(archive_session)[0]
    job = start_job(db, kind="forward_fill", source="yahoo_finance", range_from=last_archived, range_to=now)
    total = 0
    evidence: dict[str, Any] = {"contracts": [current_contract, following_contract], "sessions": []}
    try:
        continuous = fetch_yahoo("MES=F", fetch_start, now)
        current = fetch_yahoo(yahoo_contract(current_contract, last_databento.year), fetch_start, now)
        following = fetch_yahoo(yahoo_contract(following_contract, last_databento.year), fetch_start, now)
        db_seam = db.execute(
            "select ts,close from public.mogmine_market_candles where source='databento' "
            f"and ts >= '{fetch_start.isoformat()}' order by ts"
        )
        seam = pd.DataFrame(db_seam)
        if not seam.empty:
            seam["ts"] = pd.to_datetime(seam.ts, utc=True)
            seam_compare = seam.merge(continuous[["ts", "close"]], on="ts", suffixes=("_databento", "_yahoo"))
            seam_offset = float((seam_compare.close_databento.astype(float) - seam_compare.close_yahoo).median())
            evidence["seam"] = {"common_bars": len(seam_compare), "median_offset": seam_offset}
            if abs(seam_offset) > TICK:
                raise ValueError(f"Databento/Yahoo seam offset {seam_offset:+.2f} looks like a contract mismatch")

        databento_sessions = {row["session_date"] for row in db.execute(
            "select session_date from public.mogmine_market_coverage where symbol='MES=F' and timeframe='1m' and source='databento'"
        )}
        writable = continuous[continuous.session_date >= archive_session]
        for session_day, bars in writable.groupby("session_date", sort=True):
            if session_day.isoformat() in databento_sessions:
                continue
            match = contract_match(
                bars,
                current[current.session_date == session_day],
                following[following.session_date == session_day],
            )
            selected = following_contract if match["selected"] == "following" else current_contract
            match.update({"session_date": session_day.isoformat(), "provider_contract": selected})
            if selected != active_contract:
                if active_contract != current_contract or selected != following_contract:
                    raise ValueError(f"Yahoo contract moved backward or more than one quarter: {active_contract} to {selected}")
                roll_evidence = json_recordset([match])
                db.execute(
                    "insert into public.mogmine_market_rolls "
                    "(symbol,session_date,from_contract,to_contract,spread,source,evidence) values "
                    f"('MES=F','{session_day.isoformat()}','{active_contract}','{following_contract}',"
                    f"{match['spread']},'yahoo_finance',({roll_evidence}->0)) "
                    "on conflict (symbol,session_date) do update set spread=excluded.spread,source=excluded.source,evidence=excluded.evidence"
                )
                active_contract = following_contract
            total += upsert_yahoo_session(db, bars, session_day)
            evidence["sessions"].append(match)
        finish_job(db, job, status="success", bars=total, result=evidence)
        print(f"Yahoo forward-fill: {total} bars across {len(evidence['sessions'])} sessions")
    except Exception as exc:
        finish_job(db, job, status="failed", bars=total, result=evidence, error=str(exc))
        raise


if __name__ == "__main__":
    main()
