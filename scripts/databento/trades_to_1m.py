#!/usr/bin/env python3
"""Convert Databento MES.FUT trades DBN files into continuous OHLCV bars."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Iterable

import databento as db
import pandas as pd

FIXED_PRICE_SCALE = 1_000_000_000
TICK_FIXED = 250_000_000
OUTRIGHT_RE = re.compile(r"^MES[HMUZ]\d$")
CHICAGO_TZ = "America/Chicago"
OUTPUT_COLUMNS = [
    "symbol",
    "timeframe",
    "ts",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "session_date",
    "vendor_contract",
    "source",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path, help="Directory containing daily *.trades.dbn.zst files")
    parser.add_argument("output_dir", type=Path, help="Directory for derived Parquet files and summary JSON")
    parser.add_argument("--chunk-records", type=int, default=500_000)
    return parser.parse_args()


def session_dates(ts: pd.Series) -> pd.Series:
    """Return the session end date for CME's 17:00-16:00 Chicago session."""
    local = ts.dt.tz_convert(CHICAGO_TZ)
    dates = local.dt.tz_localize(None).dt.normalize()
    return dates + pd.to_timedelta((local.dt.hour >= 17).astype("int8"), unit="D")


def mapped_outrights(store: db.DBNStore) -> set[str]:
    symbols = set(store.metadata.mappings)
    return {symbol for symbol in symbols if OUTRIGHT_RE.fullmatch(symbol)}


def chunk_partials(store: db.DBNStore, chunk_records: int) -> Iterable[pd.DataFrame]:
    frames = store.to_df(
        price_type="fixed",
        pretty_ts=True,
        map_symbols=True,
        count=chunk_records,
    )
    if isinstance(frames, pd.DataFrame):
        frames = iter([frames])

    outrights = mapped_outrights(store)
    for frame in frames:
        if frame.empty:
            continue
        frame = frame.loc[frame["symbol"].isin(outrights), ["ts_event", "price", "size", "symbol"]].copy()
        if frame.empty:
            continue

        invalid = frame.loc[(frame["price"] <= 0) | (frame["price"] % TICK_FIXED != 0)]
        if not invalid.empty:
            sample = invalid[["ts_event", "price", "symbol"]].head(5).to_dict("records")
            raise ValueError(f"Found MES outright trades off the 0.25 tick grid: {sample}")

        frame["minute"] = frame["ts_event"].dt.floor("min")
        frame["session_date"] = session_dates(frame["ts_event"])
        frame["ticks"] = frame["price"] // TICK_FIXED
        grouped = frame.groupby(["session_date", "symbol", "minute"], sort=False, observed=True)
        yield grouped.agg(
            first_event=("ts_event", "first"),
            last_event=("ts_event", "last"),
            open_ticks=("ticks", "first"),
            high_ticks=("ticks", "max"),
            low_ticks=("ticks", "min"),
            close_ticks=("ticks", "last"),
            volume=("size", "sum"),
            trades=("size", "size"),
        ).reset_index()


def merge_partials(partials: list[pd.DataFrame]) -> pd.DataFrame:
    if not partials:
        raise ValueError("No outright MES trades were found")
    merged = pd.concat(partials, ignore_index=True).sort_values("first_event", kind="stable")
    grouped = merged.groupby(["session_date", "symbol", "minute"], sort=False, observed=True)
    return grouped.agg(
        open_ticks=("open_ticks", "first"),
        high_ticks=("high_ticks", "max"),
        low_ticks=("low_ticks", "min"),
        close_ticks=("close_ticks", "last"),
        volume=("volume", "sum"),
        trades=("trades", "sum"),
    ).reset_index()


def select_session_contracts(contract_bars: pd.DataFrame) -> pd.DataFrame:
    volumes = (
        contract_bars.groupby(["session_date", "symbol"], observed=True, as_index=False)["volume"]
        .sum()
        .sort_values(["session_date", "volume", "symbol"], ascending=[True, False, True], kind="stable")
    )
    return volumes.drop_duplicates("session_date", keep="first").rename(
        columns={"symbol": "vendor_contract", "volume": "session_volume"}
    )


def continuous_1m(contract_bars: pd.DataFrame, selections: pd.DataFrame) -> pd.DataFrame:
    selected = contract_bars.merge(
        selections[["session_date", "vendor_contract"]],
        left_on=["session_date", "symbol"],
        right_on=["session_date", "vendor_contract"],
        how="inner",
        validate="many_to_one",
    ).sort_values("minute", kind="stable")
    out = pd.DataFrame(
        {
            "symbol": "MES=F",
            "timeframe": "1m",
            "ts": selected["minute"],
            "open": selected["open_ticks"] / 4.0,
            "high": selected["high_ticks"] / 4.0,
            "low": selected["low_ticks"] / 4.0,
            "close": selected["close_ticks"] / 4.0,
            "volume": selected["volume"].astype("int64"),
            "session_date": selected["session_date"].dt.date,
            "vendor_contract": selected["vendor_contract"],
            "source": "databento",
        }
    )
    return out[OUTPUT_COLUMNS].reset_index(drop=True)


def derive_bars(one_minute: pd.DataFrame, minutes: int) -> pd.DataFrame:
    frame = one_minute.copy()
    frame["bucket"] = frame["ts"].dt.floor(f"{minutes}min")
    grouped = frame.groupby(["session_date", "vendor_contract", "bucket"], sort=False, observed=True)
    out = grouped.agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        volume=("volume", "sum"),
    ).reset_index()
    out.insert(0, "symbol", "MES=F")
    out.insert(1, "timeframe", "1h" if minutes == 60 else f"{minutes}m")
    out = out.rename(columns={"bucket": "ts"})
    out["source"] = "databento"
    return out[OUTPUT_COLUMNS].sort_values("ts", kind="stable").reset_index(drop=True)


def roll_events(selections: pd.DataFrame) -> list[dict[str, object]]:
    ordered = selections.sort_values("session_date", kind="stable").reset_index(drop=True)
    events: list[dict[str, object]] = []
    previous: str | None = None
    for row in ordered.itertuples(index=False):
        if previous is not None and row.vendor_contract != previous:
            events.append(
                {
                    "session_date": row.session_date.date().isoformat(),
                    "from": previous,
                    "to": row.vendor_contract,
                    "selected_volume": int(row.session_volume),
                }
            )
        previous = row.vendor_contract
    return events


def condition_summary(input_dir: Path) -> dict[str, int]:
    path = input_dir / "condition.json"
    if not path.exists():
        return {}
    conditions = json.loads(path.read_text(encoding="utf-8"))
    result: dict[str, int] = {}
    for item in conditions:
        key = str(item.get("condition", "unknown"))
        result[key] = result.get(key, 0) + 1
    return result


def main() -> None:
    args = parse_args()
    files = sorted(args.input_dir.glob("*.trades.dbn.zst"))
    if not files:
        raise SystemExit(f"No *.trades.dbn.zst files found in {args.input_dir}")

    partials: list[pd.DataFrame] = []
    all_outrights: set[str] = set()
    all_spreads: set[str] = set()
    for index, path in enumerate(files, start=1):
        store = db.DBNStore.from_file(path)
        mapped = set(store.metadata.mappings)
        all_outrights.update(symbol for symbol in mapped if OUTRIGHT_RE.fullmatch(symbol))
        all_spreads.update(symbol for symbol in mapped if "-" in symbol)
        partials.extend(chunk_partials(store, args.chunk_records))
        print(f"[{index}/{len(files)}] {path.name}", flush=True)

    contract_bars = merge_partials(partials)
    selections = select_session_contracts(contract_bars)
    one_minute = continuous_1m(contract_bars, selections)
    derived = {"5m": derive_bars(one_minute, 5), "15m": derive_bars(one_minute, 15), "1h": derive_bars(one_minute, 60)}

    args.output_dir.mkdir(parents=True, exist_ok=True)
    one_minute.to_parquet(args.output_dir / "MES_F_1m.parquet", index=False)
    for timeframe, bars in derived.items():
        bars.to_parquet(args.output_dir / f"MES_F_{timeframe}.parquet", index=False)
    selections.assign(session_date=selections["session_date"].dt.date).to_csv(
        args.output_dir / "MES_F_session_contracts.csv", index=False
    )

    per_session = one_minute.groupby("session_date", observed=True).size()
    summary = {
        "input_files": len(files),
        "conditions": condition_summary(args.input_dir),
        "outrights": sorted(all_outrights),
        "calendar_spreads_excluded": len(all_spreads),
        "rows": {"1m": len(one_minute), **{key: len(value) for key, value in derived.items()}},
        "first_ts": one_minute["ts"].min().isoformat(),
        "last_ts": one_minute["ts"].max().isoformat(),
        "sessions": int(per_session.size),
        "bars_per_session": {
            "min": int(per_session.min()),
            "median": float(per_session.median()),
            "max": int(per_session.max()),
        },
        "rolls": roll_events(selections),
    }
    (args.output_dir / "MES_F_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
