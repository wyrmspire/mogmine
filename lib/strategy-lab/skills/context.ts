/**
 * Context skills (SL-4b, spec §9): S7 `contextRanges` (overnight, yesterday, week-to-date and PDC position),
 * S8 `openingRange` (opening-range levels, width bucket, relation and failed breaks) and
 * S9 `vwapRelation` (side, reclaim or loss, and slope against the incremental session VWAP).
 * Pure and synchronous. Each reads bars at or before i; the decision time is the bar's close.
 */
import { equityIndexSessionBounds, previousRegularSessionDate, sessionWeekMonday } from "../../session.ts";
import { vwapAt, type VwapAnchor } from "../vwap.ts";
import type {
  BarSeries, OutputSpec, ParamSpec, Skill, SkillContext, SkillMeta, SkillPreflight, SkillResult, Value,
} from "../types.ts";
import { intParam, ok, skip } from "./volume.ts";
import { roundTo } from "./levels.ts";

const OR_WIDTH_HISTORY = 20;
const OR_MIN_TERCILE_SAMPLE = 6;
const RTH_BARS = 390;

function sideOf(ticks: number): "above" | "below" | "at" {
  return Math.abs(ticks) <= 2 ? "at" : ticks > 0 ? "above" : "below";
}

// Per-series caches: running values over bars at or before each index, built once per BarSeries.

interface RthSummary { high: number; low: number; open: number; close: number; complete: boolean }

interface RangeCache {
  /** Overnight (session open to 09:30 ET), running over bars at or before j. NaN before the first overnight bar. */
  ovHigh: Float64Array;
  ovLow: Float64Array;
  ovOpen: Float64Array;
  ovClose: Float64Array;
  ovCount: Int32Array;
  /** Week to date from the Monday session's open, running over bars at or before j. */
  weekHigh: Float64Array;
  weekLow: Float64Array;
  rth: Map<string, RthSummary>;
}

const RANGE_CACHE = new WeakMap<BarSeries, RangeCache>();

function buildRangeCache(series: BarSeries): RangeCache {
  const n = series.time.length;
  const nan = () => new Float64Array(n).fill(Number.NaN);
  const cache: RangeCache = {
    ovHigh: nan(), ovLow: nan(), ovOpen: nan(), ovClose: nan(), ovCount: new Int32Array(n),
    weekHigh: new Float64Array(n), weekLow: new Float64Array(n), rth: new Map(),
  };
  let rthOpen = Number.NaN;
  let weekKey = "";
  let ovHigh = -Infinity;
  let ovLow = Infinity;
  let ovOpen = Number.NaN;
  let ovClose = Number.NaN;
  let ovCount = 0;
  let wkHigh = -Infinity;
  let wkLow = Infinity;
  for (let j = 0; j < n; j += 1) {
    if (series.sessionStart[j] === j) {
      const date = series.sessionDate[j];
      rthOpen = equityIndexSessionBounds(date).rthOpen;
      ovHigh = -Infinity;
      ovLow = Infinity;
      ovOpen = Number.NaN;
      ovClose = Number.NaN;
      ovCount = 0;
      const week = sessionWeekMonday(date);
      if (week !== weekKey) {
        weekKey = week;
        wkHigh = -Infinity;
        wkLow = Infinity;
      }
    }
    if (series.time[j] < rthOpen) {
      ovHigh = Math.max(ovHigh, series.high[j]);
      ovLow = Math.min(ovLow, series.low[j]);
      if (ovCount === 0) ovOpen = series.open[j];
      ovClose = series.close[j];
      ovCount += 1;
    }
    wkHigh = Math.max(wkHigh, series.high[j]);
    wkLow = Math.min(wkLow, series.low[j]);
    cache.ovCount[j] = ovCount;
    cache.ovHigh[j] = ovCount > 0 ? ovHigh : Number.NaN;
    cache.ovLow[j] = ovCount > 0 ? ovLow : Number.NaN;
    cache.ovOpen[j] = ovOpen;
    cache.ovClose[j] = ovClose;
    cache.weekHigh[j] = wkHigh;
    cache.weekLow[j] = wkLow;
  }
  return cache;
}

function rangeCache(series: BarSeries): RangeCache {
  let cache = RANGE_CACHE.get(series);
  if (!cache) {
    cache = buildRangeCache(series);
    RANGE_CACHE.set(series, cache);
  }
  return cache;
}

/** Full regular session summary (09:30 to 15:59 bars). Complete only when all 390 bars are present. */
function rthSummary(series: BarSeries, date: string): RthSummary {
  const cache = rangeCache(series);
  const cached = cache.rth.get(date);
  if (cached) return cached;
  const bounds = equityIndexSessionBounds(date);
  let count = 0;
  let high = -Infinity;
  let low = Infinity;
  let open = Number.NaN;
  let close = Number.NaN;
  for (let t = bounds.rthOpen; t + series.barMs <= bounds.rthClose; t += series.barMs) {
    const j = series.byTime.get(t);
    if (j === undefined) continue;
    if (count === 0) open = series.open[j];
    count += 1;
    high = Math.max(high, series.high[j]);
    low = Math.min(low, series.low[j]);
    close = series.close[j];
  }
  const summary: RthSummary = { high, low, open, close, complete: count === RTH_BARS };
  cache.rth.set(date, summary);
  return summary;
}

// ---------------------------------------------------------------------------------------------
// S7 contextRanges
// ---------------------------------------------------------------------------------------------

const CONTEXT_OUTPUTS: readonly OutputSpec[] = [
  { key: "overnightHigh", type: "number", label: "Overnight high (running)", unit: "points" },
  { key: "overnightLow", type: "number", label: "Overnight low (running)", unit: "points" },
  { key: "overnightRange", type: "number", label: "Overnight range", unit: "points" },
  { key: "overnightPosPct", type: "number", label: "Position in overnight range (0 = low, 100 = high)", unit: "pct" },
  { key: "overnightTrend", type: "category", label: "Overnight trend", categories: ["up", "down", "flat"] },
  { key: "yesterdayRange", type: "number", label: "Prior session RTH range", unit: "points" },
  { key: "yesterdayDirection", type: "category", label: "Prior session RTH direction", categories: ["up", "down", "flat"] },
  { key: "weekHigh", type: "number", label: "Week high (to decision)", unit: "points" },
  { key: "weekLow", type: "number", label: "Week low (to decision)", unit: "points" },
  { key: "weekPosPct", type: "number", label: "Position in week range (0 = low, 100 = high)", unit: "pct" },
  { key: "pdcDistPoints", type: "number", label: "Distance from PDC (points)", unit: "points" },
  { key: "pdcSide", type: "category", label: "Side of PDC", categories: ["above", "below", "at"] },
];

const contextRangesMeta: SkillMeta = {
  id: "contextRanges",
  version: "1.0.0",
  kind: "feature",
  title: "Context ranges",
  description: "Overnight range and trend, prior RTH range and direction, week-to-date range, and the position of the reference price in each. The reference is the mark on a Context Card, otherwise the decision close. Week-to-date starts at the Monday session.",
  status: "active",
  params: [],
  outputs: CONTEXT_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 7 * 1440, priorSessions: 1, volume: false },
  knownAt: "bar-close",
};

function contextRangesCompute(ctx: SkillContext): SkillResult {
  const { series, i, spec, levels, mark } = ctx;
  const cache = rangeCache(series);
  const ref = mark?.price ?? series.close[i];
  const date = series.sessionDate[i];
  const values: Record<string, Value> = Object.fromEntries(CONTEXT_OUTPUTS.map(({ key }) => [key, null]));
  const notes: string[] = [];

  if (cache.ovCount[i] > 0) {
    const high = cache.ovHigh[i];
    const low = cache.ovLow[i];
    const range = high - low;
    const drift = cache.ovClose[i] - cache.ovOpen[i];
    values.overnightHigh = high;
    values.overnightLow = low;
    values.overnightRange = roundTo(range, 6);
    values.overnightPosPct = range > 0 ? roundTo(((ref - low) / range) * 100, 4) : null;
    // Flat when |close − open| is under a quarter of the overnight range, or the range is zero.
    values.overnightTrend = range === 0 || Math.abs(drift) < range * 0.25 ? "flat" : drift > 0 ? "up" : "down";
  } else {
    notes.push("No overnight bars at or before this decision");
  }

  const prior = rthSummary(series, previousRegularSessionDate(date));
  if (prior.complete) {
    values.yesterdayRange = roundTo(prior.high - prior.low, 6);
    const drift = prior.close - prior.open;
    values.yesterdayDirection = Math.abs(drift) < Math.abs(prior.open) * 0.001 ? "flat" : drift > 0 ? "up" : "down";
  } else {
    notes.push("Prior regular session incomplete");
  }

  const weekHigh = cache.weekHigh[i];
  const weekLow = cache.weekLow[i];
  values.weekHigh = weekHigh;
  values.weekLow = weekLow;
  values.weekPosPct = weekHigh > weekLow ? roundTo(((ref - weekLow) / (weekHigh - weekLow)) * 100, 4) : null;

  const pdc = levels.byKey.get("pdc");
  if (pdc) {
    const distance = ref - pdc.value;
    values.pdcDistPoints = roundTo(distance, 6);
    values.pdcSide = sideOf(Math.round(distance / spec.tickSize));
  } else notes.push("PDC is not available at this decision");

  return ok(values, notes);
}

export const contextRanges: Skill = {
  meta: contextRangesMeta,
  preflight(): SkillPreflight {
    return { ok: true };
  },
  compute: contextRangesCompute,
};

// ---------------------------------------------------------------------------------------------
// S8 openingRange
// ---------------------------------------------------------------------------------------------

const OR_PARAMS: readonly ParamSpec[] = [
  { key: "minutes", type: "integer", default: 15, min: 5, max: 60, label: "Opening range (minutes)" },
  { key: "failBars", type: "integer", default: 5, min: 1, max: 30, label: "Failed break window (bars)" },
];

const OR_OUTPUTS: readonly OutputSpec[] = [
  { key: "orHigh", type: "number", label: "Opening range high", unit: "points" },
  { key: "orLow", type: "number", label: "Opening range low", unit: "points" },
  { key: "orMid", type: "number", label: "Opening range mid", unit: "points" },
  { key: "orWidthPoints", type: "number", label: "Opening range width", unit: "points" },
  { key: "widthBucket", type: "category", label: "Width vs prior 20 sessions", categories: ["narrow", "medium", "wide"] },
  { key: "relation", type: "category", label: "Price vs opening range", categories: ["inside", "above", "below"] },
  { key: "failedBreakUp", type: "boolean", label: "Failed break above the range" },
  { key: "failedBreakDown", type: "boolean", label: "Failed break below the range" },
];

const openingRangeMeta: SkillMeta = {
  id: "openingRange",
  version: "1.0.0",
  kind: "feature",
  title: "Opening range",
  description: "The opening range high, low and mid for the session, its width against the prior 20 sessions, where the price sits against it, and whether a close outside it failed back inside within the last few bars. Unavailable until the range has closed.",
  status: "active",
  params: OR_PARAMS,
  outputs: OR_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 30 * 1440, priorSessions: OR_WIDTH_HISTORY, volume: false },
  knownAt: "bar-close",
};

interface OpeningRangeParams { minutes: number; failBars: number }

function openingRangeParams(ctx: SkillContext): OpeningRangeParams | null {
  const minutes = intParam(ctx.params, "minutes", 15, 5, 60);
  const failBars = intParam(ctx.params, "failBars", 5, 1, 30);
  return minutes === null || failBars === null ? null : { minutes, failBars };
}

/** High, low and bar count over the opening range of a session date. */
function openingWindow(series: BarSeries, date: string, minutes: number) {
  const rthOpen = equityIndexSessionBounds(date).rthOpen;
  let high = -Infinity;
  let low = Infinity;
  let count = 0;
  for (let t = rthOpen; t < rthOpen + minutes * series.barMs; t += series.barMs) {
    const j = series.byTime.get(t);
    if (j === undefined) continue;
    count += 1;
    high = Math.max(high, series.high[j]);
    low = Math.min(low, series.low[j]);
  }
  return { high, low, count, rthOpen };
}

/** Width bucket from the terciles of up to 20 prior complete opening ranges. Null with fewer than 6. */
function widthBucketOf(series: BarSeries, date: string, minutes: number, width: number): { bucket: string | null; sample: number } {
  const widths: number[] = [];
  let day = date;
  for (let k = 0; k < OR_WIDTH_HISTORY; k += 1) {
    day = previousRegularSessionDate(day);
    const prior = openingWindow(series, day, minutes);
    if (prior.count === minutes) widths.push(prior.high - prior.low);
  }
  if (widths.length < OR_MIN_TERCILE_SAMPLE) return { bucket: null, sample: widths.length };
  const sorted = [...widths].sort((x, y) => x - y);
  const n = sorted.length;
  const lowEdge = sorted[Math.ceil(n / 3) - 1];
  const highEdge = sorted[Math.ceil((2 * n) / 3) - 1];
  return { bucket: width <= lowEdge ? "narrow" : width > highEdge ? "wide" : "medium", sample: n };
}

function openingRangeCompute(ctx: SkillContext): SkillResult {
  const { series, i, mark } = ctx;
  const parsed = openingRangeParams(ctx);
  if (!parsed) return skip("bad-params", "minutes must be 5–60 and failBars 1–30");
  const { minutes, failBars } = parsed;
  const date = series.sessionDate[i];
  const { barMs } = series;
  const today = openingWindow(series, date, minutes);
  const orEnd = today.rthOpen + minutes * barMs;
  if (series.time[i] + barMs < orEnd) return skip("not-known-yet", "The opening range has not closed yet");
  if (today.count !== minutes) return skip("coverage", `Opening range has ${today.count} of ${minutes} bars`);

  const orHigh = today.high;
  const orLow = today.low;
  const close = mark?.price ?? series.close[i];
  const relation = close > orHigh ? "above" : close < orLow ? "below" : "inside";

  // A failed break: a close outside the range within the last failBars bars, and this close back inside.
  const windowStart = series.time[i] - failBars * barMs;
  let closedAbove = false, closedBelow = false;
  for (let k = i - 1; k >= 0 && series.time[k] >= windowStart; k -= 1) {
    if (series.time[k] < orEnd) break;
    if (series.close[k] > orHigh) closedAbove = true;
    if (series.close[k] < orLow) closedBelow = true;
  }
  const failedBreakUp = closedAbove && series.close[i] < orHigh;
  const failedBreakDown = closedBelow && series.close[i] > orLow;
  const width = orHigh - orLow;
  const history = widthBucketOf(series, date, minutes, width);
  const notes = history.bucket === null ? [`Width bucket needs ${OR_MIN_TERCILE_SAMPLE} prior ranges; ${history.sample} found`] : [];

  return ok({
    orHigh,
    orLow,
    orMid: roundTo((orHigh + orLow) / 2, 6),
    orWidthPoints: roundTo(width, 6),
    widthBucket: history.bucket,
    relation,
    failedBreakUp,
    failedBreakDown,
  }, notes);
}

function openingRangePreflight(ctx: SkillContext): SkillPreflight {
  return openingRangeParams(ctx)
    ? { ok: true }
    : { ok: false, reason: "bad-params", detail: "minutes must be 5–60 and failBars 1–30" };
}

export const openingRange: Skill = {
  meta: openingRangeMeta,
  preflight: openingRangePreflight,
  compute: openingRangeCompute,
};

// ---------------------------------------------------------------------------------------------
// S9 vwapRelation
// ---------------------------------------------------------------------------------------------

const VWAP_SIDES = ["above-far", "above", "at", "below", "below-far"] as const;

const VWAP_PARAMS: readonly ParamSpec[] = [
  { key: "anchor", type: "enum", default: "rth", options: ["rth", "globex"], label: "Session anchor" },
  { key: "farTicks", type: "integer", default: 12, min: 1, max: 200, label: "Far from VWAP (ticks)" },
];

const VWAP_OUTPUTS: readonly OutputSpec[] = [
  { key: "vwap", type: "number", label: "Session VWAP", unit: "points" },
  { key: "distTicks", type: "number", label: "Distance from VWAP (ticks, signed)", unit: "ticks" },
  { key: "side", type: "category", label: "Side of VWAP", categories: [...VWAP_SIDES] },
  { key: "event", type: "category", label: "VWAP event this bar", categories: ["reclaim", "loss", "none"] },
  { key: "slope5", type: "number", label: "VWAP slope over 5 minutes (points per minute)", unit: "points" },
];

const vwapRelationMeta: SkillMeta = {
  id: "vwapRelation",
  version: "1.0.0",
  kind: "label",
  title: "VWAP relation",
  description: "Where the reference price sits against the session VWAP (RTH or Globex, same formula and gap policy as the session indicators), whether this close reclaimed or lost VWAP, and VWAP's slope over 5 minutes. Zero-volume bars do not move VWAP.",
  status: "active",
  params: VWAP_PARAMS,
  outputs: VWAP_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 1440, priorSessions: 0, volume: true },
  knownAt: "bar-close",
  warnings: ["Volume 0 is missing, not zero activity. Missing volume adds nothing to VWAP."],
};

function vwapParams(ctx: SkillContext): { anchor: VwapAnchor; farTicks: number } | null {
  const anchor = ctx.params.anchor ?? "rth";
  const farTicks = intParam(ctx.params, "farTicks", 12, 1, 200);
  if ((anchor !== "rth" && anchor !== "globex") || farTicks === null) return null;
  return { anchor, farTicks };
}

function vwapRelationPreflight(ctx: SkillContext): SkillPreflight {
  return vwapParams(ctx)
    ? { ok: true }
    : { ok: false, reason: "bad-params", detail: "anchor must be rth or globex, farTicks 1–200" };
}

function vwapSide(ticks: number, far: number): (typeof VWAP_SIDES)[number] {
  if (ticks >= far) return "above-far";
  if (ticks <= -far) return "below-far";
  return ticks > 2 ? "above" : ticks < -2 ? "below" : "at";
}

function vwapRelationCompute(ctx: SkillContext): SkillResult {
  const { series, i, spec, mark } = ctx;
  const parsed = vwapParams(ctx);
  if (!parsed) return skip("bad-params", "anchor must be rth or globex, farTicks 1–200");
  const { anchor, farTicks } = parsed;
  const { barMs } = series;
  const asOf = series.time[i] + barMs;
  const reading = vwapAt(series, anchor, asOf);
  if (reading.value === null || reading.sessionDate === null) {
    const reason = reading.withheld === "no-volume" ? "volume-missing" : "coverage";
    return skip(reason, `VWAP withheld: ${reading.withheld ?? "unknown"}`);
  }
  const vwap = reading.value;
  const close = mark?.price ?? series.close[i];
  const distTicks = Math.round((close - vwap) / spec.tickSize);
  const side = vwapSide(distTicks, farTicks);

  // Reclaim or loss: the previous bar's close on one side of its VWAP, this close on the other.
  let event: "reclaim" | "loss" | "none" = "none";
  const prevJ = series.byTime.get(series.time[i] - barMs);
  if (prevJ !== undefined) {
    const prev = vwapAt(series, anchor, series.time[prevJ] + barMs);
    if (prev.value !== null && prev.sessionDate === reading.sessionDate) {
      const prevClose = series.close[prevJ];
      const closeNow = series.close[i];
      if (prevClose < prev.value && closeNow > vwap) event = "reclaim";
      else if (prevClose > prev.value && closeNow < vwap) event = "loss";
    }
  }

  // Slope over 5 minutes, in points per minute, from VWAP readings in the same session.
  let slope5: number | null = null;
  const ago = vwapAt(series, anchor, asOf - 5 * barMs);
  if (ago.value !== null && ago.sessionDate === reading.sessionDate) {
    slope5 = roundTo((vwap - ago.value) / 5, 6);
  }

  return ok({
    vwap: roundTo(vwap, 6),
    distTicks,
    side,
    event,
    slope5,
  });
}

export const vwapRelation: Skill = {
  meta: vwapRelationMeta,
  preflight: vwapRelationPreflight,
  compute: vwapRelationCompute,
};

/** Context skills in this package. Registry wiring belongs to the integrator. */
export const CONTEXT_SKILLS: readonly Skill[] = [contextRanges, openingRange, vwapRelation];
