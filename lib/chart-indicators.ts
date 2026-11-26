// IND-1 (docs/24 §5): session VWAP on the trade chart, from `computeSessionIndicators`. Pure, no I/O.
// The anchor stays the trader's choice: RTH versus Globex is open under OD-18 (docs/11 §4).
import { computeSessionIndicators } from "./session-indicators.ts";
import { equityIndexSessionBounds, sessionDate } from "./session.ts";
import { TIMEFRAME_MINUTES } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";
import { asMixedCandle } from "./mixed-resolution.ts";
import type { MixedCandle, ResolutionUsage } from "./mixed-resolution.ts";

export type VwapAnchor = "rth" | "globex";

export interface VwapPoint {
  /** Open time of the displayed bar, UTC ms. The value includes that bar (it is known at its close). */
  time: number;
  value: number;
}

export interface VwapBandPoint extends VwapPoint {
  multiple: number;
  upper: number;
  lower: number;
}

export interface TradeSessionVwapReport {
  points: { time: number; value: number }[];
  /** True when Globex VWAP was drawn over a window with missing bars (VW-2). */
  approximate: boolean;
  missingBars: number;
  /** Visible note for an approximate line, e.g. "≈ 23 min missing overnight"; null when exact. */
  reason: string | null;
  bands: VwapBandPoint[][];
  weeklyPoints: VwapPoint[];
  weeklyBands: VwapBandPoint[][];
  weeklyApproximate: boolean;
  weeklyReason: string | null;
}

const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Compact visible provenance, e.g. "23:00–23:08 from 5m/1h" (end minute inclusive). */
export function formatResolutionUsage(usage: readonly ResolutionUsage[]): string | null {
  if (!usage.length) return null;
  const groups: Array<{ from: number; to: number; sources: Set<string> }> = [];
  for (const stretch of usage) {
    const previous = groups.at(-1);
    if (previous?.to === stretch.from) {
      previous.to = stretch.to;
      previous.sources.add(stretch.fillFrom);
    } else groups.push({ from: stretch.from, to: stretch.to, sources: new Set([stretch.fillFrom]) });
  }
  return groups.map(({ from, to, sources }) =>
    `${clock.format(new Date(from))}–${clock.format(new Date(to - 60_000))} from ${[...sources].join("/")}`,
  ).join(" · ");
}

/**
 * Cumulative VWAP and its completeness for the trade's own session, from the trade's native candles. The cutoff
 * is the session's 17:00 ET close or the last loaded bar, whichever is first: the candle set runs 15 h past the
 * exit, and a later cutoff would anchor to the next session. Null when the anchored window cannot be drawn:
 * RTH needs every bar, Globex may skip small overnight gaps (VW-2).
 */
export function tradeSessionVwapReport(
  trade: { symbol: string; entry_time: string },
  candles: readonly Candle[],
  baseTimeframe: Timeframe,
  anchor: VwapAnchor,
  bandMultiples: readonly number[] = [1, 2],
): TradeSessionVwapReport | null {
  const symbol = trade.symbol.toUpperCase();
  const entry = Date.parse(trade.entry_time);
  if ((symbol !== "MES" && symbol !== "MNQ") || !Number.isFinite(entry) || !candles.length) return null;
  const barMs = TIMEFRAME_MINUTES[baseTimeframe] * 60_000;
  const lastClose = Math.max(...candles.map((bar) => bar.time + ("minutes" in bar && typeof bar.minutes === "number" ? bar.minutes * 60_000 : barMs)));
  const asOf = Math.min(lastClose, equityIndexSessionBounds(sessionDate(entry)).close);
  const gapPolicy = anchor === "globex" ? "globex-tolerant" : "complete";
  const result = computeSessionIndicators(candles, { symbol, timeframe: baseTimeframe, asOf, anchor, gapPolicy, bandMultiples });
  if (!result || (!result.vwap.length && !result.weeklyVwap.length)) return null;
  const { approximate, missingBars, usage } = result.coverage.anchored;
  const reason = formatResolutionUsage(usage);
  const weeklyReason = formatResolutionUsage(result.weeklyUsage);
  return {
    points: result.vwap,
    approximate,
    missingBars,
    reason: approximate && reason ? `≈ ${reason}` : null,
    bands: result.vwapBands,
    weeklyPoints: result.weeklyVwap,
    weeklyBands: result.weeklyVwapBands,
    weeklyApproximate: result.weeklyUsage.length > 0,
    weeklyReason: weeklyReason ? `≈ ${weeklyReason}` : null,
  };
}

/** Cumulative VWAP points for the trade's own session. See `tradeSessionVwapReport`. */
export function tradeSessionVwap(
  trade: { symbol: string; entry_time: string },
  candles: readonly Candle[],
  baseTimeframe: Timeframe,
  anchor: VwapAnchor,
): { time: number; value: number }[] | null {
  return tradeSessionVwapReport(trade, candles, baseTimeframe, anchor)?.points ?? null;
}

/**
 * VW-1: the session's bars (18:00 ET to the close or now) joined with the trade's own bars, one per open time and
 * in time order. Session bars join only on the trade's timeframe, so a 5m session never mixes into a 1m series.
 */
export function joinSessionBars(
  session: readonly Candle[],
  sessionTimeframe: Timeframe | null,
  bars: readonly Candle[],
  timeframe: Timeframe,
): Candle[] {
  const nativeTagged = session.every((bar) => "minutes" in bar && "fillFrom" in bar);
  if (sessionTimeframe !== timeframe && !nativeTagged) return [...bars];
  if (!session.length) return [...bars];
  const taggedSession = session.map((bar) => "minutes" in bar && "fillFrom" in bar
    ? bar as MixedCandle : asMixedCandle(bar, sessionTimeframe ?? timeframe));
  const byTimeAndWidth = new Map<string, MixedCandle>();
  for (const bar of taggedSession) byTimeAndWidth.set(`${bar.time}:${bar.minutes}`, bar);
  for (const bar of bars) {
    const tagged = asMixedCandle(bar, timeframe);
    byTimeAndWidth.set(`${tagged.time}:${tagged.minutes}`, tagged);
  }
  return [...byTimeAndWidth.values()].sort((a, b) => a.time - b.time || a.minutes - b.minutes);
}

/**
 * Place cumulative VWAP on the displayed bars. A displayed bar takes the latest point known by its close,
 * and only when that point falls inside it, so a coarser chart never shows a value before its bars exist.
 */
export function vwapOnBars(
  points: readonly { time: number; value: number }[],
  bars: readonly Pick<Candle, "time">[],
  timeframe: Timeframe,
): VwapPoint[] {
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  const line: VwapPoint[] = [];
  let i = 0;
  for (const bar of bars) {
    const close = bar.time + barMs;
    while (i < points.length && points[i].time <= close) i += 1;
    const known = points[i - 1];
    if (known && known.time > bar.time) line.push({ time: bar.time, value: known.value });
  }
  return line;
}

/** Map cumulative standard-deviation bands to displayed bar opens with the same close-time rule as VWAP. */
export function vwapBandsOnBars(
  bands: readonly (readonly VwapBandPoint[])[], bars: readonly Pick<Candle, "time">[], timeframe: Timeframe,
): VwapBandPoint[][] {
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  return bands.map((series) => {
    const line: VwapBandPoint[] = [];
    let i = 0;
    for (const bar of bars) {
      const close = bar.time + barMs;
      while (i < series.length && series[i].time <= close) i += 1;
      const known = series[i - 1];
      if (known && known.time > bar.time) line.push({ ...known, time: bar.time });
    }
    return line;
  });
}
