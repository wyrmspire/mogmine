// IND-1 (docs/24 §5): session VWAP on the trade chart, from `computeSessionIndicators`. Pure, no I/O.
// The anchor stays the trader's choice: RTH versus Globex is open under OD-18 (docs/11 §4).
import { computeSessionIndicators } from "./session-indicators.ts";
import { equityIndexSessionBounds, sessionDate } from "./session.ts";
import { TIMEFRAME_MINUTES } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";

export type VwapAnchor = "rth" | "globex";

export interface VwapPoint {
  /** Open time of the displayed bar, UTC ms. The value includes that bar (it is known at its close). */
  time: number;
  value: number;
}

export interface TradeSessionVwapReport {
  points: { time: number; value: number }[];
  /** True when Globex VWAP was drawn over a window with missing bars (VW-2). */
  approximate: boolean;
  missingBars: number;
  /** Visible note for an approximate line, e.g. "≈ 23 min missing overnight"; null when exact. */
  reason: string | null;
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
): TradeSessionVwapReport | null {
  const symbol = trade.symbol.toUpperCase();
  const entry = Date.parse(trade.entry_time);
  if ((symbol !== "MES" && symbol !== "MNQ") || !Number.isFinite(entry) || !candles.length) return null;
  const barMs = TIMEFRAME_MINUTES[baseTimeframe] * 60_000;
  const lastClose = Math.max(...candles.map((bar) => bar.time)) + barMs;
  const asOf = Math.min(lastClose, equityIndexSessionBounds(sessionDate(entry)).close);
  const gapPolicy = anchor === "globex" ? "globex-tolerant" : "complete";
  const result = computeSessionIndicators(candles, { symbol, timeframe: baseTimeframe, asOf, anchor, gapPolicy });
  if (!result || !result.vwap.length) return null;
  const { approximate, missingBars } = result.coverage.anchored;
  const missingMinutes = missingBars * TIMEFRAME_MINUTES[baseTimeframe];
  return {
    points: result.vwap,
    approximate,
    missingBars,
    reason: approximate ? `≈ ${missingMinutes} min missing overnight` : null,
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
  if (sessionTimeframe !== timeframe) return [...bars];
  const byTime = new Map<number, Candle>();
  for (const bar of [...session, ...bars]) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
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
