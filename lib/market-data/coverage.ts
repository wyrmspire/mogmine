// Coverage test for a candle payload (issue #90, AC-07). Used by the market-data route to pick an
// attempt and by the client cache, so a cached set and a fresh set are judged the same way.
// Client-safe: no Node-only imports.
import { TIMEFRAME_MINUTES, expectedInsideBarTimes } from "../trades.ts";
import type { Candle, Timeframe } from "../trades.ts";

/**
 * True when the payload has every bar needed to chart the trade window at this timeframe:
 * the bar that holds the entry fill, the bar that holds the exit fill, and every bar that is
 * entirely inside the hold (from the shared `expectedInsideBarTimes`).
 *
 * Count is not coverage: four bars that miss the window fail, and so does a set with a gap.
 * Bar times are open times in UTC milliseconds, the same unit as `Candle.time`.
 */
export function coversTradeWindow(candles: Candle[], entryMs: number, exitMs: number, timeframe: Timeframe): boolean {
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs) || exitMs <= entryMs) return false;
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  const present = new Set(candles.map((bar) => bar.time));
  const required = new Set<number>([
    Math.floor(entryMs / barMs) * barMs,
    Math.floor(exitMs / barMs) * barMs,
    ...expectedInsideBarTimes(entryMs, exitMs, barMs),
  ]);
  for (const time of required) {
    if (!present.has(time)) return false;
  }
  return true;
}
