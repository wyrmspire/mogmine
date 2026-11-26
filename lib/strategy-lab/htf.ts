// Closed higher-timeframe candle facts (docs/design-2026-11-24/10 §2–§4, TM-2). Pure and lookahead-safe.

import { aggregate } from "./aggregate.ts";
import type { BarSeries } from "./types.ts";

export type HtfMinutes = 5 | 15;
export type TradeSide = "long" | "short";

export interface ClosedHtfCandle {
  minutes: HtfMinutes;
  startTime: number;
  endTime: number;
  /** The candle is a fact at its close; the first acting 1m bar opens at this timestamp. */
  knownAt: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  expected: number;
  present: number;
  missingMinutes: number;
  complete: boolean;
}

/**
 * Completed ET-clock candles whose close is no later than the current 1m bar's open.
 * Thus a candle closing at :15 is unavailable to the bar that closes at :15 and available to the :16 bar.
 */
export function closedHtfCandles(series: BarSeries, throughIndex: number, minutes: HtfMinutes): ClosedHtfCandle[] {
  if (!Number.isInteger(throughIndex) || throughIndex < 0 || throughIndex >= series.time.length) return [];
  const actingBarOpen = series.time[throughIndex];
  const out: ClosedHtfCandle[] = [];
  const lastIndexByBucket = new Map<string, number>();
  for (let i = 0; i <= throughIndex; i += 1) {
    const offset = series.etMinute[i] % minutes;
    const startTime = series.time[i] - offset * series.barMs;
    lastIndexByBucket.set(`${series.sessionDate[i]}:${startTime}`, i);
  }
  for (const i of lastIndexByBucket.values()) {
    const bar = aggregate(series, i, minutes);
    if (!bar || bar.endTime > actingBarOpen) continue;
    const missingMinutes = Math.max(0, minutes - bar.present);
    out.push({
      minutes, startTime: bar.startTime, endTime: bar.endTime, knownAt: bar.endTime,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
      expected: minutes, present: bar.present, missingMinutes, complete: missingMinutes === 0,
    });
  }
  return out;
}

const usable = (candles: readonly ClosedHtfCandle[], count: number): boolean =>
  candles.length >= count && candles.slice(-count).every((c) => c.complete);

/** Missing candles are conservative: any incomplete candle needed by the pattern makes it false. */
export function engulfingAgainst(candles: readonly ClosedHtfCandle[], side: TradeSide): boolean {
  if (!usable(candles, 2)) return false;
  const [prior, current] = candles.slice(-2);
  return side === "long"
    ? prior.close > prior.open && current.close < current.open && current.open >= prior.close && current.close <= prior.open
    : prior.close < prior.open && current.close > current.open && current.open <= prior.close && current.close >= prior.open;
}

/** Long breaks below the prior low; short breaks above the prior high. Incomplete inputs return false. */
export function closeAgainstPriorLow(candles: readonly ClosedHtfCandle[], side: TradeSide): boolean {
  if (!usable(candles, 2)) return false;
  const [prior, current] = candles.slice(-2);
  return side === "long" ? current.close < prior.low : current.close > prior.high;
}

/** The middle candle must be inside its predecessor, then the last close breaks against the trade. */
export function insideBarBreakAgainst(candles: readonly ClosedHtfCandle[], side: TradeSide): boolean {
  if (!usable(candles, 3)) return false;
  const [mother, inside, current] = candles.slice(-3);
  if (inside.high > mother.high || inside.low < mother.low) return false;
  return side === "long" ? current.close < inside.low : current.close > inside.high;
}

/** Null means insufficient history or at least one missing-minute candle. */
export function lastNClosedLow(candles: readonly ClosedHtfCandle[], count: number): number | null {
  if (!Number.isInteger(count) || count < 1 || !usable(candles, count)) return null;
  return Math.min(...candles.slice(-count).map((c) => c.low));
}

/** Null means insufficient history or at least one missing-minute candle. */
export function lastNClosedHigh(candles: readonly ClosedHtfCandle[], count: number): number | null {
  if (!Number.isInteger(count) || count < 1 || !usable(candles, count)) return null;
  return Math.max(...candles.slice(-count).map((c) => c.high));
}

export interface WickFacts { tip: number; midpoint: number }

/** Against-side wick on the last closed candle: lower for a long, upper for a short. */
export function lastClosedWick(candles: readonly ClosedHtfCandle[], side: TradeSide): WickFacts | null {
  if (!usable(candles, 1)) return null;
  const candle = candles[candles.length - 1];
  const bodyEdge = side === "long" ? Math.min(candle.open, candle.close) : Math.max(candle.open, candle.close);
  const tip = side === "long" ? candle.low : candle.high;
  return { tip, midpoint: (tip + bodyEdge) / 2 };
}
