import {
  equityIndexSessionBounds, indexSessionCandles, offsetSessionDate, previousRegularSessionDate,
  readSessionWindow, sessionDate, sessionWeekMonday,
} from "./session.ts";
import { snapToTick, specFor, TIMEFRAME_MINUTES } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";

type Anchor = "globex" | "rth";

interface SettlementCandle extends Pick<Candle, "close"> {
  /** Normalize the daily candle to its settlement session date before passing it in. */
  sessionDate: string;
  availableAt: number;
}

/**
 * `complete` (default) draws VWAP only over a complete anchored window. `globex-tolerant` also draws Globex
 * VWAP over the bars that exist when the overnight gaps are small (VW-2, D-F). Levels stay strict either way.
 */
export type GapPolicy = "complete" | "globex-tolerant";

export interface SessionIndicatorOptions {
  symbol: "MES" | "MNQ";
  timeframe: Timeframe;
  asOf: number;
  anchor: Anchor;
  settlement?: SettlementCandle;
  gapPolicy?: GapPolicy;
}

const MINUTE_MS = 60_000;
const VALUE_AREA_FRACTION = 0.7;
/** VW-2: Globex VWAP tolerance. Missing expected bars must stay within this share, in one run of at most this many minutes. */
const GLOBEX_MAX_MISSING_SHARE = 0.03;
const GLOBEX_MAX_GAP_MIN = 15;
const LABELS = {
  pdh: "PDH", pdl: "PDL", pdc: "PDC", onh: "ONH", onl: "ONL",
  week_high: "Wk high", week_low: "Wk low", poc: "POC", vah: "VAH", val: "VAL",
} as const;
type LevelKey = keyof typeof LABELS;

interface Level {
  key: LevelKey;
  label: (typeof LABELS)[LevelKey];
  price: number;
  priceTicks: number;
  /** Open of the candle that set an extreme, or the timestamp of a non-extreme calculation. */
  formedAt: number;
  /** Close of the last candle needed to confirm the level, or the settlement's availability. */
  availableAt: number;
}

type Window = ReturnType<typeof readSessionWindow>;

interface VwapPoint {
  /** The candle close time in UTC milliseconds, when its OHLCV becomes usable. */
  time: number;
  value: number;
}

function mergeWindows(windows: readonly Window[]): Window {
  const coverages = windows.map(({ coverage }) => coverage);
  return {
    bars: windows.flatMap(({ bars }) => bars),
    coverage: {
      from: coverages[0].from,
      to: coverages[coverages.length - 1].to,
      expectedBars: coverages.reduce((sum, coverage) => sum + coverage.expectedBars, 0),
      presentBars: coverages.reduce((sum, coverage) => sum + coverage.presentBars, 0),
      complete: coverages.every((coverage) => coverage.complete),
    },
  };
}

interface GapMetrics {
  missingBars: number;
  longestGapMin: number;
  /** Missing expected bars that open at or after the RTH open and end by the RTH close or the cutoff. */
  rthMissingBars: number;
}

/** Walks the expected grid, so a bar that is present but malformed counts as missing. */
function gapMetrics({ bars, coverage }: Window, barMs: number, rthOpen: number, rthEnd: number): GapMetrics {
  const present = new Set(bars.map(({ time }) => time));
  const first = Math.ceil(coverage.from / barMs) * barMs;
  let missingBars = 0;
  let rthMissingBars = 0;
  let run = 0;
  let longestRun = 0;
  for (let i = 0; i < coverage.expectedBars; i += 1) {
    const time = first + i * barMs;
    if (present.has(time)) {
      run = 0;
      continue;
    }
    missingBars += 1;
    run += 1;
    longestRun = Math.max(longestRun, run);
    if (time >= rthOpen && time + barMs <= rthEnd) rthMissingBars += 1;
  }
  return { missingBars, longestGapMin: longestRun * barMs / MINUTE_MS, rthMissingBars };
}

function typicalPrice(bar: Candle): number {
  return (bar.high + bar.low + bar.close) / 3;
}

function sessionVwap(bars: readonly Candle[], barMs: number): VwapPoint[] {
  let volume = 0;
  let value = 0;
  const points: VwapPoint[] = [];
  for (const bar of bars) {
    if (bar.volume > 0) {
      volume += bar.volume;
      value += (typicalPrice(bar) - value) * (bar.volume / volume);
    }
    if (volume > 0) points.push({ time: bar.time + barMs, value });
  }
  return points;
}

/** OHLCV estimate using a single HLC3 tick per bar and an outward expansion from POC. */
function volumeProfile(bars: readonly Candle[], tickSize: number) {
  const byTick = new Map<number, number>();
  let total = 0;
  for (const bar of bars) {
    if (bar.volume === 0) continue;
    const tick = Math.round(typicalPrice(bar) / tickSize);
    byTick.set(tick, (byTick.get(tick) ?? 0) + bar.volume);
    total += bar.volume;
  }
  if (total === 0) return null;

  const rows = [...byTick].sort(([a], [b]) => a - b);
  const poc = rows.reduce((peak, [, volume], i) => volume > rows[peak][1] ? i : peak, 0);
  let low = poc;
  let high = poc;
  let included = rows[poc][1];
  const target = total * VALUE_AREA_FRACTION;
  while (included < target && (low > 0 || high < rows.length - 1)) {
    if ((rows[low - 1]?.[1] ?? -1) >= (rows[high + 1]?.[1] ?? -1)) included += rows[--low][1];
    else included += rows[++high][1];
  }
  return { poc: rows[poc][0] * tickSize, val: rows[low][0] * tickSize, vah: rows[high][0] * tickSize };
}

/**
 * One point-in-time calculation over native candles from a single MES or MNQ series.
 * The regular weekday calendar withholds values when holiday or early-close bars are absent.
 */
export function computeSessionIndicators(candles: readonly Candle[], options: SessionIndicatorOptions) {
  const { symbol, timeframe, asOf, anchor, settlement, gapPolicy = "complete" } = options;
  const spec = specFor(symbol);
  const barMs = TIMEFRAME_MINUTES[timeframe] * MINUTE_MS;
  if (!spec || !barMs || !Number.isFinite(new Date(asOf).getTime())) return null;

  const index = indexSessionCandles(candles);
  const date = sessionDate(asOf);
  const monday = sessionWeekMonday(date);
  const priorDate = previousRegularSessionDate(date);
  const today = equityIndexSessionBounds(date);
  const prior = equityIndexSessionBounds(priorDate);
  const read = (from: number, to: number) => readSessionWindow(index, from, to, asOf, barMs);
  const previousDay = read(prior.open, prior.close);
  const overnight = read(today.open, today.rthOpen);
  const anchored = anchor === "rth" ? read(today.rthOpen, today.rthClose) : read(today.open, today.close);
  const weekWindows: Window[] = [];
  for (let day = monday; day <= date; day = offsetSessionDate(day, 1)) {
    const bounds = day === date ? today : equityIndexSessionBounds(day);
    weekWindows.push(read(bounds.open, bounds.close));
  }
  const week = mergeWindows(weekWindows);

  const levels: Level[] = [];
  const add = (key: LevelKey, value: number, formedAt: number, availableAt = formedAt) => {
    const price = snapToTick(value, symbol);
    if (price !== null) levels.push({ key, label: LABELS[key], price, priceTicks: Math.round(price / spec.tickSize), formedAt, availableAt });
  };
  const addExtremes = ({ bars, coverage }: Window, highKey: LevelKey, lowKey: LevelKey) => {
    if (!coverage.complete || !bars.length) return;
    const high = bars.reduce((max, bar) => bar.high > max.high ? bar : max);
    const low = bars.reduce((min, bar) => bar.low < min.low ? bar : min);
    const availableAt = bars[bars.length - 1].time + barMs;
    add(highKey, high.high, high.time, availableAt);
    add(lowKey, low.low, low.time, availableAt);
  };
  addExtremes(previousDay, "pdh", "pdl");
  addExtremes(overnight, "onh", "onl");
  addExtremes(week, "week_high", "week_low");
  if (settlement?.sessionDate === priorDate && Number.isFinite(settlement.availableAt) && settlement.availableAt <= asOf) {
    add("pdc", settlement.close, settlement.availableAt);
  }

  const gaps = gapMetrics(anchored, barMs, today.rthOpen, Math.min(today.rthClose, asOf));
  const volumesUsable = anchored.bars.every(({ volume }) => Number.isFinite(volume) && volume >= 0);
  // VW-2: Globex VWAP may use a window with small overnight gaps. Levels never do.
  const tolerated = anchor === "globex" && gapPolicy === "globex-tolerant" && anchored.coverage.expectedBars > 0
    && gaps.missingBars / anchored.coverage.expectedBars <= GLOBEX_MAX_MISSING_SHARE
    && gaps.longestGapMin <= GLOBEX_MAX_GAP_MIN && gaps.rthMissingBars === 0;
  const approximate = tolerated && gaps.missingBars > 0;
  const vwap = (anchored.coverage.complete || tolerated) && volumesUsable ? sessionVwap(anchored.bars, barMs) : [];
  const strictUsable = anchored.coverage.complete && volumesUsable;
  const profile = strictUsable ? volumeProfile(anchored.bars, spec.tickSize) : null;
  const lastBar = anchored.bars.at(-1);
  if (profile && lastBar) {
    const formedAt = lastBar.time + barMs;
    add("poc", profile.poc, formedAt);
    add("vah", profile.vah, formedAt);
    add("val", profile.val, formedAt);
  }

  return {
    calcVersion: "session-indicators-v1",
    symbol, sessionDate: date, previousSessionDate: priorDate, asOf, anchor, timeframe,
    coverage: {
      anchored: { ...anchored.coverage, ...gaps, approximate },
      previousDay: previousDay.coverage, overnight: overnight.coverage, week: week.coverage,
    },
    vwap, levels,
  };
}

/** Signed distance from VWAP. Positive values are above VWAP. */
export function vwapDistance(price: number, vwap: number | null) {
  if (vwap === null || !Number.isFinite(price) || !Number.isFinite(vwap)) return null;
  const points = price - vwap;
  return { points, percent: vwap === 0 ? null : points / Math.abs(vwap) * 100 };
}

/** Endpoint slope over the requested number of bar intervals, in points per minute. */
export function vwapSlope(points: readonly VwapPoint[], lookbackBars: number) {
  if (!Number.isInteger(lookbackBars) || lookbackBars < 1 || lookbackBars >= points.length) return null;
  const first = points[points.length - 1 - lookbackBars];
  const last = points[points.length - 1];
  const minutes = (last.time - first.time) / MINUTE_MS;
  const change = last.value - first.value;
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(change)) return null;
  return { pointsPerMinute: change / minutes, direction: change > 0 ? "up" : change < 0 ? "down" : "flat" } as const;
}

type PriceLevel<Key extends string> = { key: Key; hidden?: boolean }
  & ({ price: number } | { price_low: number; price_high: number });

/** Signed points to each level's nearest edge. A hit on a level or inside a range is zero. */
export function pricePosition<Key extends string>(price: number, levels: readonly PriceLevel<Key>[]) {
  if (!Number.isFinite(price)) return null;
  type Distance = { key: Key; points: number };
  const distances: Distance[] = [];
  let nearestAbove: Distance | null = null;
  let nearestBelow: Distance | null = null;
  for (const level of levels) {
    if (level.hidden) continue;
    const low = "price" in level ? level.price : level.price_low;
    const high = "price" in level ? level.price : level.price_high;
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) continue;
    const points = price < low ? low - price : price > high ? high - price : 0;
    const distance = { key: level.key, points };
    distances.push(distance);
    if (points > 0 && (nearestAbove === null || points < nearestAbove.points)) nearestAbove = distance;
    if (points < 0 && (nearestBelow === null || points > nearestBelow.points)) nearestBelow = distance;
  }
  return { nearestAbove, nearestBelow, distances };
}
