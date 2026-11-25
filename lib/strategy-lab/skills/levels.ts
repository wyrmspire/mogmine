/**
 * Level skills: S5 `levelMap` (distances to levels and nearest targets) and
 * S6 `structureStop` (stop beyond the recent extreme, sized from the fixed account R).
 * Pure and synchronous. Both read only the decision bar and earlier, and levels
 * arrive pre-filtered by availableAt through ctx.levels.
 */
import { LEVEL_KEYS, LEVEL_LABELS } from "../levels.ts";
import type {
  LevelKey, OutputSpec, ParamSpec, Skill, SkillContext, SkillMeta, SkillPreflight, SkillResult, Value,
} from "../types.ts";

const LEVEL_OPTIONS: readonly string[] = ["", ...LEVEL_KEYS];

export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function numberParam(params: Record<string, Value>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function integerParam(params: Record<string, Value>, key: string, fallback: number): number {
  return Math.trunc(numberParam(params, key, fallback));
}

function stringParam(params: Record<string, Value>, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" ? value : fallback;
}

function badParams(detail: string): SkipOutcome {
  return { ok: false, reason: "bad-params", detail };
}

type SkipOutcome = Extract<SkillResult, { ok: false }>;

function checkRSize(ctx: SkillContext): SkipOutcome | null {
  return Number.isFinite(ctx.rSizeUsd) && ctx.rSizeUsd > 0 ? null : badParams("Account R size must be positive");
}

const LEVEL_MAP_PARAMS: readonly ParamSpec[] = [
  { key: "level", type: "enum", default: "", options: LEVEL_OPTIONS, label: "Level (blank = list all)" },
  { key: "toleranceTicks", type: "integer", default: 2, min: 0, max: 20, label: "Touch tolerance (ticks)" },
];

const LEVEL_MAP_OUTPUTS: readonly OutputSpec[] = [
  { key: "closeDistTicks", type: "number", label: "Distance from level (ticks, signed)", unit: "ticks" },
  { key: "touch", type: "boolean", label: "Bar range touched level ± tolerance" },
  { key: "distPoints", type: "number", label: "Distance (points, signed)", unit: "points" },
  { key: "distUsd", type: "number", label: "Distance per contract", unit: "usd" },
  { key: "distR", type: "number", label: "Distance per contract (R)", unit: "r" },
  { key: "nearestAboveKey", type: "category", label: "Nearest level above", categories: ["none", ...LEVEL_KEYS] },
  { key: "nearestAboveTicks", type: "number", label: "Nearest level above (ticks)", unit: "ticks" },
  { key: "nearestBelowKey", type: "category", label: "Nearest level below", categories: ["none", ...LEVEL_KEYS] },
  { key: "nearestBelowTicks", type: "number", label: "Nearest level below (ticks)", unit: "ticks" },
];

const levelMapMeta: SkillMeta = {
  id: "levelMap",
  version: "1.0.0",
  kind: "feature",
  title: "Level map",
  description: "Distance from the reference price to one level (ticks, $ per contract, R), or the nearest levels above and below when no level is chosen. The reference is the mark on a Context Card, otherwise the decision close.",
  status: "active",
  params: LEVEL_MAP_PARAMS,
  outputs: LEVEL_MAP_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 0, priorSessions: 4, volume: false },
  knownAt: "bar-close",
};

function levelMapPreflight(ctx: SkillContext): SkillPreflight {
  const rSize = checkRSize(ctx);
  if (rSize) return rSize;
  const key = stringParam(ctx.params, "level", "");
  if (!LEVEL_OPTIONS.includes(key)) return badParams(`Unknown level: ${key}`);
  const tolerance = numberParam(ctx.params, "toleranceTicks", 2);
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 20) {
    return badParams("toleranceTicks must be an integer from 0 to 20");
  }
  if (key && !ctx.levels.byKey.has(key as LevelKey)) {
    return { ok: false, reason: "no-level", detail: `${LEVEL_LABELS[key as LevelKey]} is not available at this time` };
  }
  if (!key && ctx.levels.levels.length === 0) return { ok: false, reason: "no-level", detail: "No levels are available at this time" };
  return { ok: true };
}

function levelMapCompute(ctx: SkillContext): SkillResult {
  const { series, i, params, spec, rSizeUsd, levels, mark } = ctx;
  const tick = spec.tickSize;
  const reference = mark?.price ?? series.close[i];
  const key = stringParam(params, "level", "");
  const nothing = {
    closeDistTicks: null, touch: null, distPoints: null, distUsd: null, distR: null,
    nearestAboveKey: null, nearestAboveTicks: null, nearestBelowKey: null, nearestBelowTicks: null,
  } satisfies Record<string, Value>;

  if (key) {
    const level = levels.byKey.get(key as LevelKey);
    if (!level) return { ok: false, reason: "no-level", detail: `${key} is not available at this time` };
    const tolerance = integerParam(params, "toleranceTicks", 2) * tick;
    const distance = reference - level.value;
    const distPoints = roundTo(distance, 6);
    const distUsd = roundTo(distPoints * spec.pointValueUsd, 6);
    return {
      ok: true,
      values: {
        ...nothing,
        closeDistTicks: Math.round(distance / tick),
        touch: series.high[i] >= level.value - tolerance && series.low[i] <= level.value + tolerance,
        distPoints,
        distUsd,
        distR: roundTo(distUsd / rSizeUsd, 6),
      },
    };
  }

  const ranked = levels.levels
    .map((level) => ({
      key: level.key,
      label: LEVEL_LABELS[level.key],
      ticks: Math.round((level.value - reference) / tick),
      above: level.value >= reference,
    }))
    .sort((a, b) => a.ticks - b.ticks);
  const above = ranked.filter((row) => row.above);
  const below = ranked.filter((row) => !row.above).reverse();
  const nearestAbove = above[0];
  const nearestBelow = below[0];
  return {
    ok: true,
    values: {
      ...nothing,
      nearestAboveKey: nearestAbove?.key ?? "none",
      nearestAboveTicks: nearestAbove?.ticks ?? null,
      nearestBelowKey: nearestBelow?.key ?? "none",
      nearestBelowTicks: nearestBelow?.ticks ?? null,
    },
    notes: ranked.map((row) => `${row.label} ${row.ticks > 0 ? "+" : ""}${row.ticks} ticks`),
  };
}

export const levelMap: Skill = {
  meta: levelMapMeta,
  preflight: levelMapPreflight,
  compute: levelMapCompute,
};

const STRUCTURE_STOP_PARAMS: readonly ParamSpec[] = [
  { key: "side", type: "enum", default: "long", options: ["long", "short"], label: "Side (Context Card uses the mark's side)" },
  { key: "ticks", type: "integer", default: 2, min: 0, max: 20, label: "Ticks beyond the extreme" },
  { key: "lookbackBars", type: "integer", default: 15, min: 1, max: 120, label: "Lookback (1m bars, ending at the decision bar)" },
  { key: "riskR", type: "number", default: 0.25, min: 0.01, max: 5, label: "Risk per trade (R)" },
];

const STRUCTURE_STOP_OUTPUTS: readonly OutputSpec[] = [
  { key: "stopPrice", type: "number", label: "Stop price" },
  { key: "stopPoints", type: "number", label: "Stop distance", unit: "points" },
  { key: "stopTicks", type: "number", label: "Stop distance (ticks)", unit: "ticks" },
  { key: "stopUsdPerContract", type: "number", label: "Stop risk per contract", unit: "usd" },
  { key: "qtyAtRiskR", type: "number", label: "Contracts at the risk target", unit: "contracts" },
  { key: "riskR", type: "number", label: "Actual risk at that quantity (R)", unit: "r" },
  { key: "oversized", type: "boolean", label: "One contract already exceeds the risk target" },
  ...LEVEL_KEYS.map((key): OutputSpec => ({
    key: `rrTo.${key}`,
    type: "number",
    label: `Reward to ${LEVEL_LABELS[key]} (R:R)`,
    unit: "ratio",
  })),
];

const structureStopMeta: SkillMeta = {
  id: "structureStop",
  version: "1.0.0",
  kind: "feature",
  title: "Structure stop",
  description: "Stop beyond the lowest low (long) or highest high (short) of the last lookback bars, sized from the fixed account R. Quantity never comes from the stop width.",
  status: "active",
  params: STRUCTURE_STOP_PARAMS,
  outputs: STRUCTURE_STOP_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 120, volume: false },
  knownAt: "bar-close",
};

function structureStopPreflight(ctx: SkillContext): SkillPreflight {
  const rSize = checkRSize(ctx);
  if (rSize) return rSize;
  const side = stringParam(ctx.params, "side", "long");
  if (side !== "long" && side !== "short") return badParams(`Unknown side: ${side}`);
  const lookback = numberParam(ctx.params, "lookbackBars", 15);
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > 120) return badParams("lookbackBars must be an integer from 1 to 120");
  const ticks = numberParam(ctx.params, "ticks", 2);
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > 20) return badParams("ticks must be an integer from 0 to 20");
  const riskR = numberParam(ctx.params, "riskR", 0.25);
  if (!(riskR >= 0.01 && riskR <= 5)) return badParams("riskR must be between 0.01 and 5");
  return { ok: true };
}

function structureStopCompute(ctx: SkillContext): SkillResult {
  const { series, i, params, spec, rSizeUsd, levels, mark } = ctx;
  const tick = spec.tickSize;
  const side = mark?.side ?? stringParam(params, "side", "long");
  const isLong = side === "long";
  const entry = mark?.price ?? series.close[i];
  const lookback = integerParam(params, "lookbackBars", 15);
  const ticks = integerParam(params, "ticks", 2);
  const riskTarget = numberParam(params, "riskR", 0.25);

  // Bars inside the lookback window, walking back from the decision bar.
  const windowStart = series.time[i] - (lookback - 1) * series.barMs;
  let extreme = isLong ? Infinity : -Infinity;
  let used = 0;
  for (let j = i; j >= 0 && series.time[j] >= windowStart; j -= 1) {
    used += 1;
    extreme = isLong ? Math.min(extreme, series.low[j]) : Math.max(extreme, series.high[j]);
  }

  const stopPrice = roundTo(isLong ? extreme - ticks * tick : extreme + ticks * tick, 6);
  const stopTicks = Math.round((isLong ? entry - stopPrice : stopPrice - entry) / tick);
  if (stopTicks <= 0) return badParams("Stop is not beyond the entry");
  const stopPoints = roundTo(stopTicks * tick, 6);
  const stopUsd = roundTo(stopPoints * spec.pointValueUsd, 6);

  // Quantity: whole contracts that keep risk within riskR × fixed account R. Never below one.
  const budget = riskTarget * rSizeUsd;
  const fitted = Math.floor(budget / stopUsd + 1e-9);
  const qty = Math.max(1, fitted);
  const riskUsd = roundTo(qty * stopUsd, 6);

  const rrTo: Record<string, Value> = {};
  for (const key of LEVEL_KEYS) {
    const level = levels.byKey.get(key);
    const onTarget = level !== undefined && (isLong ? level.value > entry : level.value < entry);
    rrTo[`rrTo.${key}`] = onTarget && level ? roundTo(Math.abs(level.value - entry) / stopPoints, 2) : null;
  }

  const notes = used < lookback ? [`${used} of ${lookback} lookback bars present`] : undefined;
  return {
    ok: true,
    values: {
      stopPrice,
      stopPoints,
      stopTicks,
      stopUsdPerContract: stopUsd,
      qtyAtRiskR: qty,
      riskR: roundTo(riskUsd / rSizeUsd, 6),
      oversized: fitted < 1,
      ...rrTo,
    },
    ...(notes ? { notes } : {}),
  };
}

export const structureStop: Skill = {
  meta: structureStopMeta,
  preflight: structureStopPreflight,
  compute: structureStopCompute,
};
