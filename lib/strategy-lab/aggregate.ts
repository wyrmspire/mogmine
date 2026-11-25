import type { AggregatedBar, BarSeries } from "./types.ts";

const ALLOWED_MINUTES = new Set([5, 15, 60]);

/** Aggregate the ET-clock bucket containing i, using only facts available through i. */
export function aggregate(series: BarSeries, i: number, minutes: number): AggregatedBar | null {
  if (!Number.isInteger(i) || i < 0 || i >= series.time.length || !ALLOWED_MINUTES.has(minutes)) return null;

  const offset = series.etMinute[i] % minutes;
  const startTime = series.time[i] - offset * series.barMs;
  const expected = offset + 1;
  const indices: number[] = [];
  for (let step = 0; step < expected; step += 1) {
    const index = series.byTime.get(startTime + step * series.barMs);
    if (index !== undefined && index <= i && series.sessionDate[index] === series.sessionDate[i]) indices.push(index);
  }
  if (indices.length === 0) return null;

  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let volumeMissing = 0;
  for (const index of indices) {
    high = Math.max(high, series.high[index]);
    low = Math.min(low, series.low[index]);
    if (Number.isNaN(series.volume[index])) volumeMissing += 1;
    else volume += series.volume[index];
  }

  return {
    minutes,
    startTime,
    endTime: startTime + minutes * series.barMs,
    open: series.open[indices[0]],
    high,
    low,
    close: series.close[indices[indices.length - 1]],
    volume: volumeMissing > 0 ? Number.NaN : volume,
    expected,
    present: indices.length,
    volumeMissing,
    forming: offset < minutes - 1,
  };
}
