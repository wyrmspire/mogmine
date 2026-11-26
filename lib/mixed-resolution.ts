// IK-1: fill missing one-minute session stretches with real coarser Yahoo bars.
// Bars remain native observations: no synthetic minute bars are created.
import { isRegularTradingBarInterval } from "./session.ts";
import { TIMEFRAME_MINUTES } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";
import type { MarketDataProvider } from "./market-data/types.ts";

const MINUTE_MS = 60_000;
export const FILL_TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const satisfies readonly Timeframe[];

export interface MixedCandle extends Candle {
  /** Native width of this Yahoo observation. Never inferred from neighbouring timestamps. */
  minutes: number;
  /** Native Yahoo interval that supplied this observation. */
  fillFrom: Timeframe;
}

export interface ResolutionUsage {
  from: number;
  to: number;
  fillFrom: Exclude<Timeframe, "1m">;
}

export interface MixedResolutionResult {
  candles: MixedCandle[];
  baseTimeframe: Timeframe;
  complete: boolean;
  missingMinutes: number;
  usage: ResolutionUsage[];
}

const widthMs = (bar: Pick<MixedCandle, "minutes">) => bar.minutes * MINUTE_MS;

export function asMixedCandle(bar: Candle, timeframe: Timeframe): MixedCandle {
  return { ...bar, minutes: TIMEFRAME_MINUTES[timeframe], fillFrom: timeframe };
}

function valid(bar: Candle) {
  return Number.isFinite(bar.time) && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
    && bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close);
}

/** Expected minute opens in a request, excluding the regular MES/MNQ maintenance/weekend closures. */
export function expectedMinuteTimes(symbol: string, from: number, to: number) {
  const times: number[] = [];
  for (let time = Math.ceil(from / MINUTE_MS) * MINUTE_MS; time + MINUTE_MS <= to; time += MINUTE_MS) {
    if (isRegularTradingBarInterval(symbol, time, MINUTE_MS)) times.push(time);
  }
  return times;
}

function coversMinute(bar: MixedCandle, minute: number) {
  return bar.time <= minute && bar.time + widthMs(bar) >= minute + MINUTE_MS;
}

/** Which real bar supplies each expected minute, preferring the finest available resolution. */
export function minuteCoverage(candles: readonly MixedCandle[], symbol: string, from: number, to: number) {
  const ordered = [...candles].filter(valid).sort((a, b) => a.minutes - b.minutes || a.time - b.time);
  return expectedMinuteTimes(symbol, from, to).map((time) => ({
    time,
    bar: ordered.find((candidate) => coversMinute(candidate, time)) ?? null,
  }));
}

export function resolutionUsage(candles: readonly MixedCandle[], symbol: string, from: number, to: number): ResolutionUsage[] {
  const coarse = minuteCoverage(candles, symbol, from, to).filter(
    (slot): slot is { time: number; bar: MixedCandle & { fillFrom: Exclude<Timeframe, "1m"> } } =>
      slot.bar !== null && slot.bar.fillFrom !== "1m",
  );
  const usage: ResolutionUsage[] = [];
  for (const slot of coarse) {
    const previous = usage.at(-1);
    if (previous && previous.to === slot.time && previous.fillFrom === slot.bar.fillFrom) previous.to += MINUTE_MS;
    else usage.push({ from: slot.time, to: slot.time + MINUTE_MS, fillFrom: slot.bar.fillFrom });
  }
  return usage;
}

/** A mixed window is complete when every expected minute is covered by one real native bar. */
export function mixedCoverage(candles: readonly MixedCandle[], symbol: string, from: number, to: number) {
  const slots = minuteCoverage(candles, symbol, from, to);
  const missingMinutes = slots.reduce((count, slot) => count + (slot.bar ? 0 : 1), 0);
  return { expectedMinutes: slots.length, presentMinutes: slots.length - missingMinutes, missingMinutes, complete: missingMinutes === 0 };
}

function rangesForMissing(missing: readonly number[], timeframe: Timeframe) {
  const barMs = TIMEFRAME_MINUTES[timeframe] * MINUTE_MS;
  const aligned = [...new Set(missing.map((time) => Math.floor(time / barMs) * barMs))].sort((a, b) => a - b);
  const ranges: Array<{ from: number; to: number }> = [];
  for (const time of aligned) {
    const previous = ranges.at(-1);
    if (previous?.to === time) previous.to += barMs;
    else ranges.push({ from: time, to: time + barMs });
  }
  return ranges;
}

/**
 * Fetch 1m first, then ask 5m, 15m and 1h only for still-uncovered aligned stretches.
 * A coarse bar retains its true width and contributes only residual volume after all finer selected bars in its span.
 */
export async function fetchMixedResolution(
  provider: MarketDataProvider, symbol: string, from: number, to: number,
): Promise<MixedResolutionResult> {
  const selected: MixedCandle[] = [];
  const expected = expectedMinuteTimes(symbol, from, to);
  let finest: Timeframe | null = null;

  for (const timeframe of FILL_TIMEFRAMES) {
    const missing = expected.filter((time) => !selected.some((bar) => coversMinute(bar, time)));
    if (!missing.length) break;
    const ranges = timeframe === "1m" ? [{ from, to }] : rangesForMissing(missing, timeframe);
    const fetched = (await Promise.all(ranges.map(({ from: rangeFrom, to: rangeTo }) =>
      provider.getCandles({ symbol, timeframe, from: new Date(rangeFrom), to: new Date(rangeTo) }).catch(() => []),
    ))).flat();
    const unique = new Map<number, Candle>();
    for (const bar of fetched) if (valid(bar) && Number.isFinite(bar.volume) && bar.volume >= 0) unique.set(bar.time, bar);
    if (unique.size && finest === null) finest = timeframe;

    for (const raw of unique.values()) {
      const bar = asMixedCandle(raw, timeframe);
      if (!missing.some((time) => coversMinute(bar, time))) continue;
      // Yahoo aggregate volume includes the finer bars already selected in this same span.
      const counted = selected.reduce((sum, finer) => finer.time >= bar.time && finer.time + widthMs(finer) <= bar.time + widthMs(bar)
        ? sum + finer.volume : sum, 0);
      selected.push({ ...bar, volume: Math.max(0, bar.volume - counted) });
    }
  }

  selected.sort((a, b) => a.time - b.time || a.minutes - b.minutes);
  const coverage = mixedCoverage(selected, symbol, from, to);
  return {
    candles: selected,
    baseTimeframe: finest ?? "1m",
    complete: coverage.complete,
    missingMinutes: coverage.missingMinutes,
    usage: resolutionUsage(selected, symbol, from, to),
  };
}

/** Select native bars wholly inside a window and assess coverage on the one-minute market grid. */
export function readMixedWindow(
  candles: readonly MixedCandle[], symbol: string, from: number, end: number, asOf: number, reportMinutes = 1,
) {
  const to = Math.max(from, Math.min(end, asOf));
  const reportMs = reportMinutes * MINUTE_MS;
  const coverageTo = reportMinutes > 1 ? Math.floor(to / reportMs) * reportMs : to;
  const bars = candles.filter((bar) => valid(bar) && bar.time >= from && bar.time + widthMs(bar) <= coverageTo).sort(
    (a, b) => a.time + widthMs(a) - (b.time + widthMs(b)) || a.minutes - b.minutes,
  );
  const coverage = mixedCoverage(bars, symbol, from, coverageTo);
  return {
    bars,
    coverage: {
      from, to, ...coverage,
      // Compatibility names for the existing level/indicator report contract. In a mixed series a
      // "bar" here means one expected minute of coverage, not one native observation.
      expectedBars: Math.floor(coverage.expectedMinutes / reportMinutes),
      presentBars: Math.floor(coverage.presentMinutes / reportMinutes),
      complete: coverage.complete && (to < end || end % reportMs === 0),
    },
  };
}
