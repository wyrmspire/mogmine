import {
  equityIndexSessionBounds, offsetSessionDate, previousRegularSessionDate, sessionDate, sessionWeekMonday,
} from "./session.ts";
import { snapToTick, specFor, TIMEFRAME_MINUTES } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";
import { asMixedCandle, minuteCoverage, readMixedWindow, resolutionUsage } from "./mixed-resolution.ts";
import type { MixedCandle } from "./mixed-resolution.ts";

type Anchor = "globex" | "rth";

interface SettlementCandle extends Pick<Candle, "close"> {
  /** Normalize the daily candle to its settlement session date before passing it in. */
  sessionDate: string;
  availableAt: number;
}

/** Kept for stored/caller compatibility. IK-1 now requires complete mixed-resolution coverage for either value. */
export type GapPolicy = "complete" | "globex-tolerant";

export interface SessionIndicatorOptions {
  symbol: "MES" | "MNQ";
  timeframe: Timeframe;
  asOf: number;
  anchor: Anchor;
  settlement?: SettlementCandle;
  gapPolicy?: GapPolicy;
  /** Standard-deviation band multiples. Defaults to 1 and 2. */
  bandMultiples?: readonly number[];
}

const MINUTE_MS = 60_000;
const VALUE_AREA_FRACTION = 0.7;
/** VW-2: Globex VWAP tolerance. Missing expected bars must stay within this share, in one run of at most this many minutes. */
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

type Window = ReturnType<typeof readMixedWindow>;

interface VwapPoint {
  /** The candle close time in UTC milliseconds, when its OHLCV becomes usable. */
  time: number;
  value: number;
}

export interface VwapBandPoint extends VwapPoint {
  multiple: number;
  upper: number;
  lower: number;
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
      expectedMinutes: coverages.reduce((sum, coverage) => sum + coverage.expectedMinutes, 0),
      presentMinutes: coverages.reduce((sum, coverage) => sum + coverage.presentMinutes, 0),
      missingMinutes: coverages.reduce((sum, coverage) => sum + coverage.missingMinutes, 0),
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
function gapMetrics({ bars, coverage }: Window, symbol: string, rthOpen: number, rthEnd: number): GapMetrics {
  const slots = minuteCoverage(bars, symbol, coverage.from, coverage.to);
  let missingBars = 0;
  let rthMissingBars = 0;
  let run = 0;
  let longestRun = 0;
  for (const { time, bar } of slots) {
    if (bar) {
      run = 0;
      continue;
    }
    missingBars += 1;
    run += 1;
    longestRun = Math.max(longestRun, run);
    if (time >= rthOpen && time + MINUTE_MS <= rthEnd) rthMissingBars += 1;
  }
  return { missingBars, longestGapMin: longestRun, rthMissingBars };
}

function typicalPrice(bar: Candle): number {
  return (bar.high + bar.low + bar.close) / 3;
}

function sessionVwap(bars: readonly MixedCandle[], bandMultiples: readonly number[]) {
  let volume = 0;
  let value = 0;
  let m2 = 0;
  const points: VwapPoint[] = [];
  const bands = new Map(bandMultiples.map((multiple) => [multiple, [] as VwapBandPoint[]]));
  const ordered = [...bars].sort((a, b) => (a.time + a.minutes * MINUTE_MS) - (b.time + b.minutes * MINUTE_MS) || a.minutes - b.minutes);
  for (const bar of ordered) {
    if (bar.volume > 0) {
      const price = typicalPrice(bar);
      const nextVolume = volume + bar.volume;
      const delta = price - value;
      value += delta * (bar.volume / nextVolume);
      m2 += bar.volume * delta * (price - value);
      volume = nextVolume;
    }
    if (volume > 0) {
      const time = bar.time + bar.minutes * MINUTE_MS;
      const point = { time, value };
      if (points.at(-1)?.time === time) points[points.length - 1] = point;
      else points.push(point);
      const deviation = Math.sqrt(Math.max(0, m2 / volume));
      for (const [multiple, series] of bands) {
        const band = { ...point, multiple, upper: value + deviation * multiple, lower: value - deviation * multiple };
        if (series.at(-1)?.time === time) series[series.length - 1] = band;
        else series.push(band);
      }
    }
  }
  return { points, bands: [...bands.values()] };
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
  const { symbol, timeframe, asOf, anchor, settlement, bandMultiples = [1, 2] } = options;
  const spec = specFor(symbol);
  const barMs = TIMEFRAME_MINUTES[timeframe] * MINUTE_MS;
  if (!spec || !barMs || !Number.isFinite(new Date(asOf).getTime())) return null;

  const tagged = candles.every((bar) => "minutes" in bar && "fillFrom" in bar);
  const converted = candles.map((bar) => "minutes" in bar && "fillFrom" in bar
    ? bar as MixedCandle : asMixedCandle(bar, timeframe));
  const duplicateKeys = new Set(converted.flatMap((bar, index) => converted.some((other, otherIndex) => otherIndex !== index
    && other.time === bar.time && other.minutes === bar.minutes) ? [`${bar.time}:${bar.minutes}`] : []));
  const mixed = converted.filter((bar) => !duplicateKeys.has(`${bar.time}:${bar.minutes}`));
  const date = sessionDate(asOf);
  const monday = sessionWeekMonday(date);
  const priorDate = previousRegularSessionDate(date);
  const today = equityIndexSessionBounds(date);
  const prior = equityIndexSessionBounds(priorDate);
  const read = (from: number, to: number) => readMixedWindow(mixed, symbol, from, to, asOf, tagged ? 1 : TIMEFRAME_MINUTES[timeframe]);
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
    const availableAt = Math.max(...bars.map((bar) => bar.time + bar.minutes * MINUTE_MS));
    add(highKey, high.high, high.time, availableAt);
    add(lowKey, low.low, low.time, availableAt);
  };
  addExtremes(previousDay, "pdh", "pdl");
  addExtremes(overnight, "onh", "onl");
  addExtremes(week, "week_high", "week_low");
  if (settlement?.sessionDate === priorDate && Number.isFinite(settlement.availableAt) && settlement.availableAt <= asOf) {
    add("pdc", settlement.close, settlement.availableAt);
  }

  const gaps = gapMetrics(anchored, symbol, today.rthOpen, Math.min(today.rthClose, asOf));
  const volumesUsable = anchored.bars.every(({ volume }) => Number.isFinite(volume) && volume >= 0);
  const anchoredUsage = resolutionUsage(anchored.bars, symbol, anchored.coverage.from, anchored.coverage.to);
  const approximate = anchoredUsage.length > 0;
  const session = anchored.coverage.complete && volumesUsable ? sessionVwap(anchored.bars, bandMultiples) : { points: [], bands: [] };
  const weekVolumesUsable = week.bars.every(({ volume }) => Number.isFinite(volume) && volume >= 0);
  const weekly = week.coverage.complete && weekVolumesUsable ? sessionVwap(week.bars, bandMultiples) : { points: [], bands: [] };
  const vwap = session.points;
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
    calcVersion: "session-indicators-v2-mixed-bands",
    symbol, sessionDate: date, previousSessionDate: priorDate, asOf, anchor, timeframe,
    coverage: {
      anchored: { ...anchored.coverage, ...gaps, approximate, usage: anchoredUsage },
      previousDay: previousDay.coverage, overnight: overnight.coverage, week: week.coverage,
    },
    vwap, vwapBands: session.bands, weeklyVwap: weekly.points, weeklyVwapBands: weekly.bands,
    weeklyUsage: resolutionUsage(week.bars, symbol, week.coverage.from, week.coverage.to),
    levels,
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
