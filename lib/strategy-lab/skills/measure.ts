// After-entry measures (kind "measure", knownAt "after-entry", docs/design-2026-11-24/09 §9 M1–M3).
// A measure describes what happened after a trigger bar i filled at close[i]. It reads bars after i only: the
// entry bar's own range is never inside the hold (R-POST-1, docs/05). Measures are never allowed in a trigger;
// conditions.ts rejects them.
//
// Conventions for every consumer:
// - Prices are compared in integer ticks and money in integer cents. Only the final ratios are floats.
// - MFE is >= 0 and MAE is <= 0, favourable-positive, measured from the fill close[i] over the bars after i up
//   to and including the exit bar. The entry bar contributes only its fill (R-POST-2).
// - exitTime is the close of the exit bar. Intra-bar order is unknown at 1-minute resolution.
// - Within one bar, stop and target are checked before any time or flat exit. A stop and a target in the same bar
//   is "ambiguous-stop" and counts as the stop, with stop slippage.
// - "session-end" is the flat-at-time exit, or the session running out before the hold ends. "time" is max hold.
// - riskMultiple is P&L ÷ stop distance. It is a separate label from R, which is P&L ÷ the account R size.

import type {
  BarSeries, LabLevel, LevelKey, Outcome, OutcomeExitReason, ParamSpec, Skill, SkillContext, SkillMeta,
  SkillResult, SkipReason, Value,
} from "../types.ts";

const BAR_MS = 60_000;
const MAX_GAP_MS = 15 * BAR_MS;
const DAY_MINUTES = 1440;
const MAX_HOLD_MINUTES = DAY_MINUTES;

export const LEVEL_KEYS: readonly LevelKey[] = [
  "pdh", "pdl", "pdc", "onh", "onl", "rth_open", "week_high", "week_low",
  "vwap_globex", "vwap_rth", "or_high", "or_low", "or_mid",
];

export interface MeasureSpec { tickSize: number; pointValueUsd: number }

export interface Bracket {
  side: "long" | "short";
  stop: number;
  target: number;
  qty: number;
  stopSlippageTicks: number;
  marketSlippageTicks: number;
  maxHoldMinutes: number;
  /** Minutes after midnight, America/New_York. 1019 is 16:59. */
  flatMinuteEt: number;
}

type Failure = { ok: false; reason: SkipReason; detail: string };
export type BracketResult = { ok: true; outcome: Outcome } | Failure;
type EndKind = "time" | "session-end";
type Walk = { ok: true } | { ok: false; detail: string };
interface Limits { holdEnd: number; flatEnd: number }
interface Geometry { sign: 1 | -1; entryTicks: number; stopTicks: number; stopDistance: number }

const fail = (reason: SkipReason, detail: string): Failure => ({ ok: false, reason, detail });

/** Integer tick count for a price on the grid, or null when it is off the grid or not finite. */
function onGrid(price: number, tick: number): number | null {
  const ticks = price / tick;
  const rounded = Math.round(ticks);
  return Number.isFinite(ticks) && Math.abs(ticks - rounded) < 1e-6 ? rounded : null;
}

function isWhole(value: number, min: number, max = Number.POSITIVE_INFINITY): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** The entry is the trigger close, rounded to the grid. The stop must sit behind it. */
function geometry(series: BarSeries, i: number, side: "long" | "short", stop: number, tick: number): Geometry | null {
  const stopTicks = onGrid(stop, tick);
  if (stopTicks === null) return null;
  const sign = side === "long" ? 1 : -1;
  const entryTicks = Math.round(series.close[i] / tick);
  const stopDistance = sign * (entryTicks - stopTicks);
  return stopDistance > 0 ? { sign, entryTicks, stopTicks, stopDistance } : null;
}

/** Decision time is the trigger bar's close. Hold and flat deadlines are absolute times from it. */
function limitsFor(series: BarSeries, i: number, maxHoldMinutes: number, flatMinuteEt: number): Limits | null {
  if (!isWhole(maxHoldMinutes, 1, MAX_HOLD_MINUTES) || !isWhole(flatMinuteEt, 0, DAY_MINUTES - 1)) return null;
  const decision = series.time[i] + BAR_MS;
  const closeMinute = (series.etMinute[i] + 1) % DAY_MINUTES;
  let untilFlat = (flatMinuteEt - closeMinute + DAY_MINUTES) % DAY_MINUTES;
  if (untilFlat === 0) untilFlat = DAY_MINUTES;
  return { holdEnd: decision + maxHoldMinutes * BAR_MS, flatEnd: decision + untilFlat * BAR_MS };
}

/**
 * Walk the bars after i in order and call visit for each one. The walk ends at the bar that closes at or after the
 * hold or flat deadline, or at the last bar of the session. Visit returns true when the caller has decided.
 * A gap longer than 15 minutes inside the hold, or bars that are not loaded, is a coverage failure.
 * The walk never reads a bar past the one where it ends, so truncating the series at the exit gives the same result.
 */
function scanAfterEntry(
  series: BarSeries, i: number, limits: Limits, visit: (k: number, end: EndKind | null) => boolean,
): Walk {
  const session = series.sessionDate[i];
  const deadline = Math.min(limits.holdEnd, limits.flatEnd);
  const flatWins = limits.flatEnd <= limits.holdEnd;
  let previous = series.time[i];
  for (let k = i + 1; ; k += 1) {
    if (k >= series.time.length) return { ok: false, detail: "Bars after the entry are not loaded." };
    if (series.sessionDate[k] !== session) return { ok: false, detail: "The session ended before any exit." };
    const gap = series.time[k] - previous;
    if (gap > MAX_GAP_MS) return { ok: false, detail: `A ${gap / BAR_MS}-minute gap falls inside the hold.` };
    let end: EndKind | null = null;
    if (series.time[k] + BAR_MS >= deadline) end = flatWins ? "session-end" : "time";
    else if (k + 1 < series.time.length && series.sessionDate[k + 1] !== session) end = "session-end";
    if (visit(k, end) || end !== null) return { ok: true };
    previous = series.time[k];
  }
}

interface Exit { reason: OutcomeExitReason; ticks: number; bar: number }

/** Simulate one bracket trade from the trigger bar i. Pure: no I/O, no lookups outside the series. */
export function measureBracket(
  series: BarSeries, i: number, bracket: Bracket, spec: MeasureSpec, rSizeUsd: number,
): BracketResult {
  if (!Number.isInteger(i) || i < 0 || i >= series.time.length) return fail("warmup", "No decision bar.");
  const tick = spec.tickSize;
  const tickValueCents = Math.round(spec.pointValueUsd * tick * 100);
  const rSizeCents = Math.round(rSizeUsd * 100);
  if (!(tick > 0) || !(tickValueCents > 0) || !(rSizeCents > 0)) {
    return fail("bad-params", "Tick size, point value and R size must be positive.");
  }
  if (!isWhole(bracket.qty, 1) || !isWhole(bracket.stopSlippageTicks, 0) || !isWhole(bracket.marketSlippageTicks, 0)) {
    return fail("bad-params", "Quantity and slippage must be whole numbers.");
  }
  const geo = geometry(series, i, bracket.side, bracket.stop, tick);
  const targetTicks = onGrid(bracket.target, tick);
  if (!geo || targetTicks === null || geo.sign * (targetTicks - geo.entryTicks) <= 0) {
    return fail("bad-params", "Stop must sit behind the entry and target ahead of it, both on the tick grid.");
  }
  const limits = limitsFor(series, i, bracket.maxHoldMinutes, bracket.flatMinuteEt);
  if (!limits) return fail("bad-params", "Max hold or flat time is out of range.");

  const { sign, entryTicks, stopTicks, stopDistance } = geo;
  const stopExitTicks = stopTicks - sign * bracket.stopSlippageTicks;
  const state: { mfe: number; mae: number; exit: Exit | null } = { mfe: 0, mae: 0, exit: null };
  const scan = scanAfterEntry(series, i, limits, (k, end) => {
    const hi = Math.round(series.high[k] / tick);
    const lo = Math.round(series.low[k] / tick);
    state.mfe = Math.max(state.mfe, sign > 0 ? hi - entryTicks : entryTicks - lo);
    state.mae = Math.min(state.mae, sign > 0 ? lo - entryTicks : entryTicks - hi);
    const stopHit = sign > 0 ? lo <= stopTicks : hi >= stopTicks;
    const targetHit = sign > 0 ? hi >= targetTicks : lo <= targetTicks;
    if (stopHit) state.exit = { reason: targetHit ? "ambiguous-stop" : "stop", ticks: stopExitTicks, bar: k };
    else if (targetHit) state.exit = { reason: "target", ticks: targetTicks, bar: k };
    else if (end) {
      const marketTicks = Math.round(series.close[k] / tick) - sign * bracket.marketSlippageTicks;
      state.exit = { reason: end, ticks: marketTicks, bar: k };
    }
    return state.exit !== null;
  });

  const exit = state.exit;
  if (!scan.ok || exit === null) return fail("coverage", scan.ok ? "No exit was found." : scan.detail);

  const pnlTicks = sign * (exit.ticks - entryTicks);
  const pnlCents = pnlTicks * bracket.qty * tickValueCents;
  const exitTime = series.time[exit.bar] + BAR_MS;
  const minutesToExit = (exitTime - (series.time[i] + BAR_MS)) / BAR_MS;
  const excursionR = (ticks: number) => (ticks * bracket.qty * tickValueCents) / rSizeCents;
  return {
    ok: true,
    outcome: {
      exitReason: exit.reason,
      exitTime,
      pnlPoints: pnlTicks * tick,
      pnlUsd: pnlCents / 100,
      resultR: pnlCents / rSizeCents,
      riskMultiple: pnlTicks / stopDistance,
      mfePoints: state.mfe * tick,
      maePoints: state.mae * tick,
      mfeR: excursionR(state.mfe),
      maeR: excursionR(state.mae),
      minutesToExit,
      minutesToTarget: exit.reason === "target" ? minutesToExit : null,
    },
  };
}

// ---- Skill wrappers -------------------------------------------------------------------------------------------

function withDefaults(specs: readonly ParamSpec[], params: Record<string, Value>): Record<string, Value> {
  const merged: Record<string, Value> = {};
  for (const spec of specs) merged[spec.key] = params[spec.key] ?? spec.default;
  return merged;
}

function numberParam(params: Record<string, Value>, key: string): number | null {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sideParam(params: Record<string, Value>): "long" | "short" | null {
  const value = params.side;
  return value === "long" || value === "short" ? value : null;
}

const SIDE_PARAM: ParamSpec = { key: "side", type: "enum", default: "long", options: ["long", "short"], label: "Side" };
const STOP_PARAM: ParamSpec = { key: "stop", type: "number", default: 0, label: "Stop price (from the recipe)" };
const HOLD_PARAM: ParamSpec = { key: "maxHoldMinutes", type: "integer", default: 60, min: 1, max: MAX_HOLD_MINUTES, label: "Max hold (minutes)" };
const FLAT_PARAM: ParamSpec = {
  key: "flatMinuteEt", type: "integer", default: 1019, min: 0, max: DAY_MINUTES - 1,
  label: "Flat at (ET minute of day; 1019 = 16:59)",
};

const BRACKET_PARAMS: readonly ParamSpec[] = [
  SIDE_PARAM,
  STOP_PARAM,
  { key: "target", type: "number", default: 0, label: "Target price (from the recipe)" },
  { key: "qty", type: "integer", default: 1, min: 1, label: "Contracts" },
  { key: "stopSlippageTicks", type: "integer", default: 1, min: 0, label: "Stop slippage (ticks)" },
  { key: "marketSlippageTicks", type: "integer", default: 1, min: 0, label: "Market exit slippage (ticks)" },
  HOLD_PARAM,
  FLAT_PARAM,
];

function bracketFrom(params: Record<string, Value>): Bracket | null {
  const p = withDefaults(BRACKET_PARAMS, params);
  const side = sideParam(p);
  const stop = numberParam(p, "stop");
  const target = numberParam(p, "target");
  const qty = numberParam(p, "qty");
  const stopSlippageTicks = numberParam(p, "stopSlippageTicks");
  const marketSlippageTicks = numberParam(p, "marketSlippageTicks");
  const maxHoldMinutes = numberParam(p, "maxHoldMinutes");
  const flatMinuteEt = numberParam(p, "flatMinuteEt");
  if (side === null || stop === null || target === null || qty === null || stopSlippageTicks === null
    || marketSlippageTicks === null || maxHoldMinutes === null || flatMinuteEt === null) return null;
  return { side, stop, target, qty, stopSlippageTicks, marketSlippageTicks, maxHoldMinutes, flatMinuteEt };
}

function outcomeValues(o: Outcome): Record<string, Value> {
  return {
    exitReason: o.exitReason,
    exitTime: o.exitTime,
    pnlPoints: o.pnlPoints,
    pnlUsd: o.pnlUsd,
    resultR: o.resultR,
    riskMultiple: o.riskMultiple,
    mfePoints: o.mfePoints,
    maePoints: o.maePoints,
    mfeR: o.mfeR,
    maeR: o.maeR,
    minutesToExit: o.minutesToExit,
    minutesToTarget: o.minutesToTarget,
  };
}

const AFTER_ENTRY_NEEDS = { baseTimeframe: "1m", lookbackMinutes: 0, volume: false } as const;
const AFTER_ENTRY_WARNING = "After-entry measure: reads bars after the trigger only. Never use it in a trigger.";

const bracketMeta: SkillMeta = {
  id: "bracketOutcome",
  version: "1.0.0",
  kind: "measure",
  title: "Bracket outcome (M1)",
  description: "Simulates a stop, target and time or flat exit from the trigger close, walking bars after the entry bar only.",
  status: "active",
  params: BRACKET_PARAMS,
  outputs: [
    { key: "exitReason", type: "category", label: "Exit", categories: ["target", "stop", "time", "session-end", "ambiguous-stop"] },
    { key: "exitTime", type: "number", label: "Exit bar close (UTC ms)" },
    { key: "pnlPoints", type: "number", label: "P&L (points)", unit: "points" },
    { key: "pnlUsd", type: "number", label: "P&L ($ per run)", unit: "usd" },
    { key: "resultR", type: "number", label: "Result in R (account R size)", unit: "r" },
    { key: "riskMultiple", type: "number", label: "× risk (P&L ÷ stop distance; not R)", unit: "ratio" },
    { key: "mfePoints", type: "number", label: "MFE (points)", unit: "points" },
    { key: "maePoints", type: "number", label: "MAE (points)", unit: "points" },
    { key: "mfeR", type: "number", label: "MFE (R)", unit: "r" },
    { key: "maeR", type: "number", label: "MAE (R)", unit: "r" },
    { key: "minutesToExit", type: "number", label: "Minutes to exit", unit: "minutes" },
    { key: "minutesToTarget", type: "number", label: "Minutes to target", unit: "minutes" },
  ],
  needs: { ...AFTER_ENTRY_NEEDS, volume: false },
  knownAt: "after-entry",
  warnings: [AFTER_ENTRY_WARNING],
};

export const bracketOutcome: Skill = {
  meta: bracketMeta,
  preflight: (ctx) => bracketFrom(ctx.params)
    ? { ok: true }
    : { ok: false, reason: "bad-params", detail: "Bracket parameters are missing or invalid." },
  compute: (ctx: SkillContext): SkillResult => {
    const input = bracketFrom(ctx.params);
    if (!input) return { ok: false, reason: "bad-params", detail: "Bracket parameters are missing or invalid." };
    const result = measureBracket(ctx.series, ctx.i, input, ctx.spec, ctx.rSizeUsd);
    return result.ok ? { ok: true, values: outcomeValues(result.outcome) } : result;
  },
};

const reachMeta: SkillMeta = {
  id: "levelReach",
  version: "1.0.0",
  kind: "measure",
  title: "Level reached (M2)",
  description: "Whether price reached a level on the target side before the stop, within the hold.",
  status: "active",
  params: [
    SIDE_PARAM,
    STOP_PARAM,
    { key: "level", type: "enum", default: "pdh", options: LEVEL_KEYS, label: "Level" },
    HOLD_PARAM,
    FLAT_PARAM,
  ],
  outputs: [
    { key: "levelPrice", type: "number", label: "Level price" },
    { key: "levelOnTargetSide", type: "boolean", label: "Level is on the target side" },
    { key: "reached", type: "boolean", label: "Reached before the stop" },
    { key: "minutesToReach", type: "number", label: "Minutes to reach", unit: "minutes" },
  ],
  needs: { ...AFTER_ENTRY_NEEDS },
  knownAt: "after-entry",
  warnings: [AFTER_ENTRY_WARNING],
};

function isLevelKey(value: Value): value is LevelKey {
  return typeof value === "string" && (LEVEL_KEYS as readonly string[]).includes(value);
}

function levelReachCompute(ctx: SkillContext): SkillResult {
  const p = withDefaults(reachMeta.params, ctx.params);
  const side = sideParam(p);
  const stop = numberParam(p, "stop");
  const maxHold = numberParam(p, "maxHoldMinutes");
  const flat = numberParam(p, "flatMinuteEt");
  const { series, i, spec } = ctx;
  if (side === null || stop === null || maxHold === null || flat === null || !isLevelKey(p.level)) {
    return { ok: false, reason: "bad-params", detail: "Level reach parameters are missing or invalid." };
  }
  const decision = series.time[i] + BAR_MS;
  const level: LabLevel | undefined = ctx.levels.byKey.get(p.level);
  if (!level) return { ok: false, reason: "no-level", detail: `${p.level} is not in the level book.` };
  if (level.availableAt > decision) {
    return { ok: false, reason: "not-known-yet", detail: `${p.level} is not known at the decision time.` };
  }
  const geo = geometry(series, i, side, stop, spec.tickSize);
  if (!geo) return { ok: false, reason: "bad-params", detail: "Stop must sit behind the entry, on the tick grid." };
  const levelTicks = Math.round(level.value / spec.tickSize);
  if (geo.sign * (levelTicks - geo.entryTicks) <= 0) {
    return {
      ok: true,
      values: { levelPrice: level.value, levelOnTargetSide: false, reached: null, minutesToReach: null },
    };
  }
  const limits = limitsFor(series, i, maxHold, flat);
  if (!limits) return { ok: false, reason: "bad-params", detail: "Max hold or flat time is out of range." };

  const state: { reachedAt: number | null } = { reachedAt: null };
  const scan = scanAfterEntry(series, i, limits, (k) => {
    const hi = Math.round(series.high[k] / spec.tickSize);
    const lo = Math.round(series.low[k] / spec.tickSize);
    const stopHit = geo.sign > 0 ? lo <= geo.stopTicks : hi >= geo.stopTicks;
    if (stopHit) return true; // A stop and a touch in the same bar count as the stop.
    const touched = geo.sign > 0 ? hi >= levelTicks : lo <= levelTicks;
    if (touched) state.reachedAt = series.time[k] + BAR_MS;
    return touched;
  });
  if (!scan.ok && state.reachedAt === null) return { ok: false, reason: "coverage", detail: scan.detail };
  const reached = state.reachedAt !== null;
  return {
    ok: true,
    values: {
      levelPrice: level.value,
      levelOnTargetSide: true,
      reached,
      minutesToReach: state.reachedAt === null ? null : (state.reachedAt - decision) / BAR_MS,
    },
  };
}

export const levelReach: Skill = {
  meta: reachMeta,
  preflight: (ctx) => {
    const p = withDefaults(reachMeta.params, ctx.params);
    return numberParam(p, "stop") !== null && isLevelKey(p.level)
      ? { ok: true }
      : { ok: false, reason: "bad-params", detail: "Level reach parameters are missing or invalid." };
  },
  compute: levelReachCompute,
};

const forwardMeta: SkillMeta = {
  id: "forwardReturn",
  version: "1.0.0",
  kind: "measure",
  title: "Forward return (M3)",
  description: "Signed points from the trigger close to the close of the bar N minutes after it.",
  status: "active",
  params: [
    SIDE_PARAM,
    { key: "forwardMinutes", type: "integer", default: 15, min: 1, max: 240, label: "Minutes forward" },
  ],
  outputs: [
    { key: "points", type: "number", label: "Forward move (signed points)", unit: "points" },
    { key: "barOpen", type: "number", label: "Bar used (UTC ms)" },
  ],
  needs: { ...AFTER_ENTRY_NEEDS },
  knownAt: "after-entry",
  warnings: [AFTER_ENTRY_WARNING],
};

function forwardCompute(ctx: SkillContext): SkillResult {
  const p = withDefaults(forwardMeta.params, ctx.params);
  const side = sideParam(p);
  const minutes = numberParam(p, "forwardMinutes");
  if (side === null || minutes === null || !isWhole(minutes, 1, 240)) {
    return { ok: false, reason: "bad-params", detail: "Forward return parameters are missing or invalid." };
  }
  const { series, i, spec } = ctx;
  const sign = side === "long" ? 1 : -1;
  const targetOpen = series.time[i] + minutes * BAR_MS;
  // The bar opening N minutes after the trigger closes at the decision time + N. Within 2 minutes earlier is accepted.
  for (let back = 0; back <= 2; back += 1) {
    const j = series.byTime.get(targetOpen - back * BAR_MS);
    if (j !== undefined && j > i && series.sessionDate[j] === series.sessionDate[i]) {
      const ticks = Math.round(series.close[j] / spec.tickSize) - Math.round(series.close[i] / spec.tickSize);
      return { ok: true, values: { points: sign * ticks * spec.tickSize, barOpen: series.time[j] } };
    }
  }
  return { ok: true, values: { points: null, barOpen: null } };
}

export const forwardReturn: Skill = {
  meta: forwardMeta,
  preflight: (ctx) => {
    const p = withDefaults(forwardMeta.params, ctx.params);
    return sideParam(p) !== null && isWhole(numberParam(p, "forwardMinutes") ?? 0, 1, 240)
      ? { ok: true }
      : { ok: false, reason: "bad-params", detail: "Forward return parameters are missing or invalid." };
  },
  compute: forwardCompute,
};

/** The measures for the registry. Measures are never triggers. SL-8 composes them into the run registry. */
export const MEASURE_SKILLS: readonly Skill[] = [bracketOutcome, levelReach, forwardReturn];
