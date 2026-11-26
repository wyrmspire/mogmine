"use client";

// LV-2 / PS-3: the levels drawn on a trade chart (docs/24 §3, §5). Computed levels need the day-mode
// bars of the prior session and this session up to entry (`loadDayCandles`, R-02 rules). Planned levels
// come from the day's planning sessions for the same instrument, as they stood at entry.
// VW-1: this session's window runs from 18:00 ET to the close or now, so session VWAP can read it too.
// IN-3: the 200 EMA on the displayed timeframe reads earlier sessions too (`priorSessionsForEma`), for 700 bars of warm-up.
import { useEffect, useMemo, useState } from "react";
import { loadDayCandles } from "@/lib/candles";
import type { DayCandles } from "@/lib/candles";
import { levelLines, levelsSummary, plannedLineSources, tradeLevelReport, tradeLevelWindows } from "@/lib/chart-levels";
import type { LevelLine, WithheldLevel } from "@/lib/chart-levels";
import { EMA_MIN_BARS, computeEma200, emaUnavailable } from "@/lib/ema";
import type { Ema200Result } from "@/lib/ema";
import type { ComputedLevel } from "@/lib/levels";
import { usePlansStore } from "@/lib/plans-store";
import { equityIndexSessionBounds, previousRegularSessionDate, sessionDate } from "@/lib/session";
import { TIMEFRAME_MINUTES } from "@/lib/trades";
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
  /** IN-3: the 200 EMA on the displayed timeframe, or null when not requested or still loading. */
  ema200: Ema200Result | null;
}

const EMPTY: readonly LevelLine[] = [];
const EMPTY_BARS: readonly Candle[] = [];
const OFF: TradeLevelsState = {
  status: "off", lines: EMPTY, withheld: [], planned: 0, summary: "", sessionCandles: EMPTY_BARS, sessionTimeframe: null, ema200: null,
};
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Yahoo keeps 1m bars for about 30 days (docs/design-2026-11-24/03 §6). */
const ONE_MINUTE_MAX_AGE_MS = 30 * DAY_MS;
/** One Globex session is 23 hours of 1m bars. */
const SESSION_MINUTES = 23 * 60;
/** More prior sessions than this is not worth fetching (1h needs about 31): the EMA then reports its short warm-up. */
const EMA_MAX_PRIOR_SESSIONS = 10;
const TOO_OLD_1M = "1m bars older than 30 days are unavailable from Yahoo";

/** Prior regular sessions to load so the displayed timeframe has 700 bars of warm-up (Globex sessions, 23 h each). */
function priorSessionsForEma(timeframe: Timeframe): number {
  const sessions = Math.ceil((EMA_MIN_BARS * TIMEFRAME_MINUTES[timeframe]) / SESSION_MINUTES);
  return sessions <= EMA_MAX_PRIOR_SESSIONS ? sessions : 0;
}

/**
 * @param sessionWanted true when session VWAP is on, so the session window loads even with levels off.
 */
export function useTradeLevels(trade: TradeRecord, enabled: boolean, sessionWanted = false, emaTimeframe: Timeframe | null = null): TradeLevelsState {
  const key = `${trade.symbol}|${trade.entry_time}`;
  const [computed, setComputed] = useState<{ key: string; levels: readonly ComputedLevel[]; withheld: readonly WithheldLevel[]; session: DayCandles | null } | null>(null);
  // IN-3: earlier sessions for the 200 EMA, keyed by trade and timeframe. `tooOld` marks a 1m request past Yahoo's keep.
  const [priors, setPriors] = useState<{ key: string; days: readonly (DayCandles | null)[]; tooOld: boolean } | null>(null);
  const { plans } = usePlansStore();
  // Demo trades never touch the network (issue #89), so they have no computed levels.
  const fetches = (enabled || sessionWanted || emaTimeframe !== null) && !trade.is_sample && Number.isFinite(Date.parse(trade.entry_time));
  const emaId = emaTimeframe ? `${key}|${emaTimeframe}` : null;

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
        const [prior, today, earlierWeek] = await Promise.all([
          loadDayCandles(trade.symbol, windows.prior.from, windows.prior.to),
          windows.today ? loadDayCandles(trade.symbol, bounds.open, Math.min(bounds.close, nowMinute)).catch(() => null) : null,
          // Earlier week days (Mon to the day before prior) for week_high / week_low. A failed day is null: that level is withheld.
          Promise.all(windows.earlierWeek.map((w) => loadDayCandles(trade.symbol, w.from, w.to).catch(() => null))),
        ]);
        session = today;
        // Levels cut at entry (the as-of rule): bars after entry never reach the level calculation.
        const todayAtEntry = today && { candles: today.candles.filter(({ time }) => time < entryMs), baseTimeframe: today.baseTimeframe };
        const report = tradeLevelReport(trade, prior, todayAtEntry, earlierWeek);
        levels = report?.levels ?? [];
        withheld = report?.withheld ?? [];
      } catch { /* no bars: no computed levels */ }
      if (alive) setComputed({ key, levels, withheld, session });
    })();
    return () => { alive = false; };
    // The key holds every trade field the computed levels depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetches, key]);

  useEffect(() => {
    if (!emaTimeframe || !emaId || trade.is_sample || !Number.isFinite(Date.parse(trade.entry_time))) return;
    let alive = true;
    const entryMs = Date.parse(trade.entry_time);
    const tooOld = emaTimeframe === "1m" && Date.now() - entryMs > ONE_MINUTE_MAX_AGE_MS;
    const dates: string[] = [];
    let date = sessionDate(entryMs);
    for (let i = 0; !tooOld && i < priorSessionsForEma(emaTimeframe); i += 1) {
      date = previousRegularSessionDate(date);
      dates.push(date);
    }
    // Oldest first, so the warm-up reads in time order. A missing session is null: the EMA then reports its short history.
    void Promise.all(dates.reverse().map((day) => {
      const bounds = equityIndexSessionBounds(day);
      return loadDayCandles(trade.symbol, bounds.open, bounds.close).catch(() => null);
    })).then((days) => { if (alive) setPriors({ key: emaId, days, tooOld }); });
    return () => { alive = false; };
    // The key holds every trade field the warm-up depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emaId]);

  // The 200 EMA reads the prior sessions and this session (`session`, from 18:00 ET to the close or now).
  const session = fetches && computed?.key === key ? computed.session : null;
  const ema200 = useMemo<Ema200Result | null>(() => {
    if (!emaTimeframe || !emaId || !fetches || computed?.key !== key || priors?.key !== emaId) return null;
    if (priors.tooOld) return emaUnavailable(emaTimeframe, TOO_OLD_1M);
    // A 1m chart reads only 1m history: 5m bars there would be drawn as if they were 1m. Coarser charts aggregate either.
    const days = priors.days.filter((day): day is DayCandles => day !== null);
    const base = computed.session?.baseTimeframe ?? days.at(-1)?.baseTimeframe;
    const history = days.filter((day) => emaTimeframe !== "1m" || day.baseTimeframe === base).flatMap((day) => day.candles);
    return computeEma200([...history, ...(computed.session?.candles ?? [])], emaTimeframe);
  }, [emaTimeframe, emaId, fetches, key, computed, priors]);

  const planned = useMemo(() => (enabled ? plannedLineSources(plans, trade) : []), [enabled, plans, trade]);
  const current = fetches && computed?.key === key ? computed.levels : null;
  const lines = useMemo(
    () => levelLines([...(current ?? []), ...planned], trade.entry_price, trade.symbol),
    [current, planned, trade.entry_price, trade.symbol],
  );
  const sessionCandles = session?.candles ?? EMPTY_BARS;
  const sessionTimeframe = session?.baseTimeframe ?? null;

  if (!enabled) return { ...OFF, sessionCandles, sessionTimeframe, ema200 };
  const loading = fetches && current == null;
  return {
    status: lines.length ? "ready" : loading ? "loading" : "none",
    lines,
    withheld: current && computed ? computed.withheld : [],
    planned: planned.length,
    summary: levelsSummary(lines),
    sessionCandles,
    sessionTimeframe,
    ema200,
  };
}
