"use client";

// LV-2: load the day-mode bars a trade's computed levels need (docs/24 §5) and turn them into lines.
// The bars come through the same cached route as the entry form (`loadDayCandles`, R-02 rules).
import { useEffect, useState } from "react";
import { loadDayCandles } from "@/lib/candles";
import { levelLines, missingCandleLevels, tradeLevelWindows, tradeLevels } from "@/lib/chart-levels";
import type { LevelLine } from "@/lib/chart-levels";
import type { TradeRecord } from "@/lib/trades";

export type TradeLevelsState =
  | { status: "off" | "loading" | "none"; lines: readonly LevelLine[] }
  | { status: "ready"; lines: readonly LevelLine[]; missing: readonly string[] };

const EMPTY: readonly LevelLine[] = [];

export function useTradeLevels(trade: TradeRecord, enabled: boolean): TradeLevelsState {
  const key = `${trade.symbol}|${trade.entry_time}|${trade.entry_price}`;
  const [state, setState] = useState<{ key: string; value: TradeLevelsState } | null>(null);
  // Demo trades never touch the network (issue #89), so they have no levels.
  const active = enabled && !trade.is_sample && Number.isFinite(Date.parse(trade.entry_time));

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const windows = tradeLevelWindows(trade.entry_time);
    void (async () => {
      try {
        const [prior, today] = await Promise.all([
          loadDayCandles(trade.symbol, windows.prior.from, windows.prior.to),
          windows.today ? loadDayCandles(trade.symbol, windows.today.from, windows.today.to).catch(() => null) : null,
        ]);
        const levels = tradeLevels(trade, prior, today);
        if (!alive) return;
        setState({ key, value: levels
          ? { status: "ready", lines: levelLines(levels, trade.entry_price, trade.symbol), missing: missingCandleLevels(levels) }
          : { status: "none", lines: EMPTY } });
      } catch {
        if (alive) setState({ key, value: { status: "none", lines: EMPTY } });
      }
    })();
    return () => { alive = false; };
    // The key holds every trade field the levels depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);

  if (!active) return { status: enabled ? "none" : "off", lines: EMPTY };
  return state?.key === key ? state.value : { status: "loading", lines: EMPTY };
}
