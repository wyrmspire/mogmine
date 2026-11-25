/**
 * LevelBook for the Strategy Lab: the price levels a decision bar may see.
 * Pure: builds from an in-memory BarSeries only. Every level carries `availableAt`,
 * and `levelBookAt` returns only levels whose `availableAt` is no later than the
 * decision time of bar i (its close). Opening-range and overnight levels therefore
 * never exist before the bar that completes them.
 */
import {
  equityIndexSessionBounds, offsetSessionDate, previousRegularSessionDate, sessionWeekMonday,
} from "../session.ts";
import type { BarSeries, LabLevel, LevelBook, LevelKey } from "./types.ts";

/** Level keys in display order. `vwap_*` are supplied by SL-4b through `withLevels`. */
export const LEVEL_KEYS: readonly LevelKey[] = [
  "pdh", "pdl", "pdc", "onh", "onl", "rth_open", "week_high", "week_low",
  "vwap_globex", "vwap_rth", "or_high", "or_low", "or_mid",
];

export const LEVEL_LABELS: Readonly<Record<LevelKey, string>> = {
  pdh: "PDH", pdl: "PDL", pdc: "PDC", onh: "ONH", onl: "ONL", rth_open: "RTH open",
  week_high: "Wk high", week_low: "Wk low", vwap_globex: "Globex VWAP", vwap_rth: "RTH VWAP",
  or_high: "OR high", or_low: "OR low", or_mid: "OR mid",
};

/** D-F: extremes stay usable when ≤ 3% of a window's bars are missing and no gap exceeds 15 minutes. */
export const EXTREME_TOLERANCE = { maxMissingFraction: 0.03, maxGapMinutes: 15 } as const;
/** Opening range length. Strict: every bar must be present. */
export const OR_MINUTES = 15;

export interface WindowScan {
  expected: number;
  present: number;
  longestGap: number;
  high: number;
  low: number;
  firstIndex: number;
  lastIndex: number;
}

export interface LevelIndex {
  series: BarSeries;
  /** Highest high from the session's first bar through each bar index. */
  runningHigh: Float64Array;
  /** Lowest low from the session's first bar through each bar index. */
  runningLow: Float64Array;
  windows: Map<string, WindowScan>;
}

export interface ResolvedLevels {
  book: LevelBook;
  /** Why a level key is absent although the decision time has passed its window. */
  withheld: Partial<Record<LevelKey, string>>;
}

/** Build the per-series index once. Per-window scans are cached on first use. */
export function createLevelIndex(series: BarSeries): LevelIndex {
  const count = series.time.length;
  const runningHigh = new Float64Array(count);
  const runningLow = new Float64Array(count);
  for (let j = 0; j < count; j += 1) {
    const fresh = series.sessionStart[j] === j;
    runningHigh[j] = fresh ? series.high[j] : Math.max(runningHigh[j - 1], series.high[j]);
    runningLow[j] = fresh ? series.low[j] : Math.min(runningLow[j - 1], series.low[j]);
  }
  return { series, runningHigh, runningLow, windows: new Map() };
}

function scanWindow(index: LevelIndex, start: number, end: number): WindowScan {
  const cacheKey = `${start}:${end}`;
  const cached = index.windows.get(cacheKey);
  if (cached) return cached;

  const { series } = index;
  const step = series.barMs;
  let present = 0;
  let longestGap = 0;
  let gap = 0;
  let high = -Infinity;
  let low = Infinity;
  let firstIndex = -1;
  let lastIndex = -1;
  for (let t = start; t < end; t += step) {
    const j = series.byTime.get(t);
    if (j === undefined) {
      gap += 1;
      longestGap = Math.max(longestGap, gap);
      continue;
    }
    gap = 0;
    present += 1;
    high = Math.max(high, series.high[j]);
    low = Math.min(low, series.low[j]);
    if (firstIndex < 0) firstIndex = j;
    lastIndex = j;
  }
  const scan: WindowScan = {
    expected: Math.max(0, Math.round((end - start) / step)),
    present,
    longestGap,
    high,
    low,
    firstIndex,
    lastIndex,
  };
  index.windows.set(cacheKey, scan);
  return scan;
}

type Usable = { ok: true; approx: boolean } | { ok: false; reason: string };

function usable(scan: WindowScan): Usable {
  if (scan.present === 0) return { ok: false, reason: "no bars" };
  const missing = scan.expected - scan.present;
  if (missing === 0) return { ok: true, approx: false };
  if (missing <= scan.expected * EXTREME_TOLERANCE.maxMissingFraction
    && scan.longestGap <= EXTREME_TOLERANCE.maxGapMinutes) {
    return { ok: true, approx: true };
  }
  return {
    ok: false,
    reason: `${missing} of ${scan.expected} bars missing, longest gap ${scan.longestGap} min`,
  };
}

function makeBook(asOf: number, levels: LabLevel[]): LevelBook {
  return { asOf, levels, byKey: new Map(levels.map((level) => [level.key, level])) };
}

/** Levels and the reason each unavailable extreme was withheld, as of bar i's decision time. */
export function resolveLevelsAt(index: LevelIndex, i: number): ResolvedLevels {
  const { series } = index;
  if (!Number.isInteger(i) || i < 0 || i >= series.time.length) {
    return { book: makeBook(Number.NaN, []), withheld: {} };
  }

  const { barMs } = series;
  const decision = series.time[i] + barMs;
  const date = series.sessionDate[i];
  const today = equityIndexSessionBounds(date);
  const prior = equityIndexSessionBounds(previousRegularSessionDate(date));
  const firstRthClose = today.rthOpen + barMs;
  const levels: LabLevel[] = [];
  const withheld: Partial<Record<LevelKey, string>> = {};

  const put = (key: LevelKey, value: number, availableAt: number, approx: boolean) => {
    if (!Number.isFinite(value) || availableAt > decision) return;
    levels.push({ key, value, availableAt, label: LEVEL_LABELS[key], approx });
  };
  const hold = (keys: LevelKey[], reason: string) => {
    for (const key of keys) withheld[key] = reason;
  };
  const barEnd = (j: number) => series.time[j] + barMs;

  // Prior session: the full Globex day (18:00 two days back to 17:00 prior trading day).
  const priorDay = scanWindow(index, prior.open, prior.close);
  const priorUsable = usable(priorDay);
  if (priorUsable.ok) {
    const availableAt = barEnd(priorDay.lastIndex);
    put("pdh", priorDay.high, availableAt, priorUsable.approx);
    put("pdl", priorDay.low, availableAt, priorUsable.approx);
  } else {
    hold(["pdh", "pdl"], `prior session: ${priorUsable.reason}`);
  }

  // PDC is the last regular-hours 1m close. It is always labelled approximate.
  const priorRth = scanWindow(index, prior.rthOpen, prior.rthClose);
  if (priorRth.lastIndex >= 0) put("pdc", series.close[priorRth.lastIndex], barEnd(priorRth.lastIndex), true);
  else hold(["pdc"], "prior session has no regular-hours bars");

  // Overnight: 18:00 to 09:30. Published when the first RTH bar closes, so absent at 09:29.
  const overnight = scanWindow(index, today.open, today.rthOpen);
  const overnightUsable = usable(overnight);
  if (overnightUsable.ok) {
    put("onh", overnight.high, firstRthClose, overnightUsable.approx);
    put("onl", overnight.low, firstRthClose, overnightUsable.approx);
  } else {
    hold(["onh", "onl"], `overnight: ${overnightUsable.reason}`);
  }

  const openBar = series.byTime.get(today.rthOpen);
  if (openBar !== undefined) put("rth_open", series.open[openBar], firstRthClose, false);
  else hold(["rth_open"], "no 09:30 bar");

  // Opening range: strict, every bar of the window must be present.
  const orEnd = today.rthOpen + OR_MINUTES * barMs;
  const openingRange = scanWindow(index, today.rthOpen, orEnd);
  if (openingRange.present === openingRange.expected && openingRange.present > 0) {
    put("or_high", openingRange.high, orEnd, false);
    put("or_low", openingRange.low, orEnd, false);
    put("or_mid", (openingRange.high + openingRange.low) / 2, orEnd, false);
  } else {
    hold(["or_high", "or_low", "or_mid"], `opening range incomplete: ${openingRange.present} of ${openingRange.expected} bars`);
  }

  // Week to date: completed sessions Monday to the prior session, plus the running current session.
  let weekHigh = -Infinity;
  let weekLow = Infinity;
  let weekApprox = false;
  let weekFailure: string | null = null;
  for (let day = sessionWeekMonday(date); day < date; day = offsetSessionDate(day, 1)) {
    const bounds = equityIndexSessionBounds(day);
    const scan = scanWindow(index, bounds.open, bounds.close);
    const check = usable(scan);
    if (!check.ok) {
      weekFailure = `${day}: ${check.reason}`;
      break;
    }
    weekHigh = Math.max(weekHigh, scan.high);
    weekLow = Math.min(weekLow, scan.low);
    weekApprox = weekApprox || check.approx;
  }
  if (weekFailure === null) {
    weekHigh = Math.max(weekHigh, index.runningHigh[i]);
    weekLow = Math.min(weekLow, index.runningLow[i]);
    const expectedSoFar = Math.round((decision - today.open) / barMs);
    const presentSoFar = i - series.sessionStart[i] + 1;
    weekApprox = weekApprox || presentSoFar < expectedSoFar;
    put("week_high", weekHigh, decision, weekApprox);
    put("week_low", weekLow, decision, weekApprox);
  } else {
    hold(["week_high", "week_low"], `week incomplete (${weekFailure})`);
  }

  return { book: makeBook(decision, levels), withheld };
}

/** The LevelBook handed to a skill for bar i. Contains only levels with availableAt ≤ decision time. */
export function levelBookAt(index: LevelIndex, i: number): LevelBook {
  return resolveLevelsAt(index, i).book;
}

/** Add externally computed levels (e.g. VWAP from SL-4b). Levels not yet available at the book's time are dropped. */
export function withLevels(book: LevelBook, extra: readonly LabLevel[]): LevelBook {
  const added = extra.filter((level) => Number.isFinite(level.value) && level.availableAt <= book.asOf);
  const keep = book.levels.filter((level) => !added.some((next) => next.key === level.key));
  return makeBook(book.asOf, [...keep, ...added]);
}
