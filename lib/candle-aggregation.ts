// Higher-timeframe candle aggregation with bucket completeness (docs/16 §4.3, MOGMINE-BLUEPRINT §3.7).
// "Volume 0 means missing": a constituent bar with no positive volume, or a bucket with missing
// constituent bars, makes the aggregate volume unavailable (0), never a silently partial sum.
import { isRegularTradingBarInterval } from "./session.ts";
import { TIMEFRAME_MINUTES } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";

export interface AggregatedCandleMeta {
  candle: Candle;
  presentBars: number;
  expectedBars: number;
  complete: boolean;
  volumeComplete: boolean;
}

export interface AggregateOptions {
  /** MES / MNQ enables regular-session expectations (closures are not expected bars). */
  symbol?: string;
  /** Spacing of the input bars in minutes. Detected from the input when omitted. */
  sourceMinutes?: number;
}

const MINUTE_MS = 60_000;

function hasValidVolume(bar: Candle) {
  return Number.isFinite(bar.volume) && bar.volume > 0;
}

/** Smallest positive open-to-open spacing between adjacent input bars, clamped to [1, minutes]. */
function detectSourceMinutes(candles: Candle[], minutes: number): number {
  if (candles.length < 2) return minutes;
  let smallest = Infinity;
  for (let i = 1; i < candles.length; i++) {
    const spacing = Math.round((candles[i].time - candles[i - 1].time) / MINUTE_MS);
    if (spacing > 0 && spacing < smallest) smallest = spacing;
  }
  if (!Number.isFinite(smallest)) return minutes;
  return Math.min(Math.max(smallest, 1), minutes);
}

function expectedBarCount(
  bucketTime: number,
  minutes: number,
  sourceMinutes: number,
  symbol: string | undefined,
): number {
  if (sourceMinutes >= minutes) return 1;
  const sourceMs = sourceMinutes * MINUTE_MS;
  if (symbol) {
    let count = 0;
    for (let time = bucketTime; time < bucketTime + minutes * MINUTE_MS; time += sourceMs) {
      if (isRegularTradingBarInterval(symbol, time, sourceMs)) count++;
    }
    return Math.max(1, count);
  }
  return Math.round(minutes / sourceMinutes);
}

function bucketMeta(
  bucketTime: number,
  bars: Candle[],
  minutes: number,
  sourceMinutes: number,
  symbol: string | undefined,
): AggregatedCandleMeta {
  const first = bars[0];
  const last = bars[bars.length - 1];
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const bar of bars) {
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
    volume += bar.volume;
  }
  const presentBars = bars.length;
  const expectedBars = expectedBarCount(bucketTime, minutes, sourceMinutes, symbol);
  const complete = presentBars >= expectedBars;
  const volumeComplete = complete && bars.every(hasValidVolume);
  return {
    candle: { time: bucketTime, open: first.open, high, low, close: last.close, volume: volumeComplete ? volume : 0 },
    presentBars,
    expectedBars,
    complete,
    volumeComplete,
  };
}

export function aggregateCandlesWithMeta(
  candles: Candle[],
  timeframe: Timeframe,
  options?: AggregateOptions,
): AggregatedCandleMeta[] {
  const minutes = TIMEFRAME_MINUTES[timeframe];
  const bucketMs = minutes * MINUTE_MS;
  const sourceMinutes = options?.sourceMinutes && options.sourceMinutes > 0
    ? options.sourceMinutes
    : detectSourceMinutes(candles, minutes);
  const buckets = new Map<number, Candle[]>();
  for (const bar of candles) {
    const time = Math.floor(bar.time / bucketMs) * bucketMs;
    const bucket = buckets.get(time);
    if (bucket) bucket.push(bar);
    else buckets.set(time, [bar]);
  }
  return [...buckets].map(([time, bars]) => bucketMeta(time, bars, minutes, sourceMinutes, options?.symbol));
}

export function aggregateCandles(candles: Candle[], timeframe: Timeframe, options?: AggregateOptions): Candle[] {
  // 1m with no options is the reference fast path: the input passes through untouched.
  if (timeframe === "1m" && !options) return candles;
  return aggregateCandlesWithMeta(candles, timeframe, options).map((meta) => meta.candle);
}
