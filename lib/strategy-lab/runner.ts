// Deterministic recipe runner (docs/design-2026-11-24/09 §8.1, SL-8). Plain synchronous call; a Web Worker can wrap
// it later without changing the result. Same recipe + same series + same R size gives the same RunResult (the `ms`
// field aside, which is wall-clock and is taken from an injectable clock).
//
// Scan: each bar in a used session that falls in the recipe window is a candidate. Dedupe gates run first (cheap),
// then the trigger is evaluated with known-at levels only. A passing trigger becomes a trade: entry at the trigger
// close, stop and target from the recipe, qty from fixed R, outcome from bracketOutcome (bars after the entry only).

import { attribute, featureKey } from "./attribution.ts";
import { evaluateCondition } from "./conditions.ts";
import { createLevelIndex, levelBookAt } from "./levels.ts";
import type { LevelBook } from "./types.ts";
import { parseEtMinute, validateRecipe, majorOfVersion, inEtWindow, outputSpecOf } from "./recipe.ts";
import { getSkill, SKILLS } from "./registry.ts";
import type { SkillRegistry } from "./registry.ts";
import { decisionMinute } from "./skills/clock.ts";
import { forwardReturn, levelReach, measureBracket, type Bracket } from "./skills/measure.ts";
import type {
  BarSeries, Match, Recipe, RunResult, SkillContext, SkillOutputRef, SkipReason, Value,
} from "./types.ts";

export const MES_SPEC = { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 } as const;
const BAR_MS = 60_000;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Mon…Sun for a session date (YYYY-MM-DD). The session date is already the ET trading date. */
function weekdayOf(sessionDate: string): string {
  return WEEKDAY_NAMES[new Date(`${sessionDate}T12:00:00Z`).getUTCDay()];
}

export interface RunContext {
  /** Fixed account R size in dollars. Never inferred from a stop width. */
  rSizeUsd: number;
  /** Where the R size came from, shown on the results header. */
  rSizeSource?: "account" | "default";
  registry?: SkillRegistry;
  /** Wall clock for `ms`. Injected by tests; defaults to performance.now(). */
  now?: () => number;
}

type ReadResult =
  | { ok: true; values: Record<string, Value> }
  | { ok: false; reason: SkipReason; detail: string };

/** Run one skill at the context's bar with the given params and return all its values, or why it skipped. */
export function readSkill(skillId: string, params: Record<string, Value>, ctx: SkillContext, registry: SkillRegistry = SKILLS): ReadResult {
  const skill = getSkill(skillId, registry);
  if (!skill) return { ok: false, reason: "bad-params", detail: `Unknown skill ${skillId}` };
  const scoped = { ...ctx, params };
  try {
    const preflight = skill.preflight(scoped);
    if (!preflight.ok) return preflight;
    const result = skill.compute(scoped);
    return result.ok ? { ok: true, values: result.values } : result;
  } catch (error) {
    return { ok: false, reason: "bad-params", detail: error instanceof Error ? error.message : "Skill failed" };
  }
}

/** One output of a skill reference at the context's bar. Null when the skill skipped. */
export function readOutput(ref: SkillOutputRef, ctx: SkillContext, registry: SkillRegistry = SKILLS): Value {
  const read = readSkill(ref.skill, ref.params ?? {}, ctx, registry);
  return read.ok && Object.hasOwn(read.values, ref.out) ? read.values[ref.out] : null;
}

function majorFor(skillId: string, registry: SkillRegistry): number {
  const skill = getSkill(skillId, registry);
  return skill ? majorOfVersion(skill.meta.version) : 1;
}

function bump(skips: RunResult["skips"], path: string, reason: SkipReason): void {
  const counts = skips[path] ?? {};
  counts[reason] = (counts[reason] ?? 0) + 1;
  skips[path] = counts;
}

function mergeSkips(into: RunResult["skips"], from: RunResult["skips"]): void {
  for (const [path, reasons] of Object.entries(from)) {
    for (const [reason, count] of Object.entries(reasons)) {
      if (count) for (let n = 0; n < count; n += 1) bump(into, path, reason as SkipReason);
    }
  }
}

type Built =
  | { ok: true; bracket: Bracket; entry: number; stop: number; target: number; qty: number; oversized: boolean; stopPoints: number }
  | { ok: false; path: string; reason: SkipReason };

/** Entry, stop, target and quantity for one trigger bar. Prices are integer ticks until the last step. */
function buildTrade(recipe: Recipe, series: BarSeries, i: number, levels: LevelBook, flatMinuteEt: number, rSizeUsd: number): Built {
  const tick = MES_SPEC.tickSize;
  const sign = recipe.side === "long" ? 1 : -1;
  const entryTicks = Math.round(series.close[i] / tick);
  let stopTicks: number;
  let stopCap: number | null = null;
  if (recipe.stop.type === "points") {
    stopTicks = entryTicks - sign * Math.round(recipe.stop.points / tick);
  } else {
    const first = Math.max(series.sessionStart[i], i - recipe.stop.lookbackBars + 1);
    let extreme = sign > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    for (let j = first; j <= i; j += 1) {
      const ticks = sign > 0 ? Math.round(series.low[j] / tick) : Math.round(series.high[j] / tick);
      extreme = sign > 0 ? Math.min(extreme, ticks) : Math.max(extreme, ticks);
    }
    stopTicks = extreme - sign * recipe.stop.ticks;
    stopCap = recipe.stop.maxPoints;
  }
  const stopDistance = sign * (entryTicks - stopTicks);
  if (stopDistance <= 0) return { ok: false, path: "stop", reason: "bad-params" };
  const stopPoints = stopDistance * tick;
  if (stopCap !== null && stopPoints > stopCap) return { ok: false, path: "stop", reason: "bad-params" };

  let targetTicks: number;
  if (recipe.target.type === "points") {
    targetTicks = entryTicks + sign * Math.round(recipe.target.points / tick);
  } else if (recipe.target.type === "rr") {
    targetTicks = entryTicks + sign * Math.round(recipe.target.multiple * stopDistance);
  } else {
    const level = levels.byKey.get(recipe.target.level);
    const levelTicks = level ? Math.round(level.value / tick) : null;
    targetTicks = levelTicks !== null && sign * (levelTicks - entryTicks) > 0
      ? levelTicks
      : entryTicks + sign * Math.round(recipe.target.fallbackPoints / tick);
  }
  if (sign * (targetTicks - entryTicks) <= 0) return { ok: false, path: "target", reason: "bad-params" };

  let qty: number;
  let oversized = false;
  if (recipe.sizing.mode === "risk-r") {
    const fitted = Math.floor((recipe.sizing.riskR * rSizeUsd) / (stopPoints * MES_SPEC.pointValueUsd) + 1e-9);
    oversized = fitted < 1;
    qty = Math.max(1, fitted);
  } else {
    qty = recipe.sizing.qty;
  }

  const stop = stopTicks * tick;
  const target = targetTicks * tick;
  return {
    ok: true,
    entry: entryTicks * tick,
    stop,
    target,
    qty,
    oversized,
    stopPoints,
    bracket: {
      side: recipe.side,
      stop,
      target,
      qty,
      stopSlippageTicks: recipe.slippageTicks.stop,
      marketSlippageTicks: recipe.slippageTicks.market,
      maxHoldMinutes: recipe.maxHoldMinutes,
      flatMinuteEt,
    },
  };
}

/** Run a recipe over the series. Throws when the recipe is invalid; callers validate drafts first. */
export function runRecipe(input: Recipe, series: BarSeries, context: RunContext): RunResult {
  const clock = context.now ?? (() => performance.now());
  const started = clock();
  const registry = context.registry ?? SKILLS;
  const checked = validateRecipe(input, registry);
  if (!checked.ok) {
    throw new Error(`Invalid recipe: ${checked.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  }
  const recipe = checked.recipe;
  const rSize = context.rSizeUsd;
  if (!(Number.isFinite(rSize) && rSize > 0)) throw new Error("R size must be a positive dollar amount");

  const index = createLevelIndex(series);
  const flatMinuteEt = parseEtMinute(recipe.flatAtEt) ?? 1019; // validated above; 1019 = 16:59
  const usable = new Set(series.sessions.filter((s) => !s.excluded && s.baseTimeframe === "1m").map((s) => s.date));
  const skips: RunResult["skips"] = {};
  const matches: Match[] = [];
  const perSession = new Map<string, number>();
  let candidates = 0;
  let lastDecision: number | null = null;
  let openUntil: number | null = null;

  for (let i = 0; i < series.time.length; i += 1) {
    const date = series.sessionDate[i];
    if (!usable.has(date)) continue;
    if (!inEtWindow(decisionMinute(series, i), recipe.window.startEt, recipe.window.endEt)) continue;
    if (recipe.window.days && !(recipe.window.days as string[]).includes(weekdayOf(date))) continue;
    candidates += 1;

    const decision = series.time[i] + BAR_MS;
    if (recipe.dedupe.oneAtATime && openUntil !== null && decision < openUntil) continue;
    if (lastDecision !== null && decision - lastDecision < recipe.dedupe.cooldownMinutes * BAR_MS) continue;
    if ((perSession.get(date) ?? 0) >= recipe.dedupe.maxPerSession) continue;

    const ctx: SkillContext = {
      series, i, params: {}, spec: { ...MES_SPEC }, rSizeUsd: rSize, levels: levelBookAt(index, i),
    };
    const verdict = evaluateCondition(recipe.trigger, ctx, registry);
    mergeSkips(skips, verdict.skips);
    if (!verdict.passed) continue;

    const built = buildTrade(recipe, series, i, ctx.levels, flatMinuteEt, rSize);
    if (!built.ok) {
      bump(skips, built.path, built.reason);
      continue;
    }
    const outcome = measureBracket(series, i, built.bracket, MES_SPEC, rSize);
    if (!outcome.ok) {
      bump(skips, "outcome", outcome.reason);
      continue;
    }

    const features: Record<string, Value> = {};
    for (const ref of recipe.sliceBy) {
      features[featureKey(ref, majorFor(ref.skill, registry))] = readOutput(ref, ctx, registry);
    }
    for (const level of recipe.measure.levelReach ?? []) {
      const read = readSkill(levelReach.meta.id, {
        side: recipe.side, stop: built.stop, level, maxHoldMinutes: recipe.maxHoldMinutes, flatMinuteEt,
      }, ctx, registry);
      if (read.ok) {
        for (const [out, value] of Object.entries(read.values)) {
          features[featureKey({ skill: levelReach.meta.id, params: { level }, out }, 1)] = value;
        }
      }
    }
    for (const minutes of recipe.measure.forwardMinutes ?? []) {
      const read = readSkill(forwardReturn.meta.id, { side: recipe.side, forwardMinutes: minutes }, ctx, registry);
      if (read.ok) {
        for (const [out, value] of Object.entries(read.values)) {
          features[featureKey({ skill: forwardReturn.meta.id, params: { forwardMinutes: minutes }, out }, 1)] = value;
        }
      }
    }

    matches.push({
      i,
      time: series.time[i],
      sessionDate: date,
      entry: built.entry,
      stop: built.stop,
      target: built.target,
      qty: built.qty,
      oversized: built.oversized,
      features,
      outcome: outcome.outcome,
    });
    perSession.set(date, (perSession.get(date) ?? 0) + 1);
    lastDecision = decision;
    openUntil = outcome.outcome.exitTime;
  }

  const attr = attribute(matches, recipe.sliceBy, {
    outputSpec: (ref) => outputSpecOf(ref, registry),
    featureKeyOf: (ref) => featureKey(ref, majorFor(ref.skill, registry)),
    tickSize: MES_SPEC.tickSize,
    pointValueUsd: MES_SPEC.pointValueUsd,
  });

  const usedSessions = series.sessions.filter((s) => usable.has(s.date));
  const excluded = series.sessions
    .filter((s) => !usable.has(s.date))
    .map((s) => ({ date: s.date, reason: s.excluded?.reason ?? `only ${s.baseTimeframe} bars` }));

  return {
    recipe: { id: recipe.id, version: recipe.version },
    data: {
      sessionsRequested: series.sessions.length,
      sessionsUsed: usedSessions.map((s) => s.date),
      excluded,
      barsMissing: usedSessions.reduce((sum, s) => sum + Math.max(0, s.expectedBars - s.presentBars), 0),
      volumeMissing: usedSessions.reduce((sum, s) => sum + s.volumeMissing, 0),
      rSize: { usd: rSize, source: context.rSizeSource ?? "default" },
    },
    candidates,
    skips,
    matches,
    overlays: [],
    stats: attr.stats,
    splits: attr.splits,
    separators: attr.separators,
    timeOfDay: attr.timeOfDay,
    ms: clock() - started,
  };
}
