// Coverage test for a candle payload (issue #90, AC-07). Used by the market-data route to pick an
// attempt and by the client cache, so a cached set and a fresh set are judged the same way.
// Client-safe: no Node-only imports.
import { TIMEFRAME_MINUTES, expectedInsideBarTimes } from "../trades.ts";
import type { Candle, Timeframe } from "../trades.ts";

export interface TradeWindowCoverage {
  /** The bar that holds the entry fill is present. */
  entryBar: boolean;
  /** The bar that holds the exit fill is present. */
  exitBar: boolean;
  /** Open times of expected fully-inside bars that are missing, in order. */
  missingInside: number[];
}

/**
 * Break a payload down against the trade window: the bar that holds the entry fill, the bar that
 * holds the exit fill, and every bar that is entirely inside the hold (from the shared
 * `expectedInsideBarTimes`). Bar times are open times in UTC milliseconds, the same unit as
 * `Candle.time`. Invalid trade times report nothing present.
 */
export function tradeWindowCoverage(candles: Candle[], entryMs: number, exitMs: number, timeframe: Timeframe, symbol?: string): TradeWindowCoverage {
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs) || exitMs <= entryMs) {
    return { entryBar: false, exitBar: false, missingInside: [] };
  }
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  const present = new Set(candles.map((bar) => bar.time));
  const missingInside = expectedInsideBarTimes(entryMs, exitMs, barMs, symbol).filter((time) => !present.has(time));
  return {
    entryBar: present.has(Math.floor(entryMs / barMs) * barMs),
    exitBar: present.has(Math.floor(exitMs / barMs) * barMs),
    missingInside,
  };
}

/**
 * True when the payload anchors the trade: the entry bar and the exit bar are both present
 * (AC-07). A payload can anchor the trade and still have gaps inside the hold; those are drawn
 * as gaps and counted on screen, not rejected.
 *
 * Entry-only mode (R-03c): `exitMs` null is an open trade, which needs only its entry bar.
 */
export function anchorsTradeWindow(candles: Candle[], entryMs: number, exitMs: number | null, timeframe: Timeframe, symbol?: string): boolean {
  if (exitMs == null) {
    if (!Number.isFinite(entryMs)) return false;
    const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
    const entryBar = Math.floor(entryMs / barMs) * barMs;
    return candles.some((bar) => bar.time === entryBar);
  }
  const coverage = tradeWindowCoverage(candles, entryMs, exitMs, timeframe, symbol);
  return coverage.entryBar && coverage.exitBar;
}

/**
 * True when the payload has every bar needed to chart the trade window at this timeframe:
 * the bar that holds the entry fill, the bar that holds the exit fill, and every bar that is
 * entirely inside the hold (from the shared `expectedInsideBarTimes`).
 *
 * Count is not coverage: four bars that miss the window fail, and so does a set with a gap.
 * Bar times are open times in UTC milliseconds, the same unit as `Candle.time`.
 */
export function coversTradeWindow(candles: Candle[], entryMs: number, exitMs: number, timeframe: Timeframe, symbol?: string): boolean {
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs) || exitMs <= entryMs) return false;
  const coverage = tradeWindowCoverage(candles, entryMs, exitMs, timeframe, symbol);
  return coverage.entryBar && coverage.exitBar && coverage.missingInside.length === 0;
}
