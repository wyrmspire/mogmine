"use client";

// LV-2: load the day-mode bars a trade's computed levels need (docs/24 §5) and turn them into lines.
// The bars come through the same cached route as the entry form (`loadDayCandles`, R-02 rules).
import { useEffect, useMemo, useState } from "react";
import { loadDayCandles } from "@/lib/candles";
import type { CandleEntry } from "@/lib/candles";
import { levelLines, missingCandleLevels, tradeLevelWindows, tradeLevels } from "@/lib/chart-levels";
import type { LevelLine } from "@/lib/chart-levels";
import type { TradeRecord } from "@/lib/trades";

export type TradeLevelsState =
  | { status: "off" | "loading" | "none"; lines: readonly LevelLine[] }
  | { status: "ready"; lines: readonly LevelLine[]; missing: readonly string[] };

const EMPTY: readonly LevelLine[] = [];
type LevelTrade = Pick<TradeRecord, "symbol" | "entry_time" | "entry_price">;

function readyState(trade: LevelTrade, sources: Parameters<typeof tradeLevels>[1]): TradeLevelsState {
  const levels = tradeLevels(trade, sources);
  return levels
    ? { status: "ready", lines: levelLines(levels, trade.entry_price, trade.symbol), missing: missingCandleLevels(levels) }
    : { status: "none", lines: EMPTY };
}

export function useTradeLevels(
  trade: TradeRecord,
  enabled: boolean,
  localCandles?: Pick<CandleEntry, "status" | "candles" | "baseTimeframe">,
): TradeLevelsState {
  const { symbol, entry_time: entryTime, entry_price: entryPrice, is_sample: isSample } = trade;
  const key = `${symbol}|${entryTime}|${entryPrice}`;
  const [state, setState] = useState<{ key: string; value: TradeLevelsState } | null>(null);
  // Demo trades never touch the network (issue #89). Their shared offline week supplies the same
  // native-series level calculation instead of silently disabling the level feature.
  const sampleState = useMemo<TradeLevelsState | null>(() => {
    if (!enabled || !isSample) return null;
    if (!localCandles || localCandles.status === "loading") return { status: "loading", lines: EMPTY };
    if (localCandles.status !== "ready") return { status: "none", lines: EMPTY };
    return readyState({ symbol, entry_time: entryTime, entry_price: entryPrice }, [localCandles]);
  }, [enabled, entryPrice, entryTime, isSample, localCandles, symbol]);
  const active = enabled && !isSample && Number.isFinite(Date.parse(entryTime));

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const windows = tradeLevelWindows(trade.entry_time);
    void (async () => {
      const sources = (await Promise.all(windows.requests.map(({ from, to }) =>
        loadDayCandles(trade.symbol, from, to).catch(() => null),
      ))).filter((source) => source != null);
      if (alive) setState({ key, value: readyState(trade, sources) });
    })();
    return () => { alive = false; };
    // The key holds every trade field the levels depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);

  if (sampleState) return sampleState;
  if (!active) return { status: enabled ? "none" : "off", lines: EMPTY };
  return state?.key === key ? state.value : { status: "loading", lines: EMPTY };
}
