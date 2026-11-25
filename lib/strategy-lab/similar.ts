// Find similar: a Context Card's mark becomes an editable recipe (docs/design-2026-11-24/09 §10.4, SL-8).
// Deterministic. Same mark and same bars give the same recipe. The trader can drop or change any condition after.
// The readings come from the same skills the Card shows (S1–S9, V1–V5), evaluated at the mark's decision bar.

import { createLevelIndex, levelBookAt, LEVEL_LABELS, type LevelIndex } from "./levels.ts";
import { featureKey } from "./attribution.ts";
import { formatEtMinute, validateRecipe } from "./recipe.ts";
import { SKILLS, type SkillRegistry } from "./registry.ts";
import { decisionMinute, phaseOf } from "./skills/clock.ts";
import { MES_SPEC, readSkill } from "./runner.ts";
import type {
  BarSeries, Condition, LevelKey, Recipe, SkillContext, SkillOutputRef, Value,
} from "./types.ts";

const BAR_MS = 60_000;
const MAX_TRIGGER_CONDITIONS = 4;
const NEAR_LEVEL_TICKS = 8;
const EXTREME_POS_PCT = 15;
const RVOL_MIN = 1.3;
const WICK_MIN_PCTILE = 70;
const RR_MULTIPLE = 2;
const MIN_MAX_POINTS = 4;
const MAX_SLICES = 12;
const RECLAIM_LOOKBACK = 15;

/** A Context Card mark. `time` is the mark minute as UTC ms (HH:MM:00 ET), `price` is tick-snapped. */
export interface SimilarMark { time: number; price: number; side: "long" | "short" }

export interface SimilarOptions {
  rSizeUsd: number;
  playbookId?: string | null;
  registry?: SkillRegistry;
  /** Reuse an index built once per series (the Card builds one per load). */
  levelIndex?: LevelIndex;
}

export type SimilarResult =
  | { ok: true; recipe: Recipe; reasons: string[]; readings: Record<string, Value> }
  | { ok: false; reason: string };

const ref = (skill: string, out: string, params?: Record<string, Value>): SkillOutputRef =>
  params ? { skill, params, out } : { skill, out };

/** Every slice a Find-similar recipe carries, in priority order. Volume first (§7.4), then context. */
function sliceCandidates(side: "long" | "short"): SkillOutputRef[] {
  return [
    ref("rvol", "rvolBucket", { windowMinutes: 5, sessions: 10 }),
    ref("volumeSpike", "spike"),
    ref("deltaProxy", "sign"),
    ref("entryVolume", "entryVsMedianBucket", { k: 5 }),
    ref("mtfCandle", side === "long" ? "lowerWickPctile" : "upperWickPctile", { minutes: 15 }),
    ref("structure5m", "structure"),
    ref("contextRanges", "weekPosPct"),
    ref("contextRanges", "pdcSide"),
    ref("contextRanges", "overnightTrend"),
    ref("contextRanges", "yesterdayDirection"),
    ref("openingRange", "widthBucket", { minutes: 15 }),
    ref("sessionClock", "todBucket"),
    ref("vwapRelation", "side", { anchor: "rth" }),
  ];
}

/** Clock window: the mark's 30-minute ET bucket ±60 min, clipped to the mark's session phase. */
export function similarWindow(decision: number): { startEt: string; endEt: string } | null {
  const phase = phaseOf(decision);
  if (phase === null) return null;
  const bucket = Math.floor(decision / 30) * 30;
  let start = decision;
  while (start - 1 >= 0 && start - 1 >= bucket - 60 && phaseOf(start - 1) === phase) start -= 1;
  let end = decision;
  while (end + 1 <= 1439 && end + 1 <= bucket + 89 && phaseOf(end + 1) === phase) end += 1;
  return { startEt: formatEtMinute(start), endEt: formatEtMinute(end) };
}

/** Index of the bar that closed at the mark's minute (a mark at 08:12 decides on the bar opened at 08:11). */
export function decisionIndexFor(series: BarSeries, markTime: number): number | undefined {
  return series.byTime.get(markTime - BAR_MS);
}

const ceilToTick = (points: number) => Math.ceil(points / MES_SPEC.tickSize) * MES_SPEC.tickSize;
const pct = (value: number) => `${Math.round(value)}%`;

export function findSimilarRecipe(series: BarSeries, mark: SimilarMark, options: SimilarOptions): SimilarResult {
  const registry = options.registry ?? SKILLS;
  const i = decisionIndexFor(series, mark.time);
  if (i === undefined) return { ok: false, reason: "No bar closed at the mark's minute. Pick a minute inside a loaded session." };
  const decision = decisionMinute(series, i);
  const window = similarWindow(decision);
  if (!window) return { ok: false, reason: "The mark is inside the 17:00–18:00 ET halt, where there are no bars." };

  const levelIndex = options.levelIndex ?? createLevelIndex(series);
  const ctx: SkillContext = {
    series, i, params: {}, spec: { ...MES_SPEC }, rSizeUsd: options.rSizeUsd,
    levels: levelBookAt(levelIndex, i), mark: { price: mark.price, side: mark.side },
  };
  const side = mark.side;
  const read = (skill: string, params: Record<string, Value> = {}) => {
    const result = readSkill(skill, params, ctx, registry);
    return result.ok ? result.values : {};
  };

  const levelRead = read("levelMap");
  const context = read("contextRanges");
  const reclaim = read("confirm1m", { lookbackBars: RECLAIM_LOOKBACK, side }).reclaim === true;
  const wick = read("mtfCandle", { minutes: 15 })[side === "long" ? "lowerWickPctile" : "upperWickPctile"];
  const rvol = read("rvol", { windowMinutes: 5, sessions: 10 }).rvol;
  const spike = read("volumeSpike").spike === true;
  const stopPoints = read("structureStop", { ticks: 2, lookbackBars: 15, riskR: 0.25 }).stopPoints;
  const readings: Record<string, Value> = {
    nearestAboveKey: levelRead.nearestAboveKey ?? null,
    nearestAboveTicks: levelRead.nearestAboveTicks ?? null,
    nearestBelowKey: levelRead.nearestBelowKey ?? null,
    nearestBelowTicks: levelRead.nearestBelowTicks ?? null,
    overnightPosPct: context.overnightPosPct ?? null,
    reclaim,
    wick: wick ?? null,
    rvol: rvol ?? null,
    spike,
    stopPoints: stopPoints ?? null,
  };

  // Trigger, in §10.4 order. At most four conditions, each with a reason the editor can show.
  const conditions: Condition[] = [];
  const reasons: string[] = [];
  const nearest = [
    { key: levelRead.nearestAboveKey, ticks: levelRead.nearestAboveTicks },
    { key: levelRead.nearestBelowKey, ticks: levelRead.nearestBelowTicks },
  ]
    .filter((n): n is { key: string; ticks: number } => typeof n.key === "string" && n.key !== "none" && typeof n.ticks === "number")
    .sort((a, b) => Math.abs(a.ticks) - Math.abs(b.ticks))[0];
  const pos = context.overnightPosPct;
  if (nearest && Math.abs(nearest.ticks) <= NEAR_LEVEL_TICKS) {
    const abs = Math.abs(nearest.ticks);
    const label = LEVEL_LABELS[nearest.key as LevelKey] ?? nearest.key;
    conditions.push({ skill: "levelMap", params: { level: nearest.key, toleranceTicks: 2 }, out: "touch", op: "==", value: true });
    reasons.push(abs === 0 ? `Your mark was on ${label}` : `Your mark was ${abs} tick${abs === 1 ? "" : "s"} from ${label}`);
  } else if (typeof pos === "number" && (side === "long" ? pos <= EXTREME_POS_PCT : pos >= 100 - EXTREME_POS_PCT)) {
    conditions.push({
      skill: "contextRanges", out: "overnightPosPct", op: side === "long" ? "<=" : ">=",
      value: side === "long" ? EXTREME_POS_PCT : 100 - EXTREME_POS_PCT,
    });
    reasons.push(`Overnight position ${pct(pos)}: ${side === "long" ? "bottom" : "top"} of the overnight range`);
  }
  if (reclaim) {
    conditions.push({ skill: "confirm1m", params: { lookbackBars: RECLAIM_LOOKBACK, side }, out: "reclaim", op: "==", value: true });
    reasons.push("1m reclaim of the prior extreme at the mark");
  }
  if (typeof wick === "number" && wick >= WICK_MIN_PCTILE) {
    conditions.push({
      skill: "mtfCandle", params: { minutes: 15 }, out: side === "long" ? "lowerWickPctile" : "upperWickPctile", op: ">=", value: WICK_MIN_PCTILE,
    });
    reasons.push(`15m ${side === "long" ? "lower" : "upper"} wick at the ${pct(wick)} percentile`);
  }
  if (typeof rvol === "number" && rvol >= RVOL_MIN) {
    conditions.push({ skill: "rvol", params: { windowMinutes: 5, sessions: 10 }, out: "rvol", op: ">=", value: RVOL_MIN });
    reasons.push(`RVOL ${rvol.toFixed(2)} at the mark (≥ ${RVOL_MIN})`);
  } else if (spike) {
    conditions.push({ skill: "volumeSpike", out: "spike", op: "==", value: true });
    reasons.push("Volume spike at the mark");
  }
  if (conditions.length === 0) {
    return { ok: false, reason: "Nothing at the mark to match on: no level, reclaim, wick or volume reading." };
  }
  const trigger = conditions.slice(0, MAX_TRIGGER_CONDITIONS);

  // Slices: every candidate output not already in the trigger, volume first, capped at 12.
  const triggerKeys = new Set(trigger.flatMap((c) => ("skill" in c
    ? [featureKey({ skill: c.skill, params: c.params as Record<string, Value> | undefined, out: c.out }, 1)]
    : [])));
  const sliceBy = sliceCandidates(side)
    .filter((s) => !triggerKeys.has(featureKey(s, 1)))
    .slice(0, MAX_SLICES);

  const maxPoints = typeof stopPoints === "number" && stopPoints > 0
    ? Math.max(MIN_MAX_POINTS, ceilToTick(2.5 * stopPoints))
    : MIN_MAX_POINTS;
  const markEt = formatEtMinute(decision);
  const draft = {
    schema: "mogmine.strategy-recipe.v1",
    id: `rcp-similar-${side}-${mark.time}`,
    version: 1,
    name: `Similar to the ${side} mark at ${markEt} ET`,
    notes: "Generated from a Context Card mark. Every condition is editable.",
    playbookId: options.playbookId ?? null,
    symbol: "MES",
    side,
    window,
    trigger: { all: trigger },
    entry: { at: "trigger-close" },
    stop: { type: "beyond-swing", ticks: 2, lookbackBars: 15, maxPoints },
    target: { type: "rr", multiple: RR_MULTIPLE },
    maxHoldMinutes: 60,
    flatAtEt: "16:59",
    sizing: { mode: "risk-r", riskR: 0.25 },
    account: { accountId: null },
    slippageTicks: { stop: 1, market: 1 },
    dedupe: { maxPerSession: 1, cooldownMinutes: 30, oneAtATime: true },
    sliceBy,
    measure: { levelReach: ["vwap_globex", "onh", "pdc"], forwardMinutes: [15, 30, 60] },
  };
  const checked = validateRecipe(draft, registry);
  if (!checked.ok) {
    return { ok: false, reason: `Generated recipe failed validation: ${checked.errors[0]?.path} ${checked.errors[0]?.message}` };
  }
  return { ok: true, recipe: checked.recipe, reasons, readings };
}
