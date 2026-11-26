// SL-16a: MES 1m regime and session-open skills, spec 09 §9 (batch 2):
// rangeRegime (today's range against the prior-session ADR), trendRegime (multi-session close trend),
// adrExtension (distance from the open against the ADR, with the remaining ADR) and gapOpen (RTH open
// against PDC). Pure and synchronous. Every read is at or before the decision bar i: prior sessions are
// whole sessions before i's session, and today's values stop at bar i. Volume is not used.
// Registration happens in SL-16c (registry.ts is not edited here).
import { equityIndexSessionBounds } from "../../session.ts";
import type {
  BarSeries, OutputSpec, ParamSpec, Skill, SkillContext, SkillMeta,
} from "../types.ts";
import { roundTo } from "./levels.ts";
import { intParam, ok, skip, volumeSkill } from "./volume.ts";

/** A prior session counts only with at least this share of its expected 1m bars. */
const MIN_SESSION_COVERAGE = 0.5;
/** adrExtension needs this many usable prior sessions, whatever `sessions` is set to. */
const OPEN_ADR_MIN_SESSIONS = 5;
const TREND_THRESHOLD_ADR = 0.35;
const TREND_SHARE = 0.6;
const RANGE_BUCKETS = [0.6, 1.1] as const;
const EXTENSION_BUCKETS = [0.5, 1.0] as const;
const GAP_TICK_BUCKETS = [-16, -4, 4, 16] as const;

// ---------------------------------------------------------------------------------------------
// Per-series cache: whole-session high, low and close, running high and low from each session's
// first bar, and the usable prior sessions. Built once per BarSeries. Values at index i read only
// bars at or before i; prior-session summaries are complete before today's session starts.
// ---------------------------------------------------------------------------------------------

interface SessionStat {
  date: string;
  usable: boolean;
  high: number;
  low: number;
  close: number;
}

interface RegimeCache {
  sessions: SessionStat[];
  indexByDate: Map<string, number>;
  runHigh: Float64Array;
  runLow: Float64Array;
  priorMemo: Map<string, SessionStat[]>;
}

const REGIME_CACHE = new WeakMap<BarSeries, RegimeCache>();

function regimeCache(series: BarSeries): RegimeCache {
  const cached = REGIME_CACHE.get(series);
  if (cached) return cached;
  const n = series.time.length;
  const runHigh = new Float64Array(n);
  const runLow = new Float64Array(n);
  const whole = new Map<string, { high: number; low: number; close: number }>();
  for (let j = 0; j < n; j += 1) {
    const day = series.sessionDate[j];
    const fresh = j === 0 || series.sessionDate[j - 1] !== day;
    runHigh[j] = fresh ? series.high[j] : Math.max(runHigh[j - 1], series.high[j]);
    runLow[j] = fresh ? series.low[j] : Math.min(runLow[j - 1], series.low[j]);
    // Bars are sorted and session dates never go backwards, so the last write per date is the session total.
    whole.set(day, { high: runHigh[j], low: runLow[j], close: series.close[j] });
  }
  const sessions = series.sessions.map((session): SessionStat => {
    const total = whole.get(session.date);
    const high = total?.high ?? Number.NaN;
    const low = total?.low ?? Number.NaN;
    const close = total?.close ?? Number.NaN;
    const covered = session.expectedBars > 0 && session.presentBars >= MIN_SESSION_COVERAGE * session.expectedBars;
    const usable = session.excluded === undefined && covered
      && Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close);
    return { date: session.date, usable, high, low, close };
  });
  const indexByDate = new Map(sessions.map((session, k) => [session.date, k] as const));
  const cache: RegimeCache = { sessions, indexByDate, runHigh, runLow, priorMemo: new Map() };
  REGIME_CACHE.set(series, cache);
  return cache;
}

/** The most recent `count` usable sessions strictly before `today`, oldest first. */
function priorSessions(cache: RegimeCache, today: string, count: number): SessionStat[] {
  const key = `${today}|${count}`;
  const memo = cache.priorMemo.get(key);
  if (memo) return memo;
  const at = cache.indexByDate.get(today) ?? 0;
  const out: SessionStat[] = [];
  for (let k = at - 1; k >= 0 && out.length < count; k -= 1) {
    if (cache.sessions[k].usable) out.push(cache.sessions[k]);
  }
  out.reverse();
  cache.priorMemo.set(key, out);
  return out;
}

/** Mean high–low range of the given sessions. */
function meanRange(sessions: readonly SessionStat[]): number {
  return sessions.reduce((sum, session) => sum + (session.high - session.low), 0) / sessions.length;
}

/** Today's high and low over bars [sessionStart[i] .. i], from the running extremes (never past i). */
function todayWindow(cache: RegimeCache, i: number): { high: number; low: number } {
  return { high: cache.runHigh[i], low: cache.runLow[i] };
}

// ---------------------------------------------------------------------------------------------
// rangeRegime
// ---------------------------------------------------------------------------------------------

interface RangeParams { sessions: number; minSessions: number }

const RANGE_REGIME_PARAMS: readonly ParamSpec[] = [
  { key: "sessions", type: "integer", default: 10, min: 5, max: 20, label: "ADR lookback sessions" },
  { key: "minSessions", type: "integer", default: 5, min: 3, max: 20, label: "Min prior sessions" },
];

const RANGE_REGIME_OUTPUTS: readonly OutputSpec[] = [
  { key: "todayRange", type: "number", label: "Today's range so far", unit: "points" },
  { key: "adr", type: "number", label: "ADR (mean prior session range)", unit: "points" },
  { key: "adrRatio", type: "number", label: "Today's range ÷ ADR", unit: "ratio", buckets: RANGE_BUCKETS },
  { key: "regime", type: "category", label: "Range regime", categories: ["compressed", "normal", "expanded"] },
  { key: "adrSessions", type: "number", label: "Prior sessions used" },
];

const rangeRegimeMeta: SkillMeta = {
  id: "rangeRegime",
  version: "1.0.0",
  kind: "feature",
  title: "Range regime",
  description: "Today's high–low range so far against the ADR of the prior completed sessions, bucketed as compressed (< 0.6), normal or expanded (> 1.1).",
  status: "active",
  params: RANGE_REGIME_PARAMS,
  outputs: RANGE_REGIME_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 20 * 1440, priorSessions: 20, volume: false },
  knownAt: "bar-close",
  warnings: ["Sessions with under 50% of their expected 1m bars are skipped, not interpolated."],
};

function parseRange(ctx: SkillContext): { ok: true; p: RangeParams } | { ok: false; detail: string } {
  const sessions = intParam(ctx.params, "sessions", 10, 5, 20);
  const minSessions = intParam(ctx.params, "minSessions", 5, 3, 20);
  if (sessions === null || minSessions === null) return { ok: false, detail: "sessions must be 5–20 and minSessions 3–20" };
  if (minSessions > sessions) return { ok: false, detail: "minSessions cannot exceed sessions" };
  return { ok: true, p: { sessions, minSessions } };
}

const rangeRegimeSkill: Skill = volumeSkill<RangeParams>(rangeRegimeMeta, parseRange, (ctx, p) => {
  const { series, i } = ctx;
  const cache = regimeCache(series);
  const priors = priorSessions(cache, series.sessionDate[i], p.sessions);
  if (priors.length < p.minSessions) {
    return skip("warmup", `${priors.length} valid prior sessions; need ${p.minSessions}`);
  }
  const adr = meanRange(priors);
  if (!(adr > 0)) return skip("warmup", "ADR is zero over the prior sessions");
  const window = todayWindow(cache, i);
  const todayRange = window.high - window.low;
  const ratio = todayRange / adr;
  const regime = ratio < 0.6 ? "compressed" : ratio > 1.1 ? "expanded" : "normal";
  return ok({
    todayRange: roundTo(todayRange, 6),
    adr: roundTo(adr, 6),
    adrRatio: roundTo(ratio, 6),
    regime,
    adrSessions: priors.length,
  });
});

// ---------------------------------------------------------------------------------------------
// trendRegime
// ---------------------------------------------------------------------------------------------

interface TrendParams { sessions: number; minSessions: number }

const TREND_REGIME_PARAMS: readonly ParamSpec[] = [
  { key: "sessions", type: "integer", default: 5, min: 3, max: 15, label: "Prior sessions" },
  { key: "minSessions", type: "integer", default: 3, min: 2, max: 15, label: "Min prior sessions" },
];

const TREND_REGIME_OUTPUTS: readonly OutputSpec[] = [
  { key: "regime", type: "category", label: "Multi-session trend", categories: ["trend-up", "trend-down", "balance"] },
  { key: "netChangePoints", type: "number", label: "Net close change (oldest prior close → now)", unit: "points" },
  { key: "slopePointsPerSession", type: "number", label: "Close slope (points per session)", unit: "points" },
  { key: "multiDayPosPct", type: "number", label: "Position in multi-session range", unit: "pct", buckets: [25, 75] },
];

const trendRegimeMeta: SkillMeta = {
  id: "trendRegime",
  version: "1.0.0",
  kind: "label",
  title: "Trend regime",
  description: "Multi-session trend from the prior closes and the current close: trend-up or trend-down when the net change exceeds 0.35 × the mean prior range and at least 60% of the session-to-session closes moved the same way, else balance.",
  status: "active",
  params: TREND_REGIME_PARAMS,
  outputs: TREND_REGIME_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 15 * 1440, priorSessions: 15, volume: false },
  knownAt: "bar-close",
  warnings: ["The close sequence is the prior session closes followed by the current close at bar i, so today's close is still in progress."],
};

function parseTrend(ctx: SkillContext): { ok: true; p: TrendParams } | { ok: false; detail: string } {
  const sessions = intParam(ctx.params, "sessions", 5, 3, 15);
  const minSessions = intParam(ctx.params, "minSessions", 3, 2, 15);
  if (sessions === null || minSessions === null) return { ok: false, detail: "sessions must be 3–15 and minSessions 2–15" };
  if (minSessions > sessions) return { ok: false, detail: "minSessions cannot exceed sessions" };
  return { ok: true, p: { sessions, minSessions } };
}

const trendRegimeSkill: Skill = volumeSkill<TrendParams>(trendRegimeMeta, parseTrend, (ctx, p) => {
  const { series, i } = ctx;
  const cache = regimeCache(series);
  const priors = priorSessions(cache, series.sessionDate[i], p.sessions);
  if (priors.length < p.minSessions) {
    return skip("warmup", `${priors.length} valid prior sessions; need ${p.minSessions}`);
  }
  const steps = priors.length;
  const avgRange = meanRange(priors);
  const closes = [...priors.map((session) => session.close), series.close[i]];
  const netChange = closes[steps] - closes[0];
  let rose = 0;
  let fell = 0;
  for (let k = 1; k <= steps; k += 1) {
    const move = closes[k] - closes[k - 1];
    if (move > 0) rose += 1;
    else if (move < 0) fell += 1;
  }
  const threshold = TREND_THRESHOLD_ADR * avgRange;
  const share = (count: number) => count >= TREND_SHARE * steps;
  const regime = netChange > threshold && share(rose) ? "trend-up"
    : netChange < -threshold && share(fell) ? "trend-down"
      : "balance";

  // Least-squares slope of the closes against session position (0 = oldest prior, steps = now).
  const xMean = steps / 2;
  const yMean = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k <= steps; k += 1) {
    sxy += (k - xMean) * (closes[k] - yMean);
    sxx += (k - xMean) ** 2;
  }

  const window = todayWindow(cache, i);
  const high = Math.max(window.high, ...priors.map((session) => session.high));
  const low = Math.min(window.low, ...priors.map((session) => session.low));
  if (!(high > low)) return skip("warmup", "No range across the multi-session window");
  const pos = ((series.close[i] - low) / (high - low)) * 100;

  return ok({
    regime,
    netChangePoints: roundTo(netChange, 6),
    slopePointsPerSession: roundTo(sxy / sxx, 6),
    multiDayPosPct: roundTo(pos, 6),
  });
});

// ---------------------------------------------------------------------------------------------
// adrExtension
// ---------------------------------------------------------------------------------------------

interface ExtensionParams { sessions: number; anchor: "session" | "rth" }

const ADR_EXTENSION_PARAMS: readonly ParamSpec[] = [
  { key: "sessions", type: "integer", default: 10, min: 5, max: 20, label: "ADR sessions" },
  { key: "anchor", type: "enum", default: "session", options: ["session", "rth"], label: "Open anchor" },
];

const ADR_EXTENSION_OUTPUTS: readonly OutputSpec[] = [
  { key: "fromOpenPoints", type: "number", label: "Close minus open anchor", unit: "points" },
  { key: "openExtAdr", type: "number", label: "Extension from open (× ADR)", unit: "ratio", buckets: EXTENSION_BUCKETS },
  { key: "remainingUpAdr", type: "number", label: "Remaining up (× ADR)", unit: "ratio" },
  { key: "remainingDownAdr", type: "number", label: "Remaining down (× ADR)", unit: "ratio" },
  { key: "extensionBucket", type: "category", label: "Extension vs ADR", categories: ["inside", "full", "overextended"] },
];

const adrExtensionMeta: SkillMeta = {
  id: "adrExtension",
  version: "1.0.0",
  kind: "feature",
  title: "ADR extension",
  description: "Distance from the chosen open (session or 09:30 ET RTH) in ADR units, and how much ADR is left up or down from the window's extremes. Needs 5 prior sessions. The RTH anchor is unavailable before 09:30 ET.",
  status: "active",
  params: ADR_EXTENSION_PARAMS,
  outputs: ADR_EXTENSION_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 20 * 1440, priorSessions: 20, volume: false },
  knownAt: "bar-close",
};

function parseExtension(ctx: SkillContext): { ok: true; p: ExtensionParams } | { ok: false; detail: string } {
  const sessions = intParam(ctx.params, "sessions", 10, 5, 20);
  const anchor = ctx.params.anchor ?? "session";
  if (sessions === null) return { ok: false, detail: "sessions must be 5–20" };
  if (anchor !== "session" && anchor !== "rth") return { ok: false, detail: `Unknown open anchor: ${String(anchor)}` };
  return { ok: true, p: { sessions, anchor } };
}

const adrExtensionSkill: Skill = volumeSkill<ExtensionParams>(adrExtensionMeta, parseExtension, (ctx, p) => {
  const { series, i } = ctx;
  const cache = regimeCache(series);
  const today = series.sessionDate[i];
  const rthOpenMs = equityIndexSessionBounds(today).rthOpen;
  if (p.anchor === "rth" && series.time[i] + series.barMs < rthOpenMs) {
    return skip("not-known-yet", "Before 09:30 ET RTH open");
  }
  const priors = priorSessions(cache, today, p.sessions);
  if (priors.length < OPEN_ADR_MIN_SESSIONS) {
    return skip("warmup", `${priors.length} valid prior sessions; need ${OPEN_ADR_MIN_SESSIONS}`);
  }
  const adr = meanRange(priors);
  if (!(adr > 0)) return skip("warmup", "ADR is zero over the prior sessions");

  let anchorIndex = series.sessionStart[i];
  let high = cache.runHigh[i];
  let low = cache.runLow[i];
  if (p.anchor === "rth") {
    const j = series.byTime.get(rthOpenMs);
    if (j === undefined || j > i) return skip("coverage", "No 09:30 ET bar at or before the decision");
    anchorIndex = j;
    high = -Infinity;
    low = Infinity;
    for (let k = j; k <= i; k += 1) {
      high = Math.max(high, series.high[k]);
      low = Math.min(low, series.low[k]);
    }
  }
  const anchorOpen = series.open[anchorIndex];
  const close = series.close[i];
  const fromOpen = close - anchorOpen;
  const openExt = Math.abs(fromOpen) / adr;
  const remainingUp = Math.max(0, (low + adr - close) / adr);
  const remainingDown = Math.max(0, (close - (high - adr)) / adr);
  const bucket = openExt < 0.5 ? "inside" : openExt <= 1 ? "full" : "overextended";
  return ok({
    fromOpenPoints: roundTo(fromOpen, 6),
    openExtAdr: roundTo(openExt, 6),
    remainingUpAdr: roundTo(remainingUp, 6),
    remainingDownAdr: roundTo(remainingDown, 6),
    extensionBucket: bucket,
  });
});

// ---------------------------------------------------------------------------------------------
// gapOpen
// ---------------------------------------------------------------------------------------------

interface GapParams { toleranceTicks: number; flatTicks: number }

const GAP_OPEN_PARAMS: readonly ParamSpec[] = [
  { key: "toleranceTicks", type: "integer", default: 2, min: 0, max: 12, label: "Fill tolerance (ticks)" },
  { key: "flatTicks", type: "integer", default: 4, min: 1, max: 20, label: "Flat-open band (ticks)" },
];

const GAP_OPEN_OUTPUTS: readonly OutputSpec[] = [
  { key: "gapPoints", type: "number", label: "RTH open minus PDC≈", unit: "points" },
  { key: "gapTicks", type: "number", label: "RTH open minus PDC≈ (ticks)", unit: "ticks", buckets: GAP_TICK_BUCKETS },
  { key: "direction", type: "category", label: "Open vs PDC≈", categories: ["gap-up", "gap-down", "flat"] },
  { key: "filled", type: "boolean", label: "Gap filled by RTH bar at or before now" },
];

const gapOpenMeta: SkillMeta = {
  id: "gapOpen",
  version: "1.0.0",
  kind: "feature",
  title: "Gap at open",
  description: "The 09:30 ET RTH open against the prior close (PDC≈): gap size in points and ticks, gap-up, gap-down or flat, and whether an RTH bar since the open has traded back through PDC within the tolerance. Available from the 09:30 bar's close (09:31 ET).",
  status: "active",
  params: GAP_OPEN_PARAMS,
  outputs: GAP_OPEN_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 390, volume: false },
  knownAt: "bar-close",
  warnings: ["PDC is the approximate prior RTH close (≈), taken from the level book."],
};

function parseGap(ctx: SkillContext): { ok: true; p: GapParams } | { ok: false; detail: string } {
  const toleranceTicks = intParam(ctx.params, "toleranceTicks", 2, 0, 12);
  const flatTicks = intParam(ctx.params, "flatTicks", 4, 1, 20);
  if (toleranceTicks === null || flatTicks === null) return { ok: false, detail: "toleranceTicks must be 0–12 and flatTicks 1–20" };
  if (!(ctx.spec.tickSize > 0)) return { ok: false, detail: "Tick size must be positive" };
  return { ok: true, p: { toleranceTicks, flatTicks } };
}

const gapOpenSkill: Skill = volumeSkill<GapParams>(gapOpenMeta, parseGap, (ctx, p) => {
  const { series, i, spec } = ctx;
  const today = series.sessionDate[i];
  const bounds = equityIndexSessionBounds(today);
  if (series.time[i] + series.barMs < bounds.rthOpen + series.barMs) {
    return skip("not-known-yet", "Before the 09:30 ET bar closes at 09:31 ET");
  }
  const pdc = ctx.levels.byKey.get("pdc");
  if (!pdc) return skip("no-level", "PDC is not available at this decision");

  const rthLevel = ctx.levels.byKey.get("rth_open");
  let rthOpen: number;
  if (rthLevel) {
    rthOpen = rthLevel.value;
  } else {
    const j = series.byTime.get(bounds.rthOpen);
    if (j === undefined || j > i) return skip("coverage", "No 09:30 ET bar at or before the decision");
    rthOpen = series.open[j];
  }

  const gapPoints = rthOpen - pdc.value;
  const gapTicks = Math.round(gapPoints / spec.tickSize);
  const direction = Math.abs(gapTicks) <= p.flatTicks ? "flat" : gapTicks > 0 ? "gap-up" : "gap-down";

  // Filled when any RTH bar from 09:30 through bar i reaches back through PDC within the tolerance.
  const tolerance = p.toleranceTicks * spec.tickSize;
  let filled = direction === "flat";
  for (let k = i; !filled && k >= series.sessionStart[i] && series.time[k] >= bounds.rthOpen; k -= 1) {
    if (series.low[k] <= pdc.value + tolerance && series.high[k] >= pdc.value - tolerance) filled = true;
  }

  return ok({
    gapPoints: roundTo(gapPoints, 6),
    gapTicks,
    direction,
    filled,
  });
});

export const REGIME_SKILLS: readonly Skill[] = [rangeRegimeSkill, trendRegimeSkill, adrExtensionSkill, gapOpenSkill];

export { rangeRegimeSkill, trendRegimeSkill, adrExtensionSkill, gapOpenSkill };
