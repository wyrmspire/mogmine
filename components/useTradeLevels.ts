"use client";

// LV-2 / PS-3: the levels drawn on a trade chart (docs/24 §3, §5). Computed levels need the day-mode
// bars of the prior session and this session up to entry (`loadDayCandles`, R-02 rules). Planned levels
// come from the day's planning sessions for the same instrument, as they stood at entry.
// VW-1: this session's window runs from 18:00 ET to the close or now, so session VWAP can read it too.
// IN-3: the 200 EMA on the displayed timeframe reads earlier sessions too (`priorSessionsForEma`), for 700 bars of warm-up.
import { useEffect, useMemo, useState } from "react";
import { loadDayCandles } from "@/lib/candles";
import type { DayCandles } from "@/lib/candles";
import { levelLines, levelsSummary, mergeLevelZones, plannedLineSources, plannedZones, tradeLevelReport, tradeLevelWindows } from "@/lib/chart-levels";
import type { LevelLine, LevelZone, WithheldLevel } from "@/lib/chart-levels";
import { adrRequiredSessionDates, buildAdrIndicator } from "@/lib/adr-indicator";
import { EMA_WARMUP_EXTRA, computeEma, emaUnavailable } from "@/lib/ema";
import type { EmaResult, EmaSource } from "@/lib/ema";
import type { ComputedLevel } from "@/lib/levels";
import { computeLevelsFromInputs, extractSessionInputsFromCandles } from "@/lib/levels";
import { buildSessionLevelIndicator } from "@/lib/session-level-indicator";
import type { IndicatorInstance } from "@/lib/indicator-kit";
import { usePlansStore } from "@/lib/plans-store";
import { equityIndexSessionBounds, previousRegularSessionDate, sessionDate } from "@/lib/session";
import { TIMEFRAME_MINUTES, specFor } from "@/lib/trades";
import type { Candle, Timeframe, TradeRecord } from "@/lib/trades";

export interface TradeLevelsState {
  status: "off" | "loading" | "none" | "ready";
  lines: readonly LevelLine[];
  zones: readonly LevelZone[];
  /** Candle levels withheld, each with its reason (OD-55). */
  withheld: readonly WithheldLevel[];
  /** How many drawn levels came from planning sessions. */
  planned: number;
  /** Every level with its exact price, including those whose pill did not fit on the chart. */
  summary: string;
  /** Current-week bars through this session's close/now, for session and Sunday-open weekly VWAP. */
  sessionCandles: readonly Candle[];
  sessionTimeframe: Timeframe | null;
  /** IN-3: the 200 EMA on the displayed timeframe, or null when not requested or still loading. */
  ema200: EmaResult | null;
  emas: Readonly<Record<string, EmaResult>>;
}

const EMPTY: readonly LevelLine[] = [];
const EMPTY_BARS: readonly Candle[] = [];
const OFF: TradeLevelsState = {
  status: "off", lines: EMPTY, zones: [], withheld: [], planned: 0, summary: "", sessionCandles: EMPTY_BARS, sessionTimeframe: null, ema200: null, emas: {},
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
function priorSessionsForEma(timeframe: Timeframe, barsNeeded: number): number {
  const sessions = Math.ceil((barsNeeded * TIMEFRAME_MINUTES[timeframe]) / SESSION_MINUTES);
  return sessions <= EMA_MAX_PRIOR_SESSIONS ? sessions : 0;
}

/**
 * @param sessionWanted true when session VWAP is on, so the session window loads even with levels off.
 */
export interface EmaRequest { id: string; timeframe: Timeframe; length: number; source: EmaSource }

export function useTradeLevels(trade: TradeRecord, enabled: boolean, sessionWanted = false, emaRequests: readonly EmaRequest[] = [], indicatorInstances: readonly IndicatorInstance[] = []): TradeLevelsState {
  const key = `${trade.symbol}|${trade.entry_time}`;
  const [computed, setComputed] = useState<{ key: string; levels: readonly ComputedLevel[]; withheld: readonly WithheldLevel[]; session: DayCandles | null; indicators: DayCandles | null; indicatorDays: readonly { sessionDate: string; day: DayCandles }[] } | null>(null);
  // IN-3: earlier sessions for the 200 EMA, keyed by trade and timeframe. `tooOld` marks a 1m request past Yahoo's keep.
  const [priors, setPriors] = useState<{ key: string; days: readonly (DayCandles | null)[]; tooOld: boolean } | null>(null);
  const { plans } = usePlansStore();
  // Demo trades never touch the network (issue #89), so they have no computed levels.
  const emaTimeframe = emaRequests[0]?.timeframe ?? null;
  const adrInstances = useMemo(() => indicatorInstances.filter((instance) => instance.indicatorId === "adr" && instance.visible), [indicatorInstances]);
  const sessionLevelInstance = useMemo(() => indicatorInstances.find((instance) => instance.indicatorId === "session-levels" && instance.visible), [indicatorInstances]);
  const indicatorKey = useMemo(() => indicatorInstances.map((instance) => `${instance.instanceId}:${instance.visible}:${JSON.stringify(instance.params)}:${JSON.stringify(instance.style)}`).join("|"), [indicatorInstances]);
  const fetches = (enabled || sessionWanted || emaTimeframe !== null || adrInstances.length > 0) && !trade.is_sample && Number.isFinite(Date.parse(trade.entry_time));
  const emaId = emaTimeframe ? `${key}|${emaRequests.map(({ id, timeframe: tf, length, source }) => `${id}:${tf}:${length}:${source}`).join("|")}` : null;

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
      let indicators: DayCandles | null = null;
      let loadedIndicatorDays: readonly { sessionDate: string; day: DayCandles }[] = [];
      try {
        const historyDates = adrRequiredSessionDates(windows.sessionDate, adrInstances);
        const levelDaysBack = Math.trunc(Number(sessionLevelInstance?.params.daysBack ?? 1));
        for (let index = 0; index <= levelDaysBack; index += 1) {
          let date = windows.sessionDate;
          for (let step = 0; step < index; step += 1) date = previousRegularSessionDate(date);
          if (!historyDates.includes(date)) historyDates.push(date);
        }
        for (const week of windows.earlierWeek) if (!historyDates.includes(week.sessionDate)) historyDates.push(week.sessionDate);
        const [prior, today, earlierWeek, historyDays] = await Promise.all([
          loadDayCandles(trade.symbol, windows.prior.from, windows.prior.to, undefined, true),
          windows.today ? loadDayCandles(trade.symbol, bounds.open, Math.min(bounds.close, nowMinute), undefined, true).catch(() => null) : null,
          // Earlier week days (Mon to the day before prior) for week_high / week_low. A failed day is null: that level is withheld.
          Promise.all(windows.earlierWeek.map((w) => loadDayCandles(trade.symbol, w.from, w.to, undefined, true).catch(() => null))),
          Promise.all(historyDates.map(async (date) => {
            const dayBounds = equityIndexSessionBounds(date);
            const to = date === windows.sessionDate ? Math.min(dayBounds.close, nowMinute) : dayBounds.close;
            const day = await loadDayCandles(trade.symbol, dayBounds.open, to, undefined, true).catch(() => null);
            return day ? { sessionDate: date, day } : null;
          })),
        ]);
        session = today;
        loadedIndicatorDays = historyDays.filter((item): item is { sessionDate: string; day: DayCandles } => item !== null);
        const sessionDays = [...earlierWeek.filter((day): day is DayCandles => day !== null), prior, ...(today ? [today] : [])];
        indicators = sessionDays.length ? {
          candles: sessionDays.flatMap((day) => day.candles),
          baseTimeframe: today?.baseTimeframe ?? prior.baseTimeframe,
          fetchedAt: Math.min(...sessionDays.map((day) => day.fetchedAt)),
        } : null;
        // Levels cut at entry (the as-of rule): bars after entry never reach the level calculation.
        const todayAtEntry = today && { candles: today.candles.filter(({ time }) => time < entryMs), baseTimeframe: today.baseTimeframe };
        const report = tradeLevelReport(trade, prior, todayAtEntry, earlierWeek);
        levels = report?.levels ?? [];
        withheld = report?.withheld ?? [];
      } catch { /* no bars: no computed levels */ }
      if (alive) setComputed({ key, levels, withheld, session, indicators, indicatorDays: loadedIndicatorDays });
    })();
    return () => { alive = false; };
    // The key holds every trade field the computed levels depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetches, key, indicatorKey]);

  useEffect(() => {
    if (!emaTimeframe || !emaId || trade.is_sample || !Number.isFinite(Date.parse(trade.entry_time))) return;
    let alive = true;
    const entryMs = Date.parse(trade.entry_time);
    const tooOld = emaTimeframe === "1m" && Date.now() - entryMs > ONE_MINUTE_MAX_AGE_MS;
    const dates: string[] = [];
    let date = sessionDate(entryMs);
    const barsNeeded = Math.max(...emaRequests.map(({ length }) => length + EMA_WARMUP_EXTRA));
    for (let i = 0; !tooOld && i < priorSessionsForEma(emaTimeframe, barsNeeded); i += 1) {
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
  }, [emaId, emaRequests, emaTimeframe, trade.entry_time, trade.is_sample, trade.symbol]);

  // The 200 EMA reads the prior sessions and this session (`session`, from 18:00 ET to the close or now).
  const session = fetches && computed?.key === key ? computed.session : null;
  const emas = useMemo<Readonly<Record<string, EmaResult>>>(() => {
    if (!emaTimeframe || !emaId || !fetches || computed?.key !== key || priors?.key !== emaId) return {};
    // A 1m chart reads only 1m history: 5m bars there would be drawn as if they were 1m. Coarser charts aggregate either.
    const days = priors.days.filter((day): day is DayCandles => day !== null);
    const base = computed.session?.baseTimeframe ?? days.at(-1)?.baseTimeframe;
    const history = days.filter((day) => emaTimeframe !== "1m" || day.baseTimeframe === base).flatMap((day) => day.candles);
    const bars = [...history, ...(computed.session?.candles ?? [])];
    return Object.fromEntries(emaRequests.map((request) => [request.id, priors.tooOld
      ? { ...emaUnavailable(request.timeframe, TOO_OLD_1M), calcVersion: `ema-v2-${request.length}-${request.source}`, length: request.length, source: request.source }
      : computeEma(bars, request.timeframe, request.length, request.source)]));
  }, [emaTimeframe, emaId, emaRequests, fetches, key, computed, priors]);
  const ema200 = Object.values(emas)[0] ?? null;

  const planned = useMemo(() => (enabled ? plannedLineSources(plans, trade) : []), [enabled, plans, trade]);
  const current = fetches && computed?.key === key ? computed.levels : null;
  const sessionDays = useMemo(() => {
    if (!sessionLevelInstance || computed?.key !== key || (trade.symbol !== "MES" && trade.symbol !== "MNQ")) return [];
    const allCandles = computed.indicatorDays.flatMap(({ day }) => day.candles);
    const count = Math.max(1, Math.min(10, Math.trunc(Number(sessionLevelInstance.params.daysBack))));
    let date = sessionDate(Date.parse(trade.entry_time));
    return Array.from({ length: count }, (_, index) => {
      if (index > 0) date = previousRegularSessionDate(date);
      return date;
    }).flatMap((date, index) => {
      const row = computed.indicatorDays.find(({ sessionDate: item }) => item === date);
      if (!row) return [];
      const bounds = equityIndexSessionBounds(date);
      const asOf = index === 0 ? Date.parse(trade.entry_time) : bounds.rthOpen;
      try {
        const snapshot = extractSessionInputsFromCandles({
          symbol: trade.symbol as "MES" | "MNQ", provider: "yahoo_finance", providerSymbol: specFor(trade.symbol)?.yahooTicker ?? "",
          sessionDate: date, candles: allCandles, timeframe: row.day.baseTimeframe, asOf,
        });
        return [{ sessionDate: date, from: bounds.open, to: bounds.close,
          levels: computeLevelsFromInputs({ symbol: trade.symbol, sessionDate: date, inputs: snapshot.inputs }) }];
      } catch { return []; }
    });
  }, [sessionLevelInstance, computed, key, trade.entry_time, trade.symbol]);
  const sessionOutput = useMemo(() => sessionLevelInstance
    ? buildSessionLevelIndicator(sessionLevelInstance, sessionDays, trade.entry_price, trade.symbol, false)
    : { lines: levelLines(current ?? [], trade.entry_price, trade.symbol), zones: [] },
  [sessionLevelInstance, sessionDays, current, trade.entry_price, trade.symbol]);
  const adrOutput = useMemo(() => {
    if (computed?.key !== key || (trade.symbol !== "MES" && trade.symbol !== "MNQ")) return { lines: [] as LevelLine[], zones: [] as LevelZone[] };
    const days = computed.indicatorDays.map(({ sessionDate: date, day }) => ({ sessionDate: date, candles: day.candles, timeframe: day.baseTimeframe }));
    const results = adrInstances.map((instance) => buildAdrIndicator(instance, trade.symbol as "MES" | "MNQ", sessionDate(Date.parse(trade.entry_time)), days));
    return { lines: results.flatMap(({ lines: value }) => value), zones: results.flatMap(({ zones: value }) => value) };
  }, [computed, key, adrInstances, trade.entry_time, trade.symbol]);
  const plannedZoneRows = useMemo(() => enabled ? plannedZones(plans, trade, trade.entry_price) : [], [enabled, plans, trade]);
  const rawLines = useMemo(() => [...sessionOutput.lines, ...levelLines(planned, trade.entry_price, trade.symbol), ...adrOutput.lines],
    [sessionOutput.lines, planned, adrOutput.lines, trade.entry_price, trade.symbol]);
  const merged = useMemo(() => sessionLevelInstance ? mergeLevelZones(rawLines, Number(sessionLevelInstance.params.mergeTolerance))
    : { lines: rawLines, zones: [] as LevelZone[] }, [rawLines, sessionLevelInstance]);
  const lines = merged.lines;
  const zones = useMemo(() => {
    const fill = sessionLevelInstance?.style.zoneFill;
    const mergedZones = merged.zones.map((zone) => ({ ...zone,
      ...(fill?.kind === "fill" ? { color: fill.color, fillOpacity: fill.visible ? fill.opacity : 0 } : {}),
    }));
    return [...mergedZones, ...sessionOutput.zones, ...plannedZoneRows, ...adrOutput.zones];
  }, [merged.zones, sessionOutput.zones, plannedZoneRows, adrOutput.zones, sessionLevelInstance]);
  const sessionCandles = computed?.key === key ? computed.indicators?.candles ?? EMPTY_BARS : EMPTY_BARS;
  const sessionTimeframe = computed?.key === key ? computed.indicators?.baseTimeframe ?? null : null;

  if (!enabled && adrInstances.length === 0) return { ...OFF, sessionCandles, sessionTimeframe, ema200, emas };
  const loading = fetches && current == null;
  return {
    status: lines.length || zones.length ? "ready" : loading ? "loading" : "none",
    lines,
    zones,
    withheld: current && computed ? computed.withheld : [],
    planned: planned.length,
    summary: levelsSummary(lines),
    sessionCandles,
    sessionTimeframe,
    ema200,
    emas,
  };
}
