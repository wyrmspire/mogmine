"use client";

// LV-2 / PS-3: the levels drawn on a trade chart (docs/24 §3, §5). Computed levels need the day-mode
// bars of the prior session and this session up to entry (`loadDayCandles`, R-02 rules). Planned levels
// come from the day's planning sessions for the same instrument, as they stood at entry.
import { useEffect, useMemo, useState } from "react";
import { loadDayCandles } from "@/lib/candles";
import { levelLines, levelsSummary, missingCandleLevels, plannedLineSources, tradeLevelWindows, tradeLevels } from "@/lib/chart-levels";
import type { LevelLine } from "@/lib/chart-levels";
import type { ComputedLevel } from "@/lib/levels";
import { usePlansStore } from "@/lib/plans-store";
import type { TradeRecord } from "@/lib/trades";

export interface TradeLevelsState {
  status: "off" | "loading" | "none" | "ready";
  lines: readonly LevelLine[];
  /** Computed levels withheld for missing bars. */
  missing: readonly string[];
  /** How many drawn levels came from planning sessions. */
  planned: number;
  /** Every level with its exact price, including those whose pill did not fit on the chart. */
  summary: string;
}

const EMPTY: readonly LevelLine[] = [];
const OFF: TradeLevelsState = { status: "off", lines: EMPTY, missing: [], planned: 0, summary: "" };

export function useTradeLevels(trade: TradeRecord, enabled: boolean): TradeLevelsState {
  const key = `${trade.symbol}|${trade.entry_time}`;
  const [computed, setComputed] = useState<{ key: string; levels: readonly ComputedLevel[] } | null>(null);
  const { plans } = usePlansStore();
  // Demo trades never touch the network (issue #89), so they have no computed levels.
  const fetches = enabled && !trade.is_sample && Number.isFinite(Date.parse(trade.entry_time));

  useEffect(() => {
    if (!fetches) return;
    let alive = true;
    const windows = tradeLevelWindows(trade.entry_time);
    void (async () => {
      let levels: readonly ComputedLevel[] = [];
      try {
        const [prior, today] = await Promise.all([
          loadDayCandles(trade.symbol, windows.prior.from, windows.prior.to),
          windows.today ? loadDayCandles(trade.symbol, windows.today.from, windows.today.to).catch(() => null) : null,
        ]);
        levels = tradeLevels(trade, prior, today) ?? [];
      } catch { /* no bars: no computed levels */ }
      if (alive) setComputed({ key, levels });
    })();
    return () => { alive = false; };
    // The key holds every trade field the computed levels depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetches, key]);

  const planned = useMemo(() => (enabled ? plannedLineSources(plans, trade) : []), [enabled, plans, trade]);
  const current = fetches && computed?.key === key ? computed.levels : null;
  const lines = useMemo(
    () => levelLines([...(current ?? []), ...planned], trade.entry_price, trade.symbol),
    [current, planned, trade.entry_price, trade.symbol],
  );

  if (!enabled) return OFF;
  const loading = fetches && current == null;
  return {
    status: lines.length ? "ready" : loading ? "loading" : "none",
    lines,
    missing: current ? missingCandleLevels(current) : [],
    planned: planned.length,
    summary: levelsSummary(lines),
  };
}
