"use client";

// LV-2 / PS-3: the levels drawn on a trade chart (docs/24 §3, §5). Computed levels need the day-mode
// bars of the prior session and this session up to entry (`loadDayCandles`, R-02 rules). Planned levels
// come from the day's planning sessions for the same instrument, as they stood at entry.
// VW-1: this session's window runs from 18:00 ET to the close or now, so session VWAP can read it too.
import { useEffect, useMemo, useState } from "react";
import { loadDayCandles } from "@/lib/candles";
import type { DayCandles } from "@/lib/candles";
import { levelLines, levelsSummary, plannedLineSources, tradeLevelReport, tradeLevelWindows } from "@/lib/chart-levels";
import type { LevelLine, WithheldLevel } from "@/lib/chart-levels";
import type { ComputedLevel } from "@/lib/levels";
import { usePlansStore } from "@/lib/plans-store";
import { equityIndexSessionBounds, sessionDate } from "@/lib/session";
import type { Candle, Timeframe, TradeRecord } from "@/lib/trades";

export interface TradeLevelsState {
  status: "off" | "loading" | "none" | "ready";
  lines: readonly LevelLine[];
  /** Candle levels withheld, each with its reason (OD-55). */
  withheld: readonly WithheldLevel[];
  /** How many drawn levels came from planning sessions. */
  planned: number;
  /** Every level with its exact price, including those whose pill did not fit on the chart. */
  summary: string;
  /** This session's bars from 18:00 ET to the close or now (VW-1). Empty until fetched. Levels never read past entry. */
  sessionCandles: readonly Candle[];
  sessionTimeframe: Timeframe | null;
}

const EMPTY: readonly LevelLine[] = [];
const EMPTY_BARS: readonly Candle[] = [];
const OFF: TradeLevelsState = {
  status: "off", lines: EMPTY, withheld: [], planned: 0, summary: "", sessionCandles: EMPTY_BARS, sessionTimeframe: null,
};
const MINUTE_MS = 60_000;

/**
 * @param sessionWanted true when session VWAP is on, so the session window loads even with levels off.
 */
export function useTradeLevels(trade: TradeRecord, enabled: boolean, sessionWanted = false): TradeLevelsState {
  const key = `${trade.symbol}|${trade.entry_time}`;
  const [computed, setComputed] = useState<{ key: string; levels: readonly ComputedLevel[]; withheld: readonly WithheldLevel[]; session: DayCandles | null } | null>(null);
  const { plans } = usePlansStore();
  // Demo trades never touch the network (issue #89), so they have no computed levels.
  const fetches = (enabled || sessionWanted) && !trade.is_sample && Number.isFinite(Date.parse(trade.entry_time));

  useEffect(() => {
    if (!fetches) return;
    let alive = true;
    const windows = tradeLevelWindows(trade.entry_time);
    const entryMs = Date.parse(trade.entry_time);
    const bounds = equityIndexSessionBounds(sessionDate(entryMs));
    // Rounded to the minute, so the cache key holds steady while the page stays open.
    const nowMinute = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
    void (async () => {
      let levels: readonly ComputedLevel[] = [];
      let withheld: readonly WithheldLevel[] = [];
      let session: DayCandles | null = null;
      try {
        const [prior, today] = await Promise.all([
          loadDayCandles(trade.symbol, windows.prior.from, windows.prior.to),
          windows.today ? loadDayCandles(trade.symbol, bounds.open, Math.min(bounds.close, nowMinute)).catch(() => null) : null,
        ]);
        session = today;
        // Levels cut at entry (the as-of rule): bars after entry never reach the level calculation.
        const todayAtEntry = today && { candles: today.candles.filter(({ time }) => time < entryMs), baseTimeframe: today.baseTimeframe };
        const report = tradeLevelReport(trade, prior, todayAtEntry);
        levels = report?.levels ?? [];
        withheld = report?.withheld ?? [];
      } catch { /* no bars: no computed levels */ }
      if (alive) setComputed({ key, levels, withheld, session });
    })();
    return () => { alive = false; };
    // The key holds every trade field the computed levels depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetches, key]);

  const planned = useMemo(() => (enabled ? plannedLineSources(plans, trade) : []), [enabled, plans, trade]);
  const current = fetches && computed?.key === key ? computed.levels : null;
  const session = fetches && computed?.key === key ? computed.session : null;
  const lines = useMemo(
    () => levelLines([...(current ?? []), ...planned], trade.entry_price, trade.symbol),
    [current, planned, trade.entry_price, trade.symbol],
  );
  const sessionCandles = session?.candles ?? EMPTY_BARS;
  const sessionTimeframe = session?.baseTimeframe ?? null;

  if (!enabled) return { ...OFF, sessionCandles, sessionTimeframe };
  const loading = fetches && current == null;
  return {
    status: lines.length ? "ready" : loading ? "loading" : "none",
    lines,
    withheld: current && computed ? computed.withheld : [],
    planned: planned.length,
    summary: levelsSummary(lines),
    sessionCandles,
    sessionTimeframe,
  };
}
