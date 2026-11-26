// Strategy Lab bar coverage (docs/design-2026-11-24/09 §7.7; Chris Nov 25 additive bar store).
// Pure interval math, an additive 1m bar merge, the trade-to-session mapping, and the device coverage index.
// Nothing here fetches or touches IndexedDB. The storage object is passed in, so tests need no DOM.
// Intervals are half-open [from, to) in UTC epoch milliseconds.
import { offsetSessionDate, previousRegularSessionDate, sessionDate } from "../session.ts";
import type { TradeRecord } from "../trades.ts";
import type { SourceBar } from "./types.ts";

export const COVERAGE_INDEX_KEY = "mogmine-strategy-lab-bar-coverage-v1";
export const MINUTE_MS = 60_000;
/** Trades on this symbol are the only ones that drive the bar store. */
const TRADE_SYMBOL = "MES";

/** Half-open [from, to) in UTC epoch milliseconds. */
export type CoveredRange = [number, number];
export interface BarWindow { from: number; to: number }

export interface CoverageEntry { coveredRanges: CoveredRange[]; barCount: number; updatedAt: number }
export type CoverageIndex = Record<string, Record<string, CoverageEntry>>;
/** The storage methods used here. `window.localStorage` satisfies it. */
export interface CoverageStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export interface CleanStats { droppedRows: number; outsideWindow: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);


/**
 * Keep only rows with numeric prices and times inside the window (`to` is exclusive, as Yahoo's period2).
 * Volume that is not a finite number becomes null; the series treats 0 and null alike as missing.
 */
export function cleanCandles(raw: unknown, window: BarWindow): { bars: SourceBar[]; clean: CleanStats } {
  const bars: SourceBar[] = [];
  const clean: CleanStats = { droppedRows: 0, outsideWindow: 0 };
  if (!Array.isArray(raw)) return { bars, clean };
  for (const row of raw) {
    if (!row || typeof row !== "object") { clean.droppedRows += 1; continue; }
    const r = row as Record<string, unknown>;
    if (![r.time, r.open, r.high, r.low, r.close].every(isFiniteNumber)) { clean.droppedRows += 1; continue; }
    const time = r.time as number;
    if (time < window.from || time >= window.to) { clean.outsideWindow += 1; continue; }
    bars.push({
      time,
      open: r.open as number,
      high: r.high as number,
      low: r.low as number,
      close: r.close as number,
      volume: isFiniteNumber(r.volume) ? r.volume : null,
    });
  }
  return { bars, clean };
}

/** Positive finite volume, else null. Zero is Yahoo's boundary artifact and counts as missing. */
function positiveVolume(value: unknown): number | null {
  return isFiniteNumber(value) && value > 0 ? value : null;
}

function validBar(bar: SourceBar): boolean {
  return isFiniteNumber(bar.time) && [bar.open, bar.high, bar.low, bar.close].every(isFiniteNumber);
}

/**
 * Additive merge keyed by minute `time`, sorted ascending. Existing bars are never removed.
 * On a shared minute the incoming OHLC wins, and volume keeps the incoming value only when it is positive;
 * otherwise the existing positive volume survives, so a 0 or null never overwrites real volume.
 * `window` (optional) clamps incoming bars to [from, to).
 */
export function mergeBars1m(existing: readonly SourceBar[], incoming: readonly SourceBar[], window?: BarWindow): SourceBar[] {
  const byTime = new Map<number, SourceBar>();
  for (const bar of existing) {
    if (validBar(bar)) byTime.set(bar.time, { ...bar, volume: positiveVolume(bar.volume) });
  }
  for (const bar of incoming) {
    if (!validBar(bar)) continue;
    if (window && (bar.time < window.from || bar.time >= window.to)) continue;
    const prior = byTime.get(bar.time);
    const volume = positiveVolume(bar.volume) ?? positiveVolume(prior?.volume) ?? null;
    byTime.set(bar.time, { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Sorted, non-overlapping ranges. Overlapping or touching ranges coalesce; empty or invalid ranges are dropped. */
export function mergeCoveredRanges(ranges: readonly CoveredRange[]): CoveredRange[] {
  const valid = ranges
    .filter((range) => Array.isArray(range) && isFiniteNumber(range[0]) && isFiniteNumber(range[1]) && range[1] > range[0])
    .map((range): CoveredRange => [range[0], range[1]])
    .sort((a, b) => a[0] - b[0]);
  const merged: CoveredRange[] = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

/** Sub-ranges of `target` that no covered range reaches, sorted. `[]` when `covered` already spans `target`. */
export function computeMissingRanges(target: BarWindow, covered: readonly CoveredRange[]): CoveredRange[] {
  if (!(target.to > target.from)) return [];
  const missing: CoveredRange[] = [];
  let cursor = target.from;
  for (const [from, to] of mergeCoveredRanges(covered)) {
    if (to <= cursor) continue;
    if (from >= target.to) break;
    if (from > cursor) missing.push([cursor, from]);
    cursor = Math.max(cursor, to);
    if (cursor >= target.to) break;
  }
  if (cursor < target.to) missing.push([cursor, target.to]);
  return missing;
}

/** localStorage when it is a usable object (browser), else null (SSR, tests, blocked storage). */
export function defaultCoverageStorage(): CoverageStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function sanitizeEntry(raw: unknown): CoverageEntry | null {
  if (!isRecord(raw) || !Array.isArray(raw.coveredRanges)) return null;
  const coveredRanges = mergeCoveredRanges(raw.coveredRanges as CoveredRange[]);
  const barCount = isFiniteNumber(raw.barCount) ? raw.barCount : 0;
  const updatedAt = isFiniteNumber(raw.updatedAt) ? raw.updatedAt : 0;
  return { coveredRanges, barCount, updatedAt };
}

/** The device coverage index. A missing, blocked or corrupt store reads as empty. */
export function loadCoverageIndex(storage: CoverageStorage | null | undefined = defaultCoverageStorage()): CoverageIndex {
  try {
    const raw = storage?.getItem(COVERAGE_INDEX_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const index: CoverageIndex = {};
    for (const [symbol, dates] of Object.entries(parsed)) {
      if (!isRecord(dates)) continue;
      for (const [date, entry] of Object.entries(dates)) {
        const clean = sanitizeEntry(entry);
        if (!clean) continue;
        index[symbol] ??= {};
        index[symbol][date] = clean;
      }
    }
    return index;
  } catch {
    return {};
  }
}

/** Records the session's coverage and bar count. A blocked storage is a silent no-op. Returns the stored entry. */
export function recordSessionCoverage(
  storage: CoverageStorage | null | undefined,
  symbol: string,
  date: string,
  coveredRanges: readonly CoveredRange[],
  barCount: number,
  now: number = Date.now(),
): CoverageEntry {
  const entry: CoverageEntry = { coveredRanges: mergeCoveredRanges(coveredRanges), barCount, updatedAt: now };
  const index = loadCoverageIndex(storage);
  index[symbol] ??= {};
  index[symbol][date] = entry;
  try {
    storage?.setItem(COVERAGE_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage full or blocked: the in-memory result still holds.
  }
  return entry;
}

/** Missing sub-ranges of `targetWindow` for one session, from the device index. */
export function sessionMissingRanges(index: CoverageIndex, symbol: string, date: string, targetWindow: BarWindow): CoveredRange[] {
  return computeMissingRanges(targetWindow, index[symbol]?.[date]?.coveredRanges ?? []);
}

/** The next regular session after `date` (Friday to Monday). */
function nextRegularSessionDate(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return offsetSessionDate(date, weekday === 5 ? 3 : 1);
}

/**
 * Sessions a real MES trade needs: every regular session from its entry to its exit (an open trade runs to `now`),
 * plus the prior regular session, so PDH/PDL/PDC context around the trade is captured. Deduplicated, oldest first.
 */
export function sessionsForTrade(trade: Pick<TradeRecord, "symbol" | "is_sample" | "entry_time" | "exit_time">, now: number = Date.now()): string[] {
  if (trade.is_sample || trade.symbol !== TRADE_SYMBOL) return [];
  const entry = Date.parse(trade.entry_time);
  if (!Number.isFinite(entry)) return [];
  const exitMs = trade.exit_time ? Date.parse(trade.exit_time) : now;
  const end = sessionDate(Number.isFinite(exitMs) && exitMs >= entry ? exitMs : entry);
  const start = sessionDate(entry);
  const dates = [previousRegularSessionDate(start)];
  for (let date = start; date <= end; date = nextRegularSessionDate(date)) dates.push(date);
  return [...new Set(dates)];
}
