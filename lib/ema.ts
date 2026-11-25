// IN-3: the 200 EMA on the displayed timeframe (docs/design-2026-11-24/03 §6, decision D-G / OD-18). Pure and deterministic:
// the same bars always give the same points, so the chart and GET /api/v1/levels agree (Guardrail 11).
// Input: closes of the displayed timeframe. 1m bars are aggregated into the displayed timeframe when it is coarser.
// Seed: simple mean of the first 200 closes. Points are drawn only from the 700th bar on (200 + 500 warm-up),
// where the seed's weight is (199/201)^500 ≈ 0.67%. Missing bars are never synthesized.
import { TIMEFRAME_MINUTES, aggregateCandles } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";
import { equityIndexSessionBounds, sessionDate } from "./session.ts";

export const EMA_CALC_VERSION = "ema200-v1";
export const EMA_PERIOD = 200;
export const EMA_WARMUP_EXTRA = 500;
export const EMA_MIN_BARS = EMA_PERIOD + EMA_WARMUP_EXTRA; // 700
/** Warm-up gaps above this share of expected in-session bars make the line approximate (dashed, "≈"). */
export const EMA_MAX_MISSING_RATIO = 0.03;
const ALPHA = 2 / (EMA_PERIOD + 1);

export interface EmaPoint {
  /** Bar open time, UTC milliseconds (the same convention as VwapPoint and Candle). */
  time: number;
  value: number;
}

export interface Ema200Result {
  calcVersion: typeof EMA_CALC_VERSION;
  timeframe: Timeframe;
  points: EmaPoint[];
  /** True when the warm-up window misses more than EMA_MAX_MISSING_RATIO of the expected in-session bars. */
  approximate: boolean;
  /** Missing in-session bars over expected in-session bars, across the warm-up window. 0 when nothing is missing. */
  missingRatio: number;
  /** Bars the calculation used (after dedupe and aggregation to the displayed timeframe). */
  presentBars: number;
  unavailableReason: string | null;
}

/** A result with no points and the reason why. Callers use it when they cannot even load the bars (for example, 1m older than 30 days). */
export function emaUnavailable(timeframe: Timeframe, reason: string): Ema200Result {
  return { calcVersion: EMA_CALC_VERSION, timeframe, points: [], approximate: false, missingRatio: 0, presentBars: 0, unavailableReason: reason };
}

function dedupeSorted(bars: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const bar of bars) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** The smallest gap between consecutive bars. Gaps only make it larger, so it reads the native bar size. */
function nativeSpacingMs(bars: readonly Candle[]): number | null {
  let smallest: number | null = null;
  for (let i = 1; i < bars.length; i += 1) {
    const gap = bars[i].time - bars[i - 1].time;
    if (gap > 0 && (smallest === null || gap < smallest)) smallest = gap;
  }
  return smallest;
}

/** Whether a slot opening at `time` lies inside a regular MES/MNQ session (the Globex calendar, OD-35). */
function inSession(time: number) {
  const bounds = equityIndexSessionBounds(sessionDate(time));
  return time >= bounds.open && time < bounds.close;
}

/** Expected in-session slots from `fromMs` through `toMs`, stepping by one bar. */
function expectedSlots(fromMs: number, toMs: number, barMs: number) {
  let count = 0;
  for (let time = fromMs; time <= toMs; time += barMs) if (inSession(time)) count += 1;
  return count;
}

/**
 * The 200 EMA of `bars` on `timeframe`. `bars` may be 1m (aggregated here) or already at `timeframe`.
 * Points carry the bar open time; the first point is the 700th bar.
 */
export function computeEma200(bars: readonly Candle[], timeframe: Timeframe): Ema200Result {
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  const sorted = dedupeSorted(bars);
  const native = nativeSpacingMs(sorted);
  if (native !== null && native > barMs) {
    return emaUnavailable(timeframe, `Needs ${timeframe} bars, but only ${native / 60_000}-minute bars are loaded`);
  }
  const series = aggregateCandles(sorted, timeframe);
  if (series.length < EMA_MIN_BARS) {
    return emaUnavailable(timeframe, `Needs ${EMA_MIN_BARS} ${timeframe} bars for warm-up (${series.length} available)`);
  }

  let ema = 0;
  for (let i = 0; i < EMA_PERIOD; i += 1) ema += series[i].close;
  ema /= EMA_PERIOD;
  const points: EmaPoint[] = [];
  for (let i = EMA_PERIOD; i < series.length; i += 1) {
    ema = series[i].close * ALPHA + ema * (1 - ALPHA);
    if (i >= EMA_MIN_BARS - 1) points.push({ time: series[i].time, value: ema });
  }

  // Warm-up coverage: the first 700 bars span [series[0], series[699]]. Missing in-session slots widen that span.
  const warmupEnd = series[EMA_MIN_BARS - 1].time;
  const expected = Math.max(EMA_MIN_BARS, expectedSlots(series[0].time, warmupEnd, barMs));
  const missingRatio = (expected - EMA_MIN_BARS) / expected;
  return {
    calcVersion: EMA_CALC_VERSION,
    timeframe,
    points,
    approximate: missingRatio > EMA_MAX_MISSING_RATIO,
    missingRatio,
    presentBars: series.length,
    unavailableReason: null,
  };
}

/** The EMA points that fall on the displayed bars, so the chart never widens its time scale. */
export function emaOnBars(points: readonly EmaPoint[], bars: readonly Pick<Candle, "time">[]): EmaPoint[] {
  const byTime = new Map(points.map((point) => [point.time, point.value]));
  const line: EmaPoint[] = [];
  for (const bar of bars) {
    const value = byTime.get(bar.time);
    if (value !== undefined) line.push({ time: bar.time, value });
  }
  return line;
}

/** The View menu's note beside "200 EMA": the reason it is missing, "≈" when the warm-up has gaps, or nothing. */
export function ema200Status(result: Ema200Result | null): string {
  if (!result) return "";
  if (result.unavailableReason) return ` · ${result.unavailableReason}`;
  return result.approximate ? " · ≈ gaps in warm-up" : "";
}
