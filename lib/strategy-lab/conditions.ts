import { getSkill, SKILLS } from "./registry.ts";
import type { SkillRegistry } from "./registry.ts";
import type { Condition, ConditionOp, SkipReason, SkillContext, SkillResult, Value } from "./types.ts";

export type ConditionSkipCounts = Record<string, Partial<Record<SkipReason, number>>>;
export interface ConditionEvaluation { passed: boolean; skips: ConditionSkipCounts }

function countSkip(skips: ConditionSkipCounts, path: string, reason: SkipReason) {
  const counts = skips[path] ?? {};
  counts[reason] = (counts[reason] ?? 0) + 1;
  skips[path] = counts;
}

function skipTotal(skips: ConditionSkipCounts): number {
  return Object.values(skips).reduce(
    (total, reasons) => total + Object.values(reasons).reduce((sum, count) => sum + (count ?? 0), 0),
    0,
  );
}

function numericPair(actual: Value | undefined, expected: Value): [number, number] | null {
  return typeof actual === "number" && Number.isFinite(actual)
    && typeof expected === "number" && Number.isFinite(expected)
    ? [actual, expected]
    : null;
}

export function compareCondition(actual: Value | undefined, op: ConditionOp, expected: Value | Value[]): boolean {
  if (op === "==") return !Array.isArray(expected) && actual === expected;
  if (op === "!=") return !Array.isArray(expected) && actual !== expected;
  if (op === "in") return Array.isArray(expected) && expected.some((value) => value === actual);
  if (op === "between") {
    if (!Array.isArray(expected) || expected.length !== 2 || typeof actual !== "number" || !Number.isFinite(actual)) return false;
    const [low, high] = expected;
    return typeof low === "number" && Number.isFinite(low) && typeof high === "number" && Number.isFinite(high)
      && actual >= low && actual <= high;
  }
  if (Array.isArray(expected)) return false;
  const pair = numericPair(actual, expected);
  if (!pair) return false;
  const [left, right] = pair;
  if (op === "<") return left < right;
  if (op === "<=") return left <= right;
  if (op === ">") return left > right;
  if (op === ">=") return left >= right;
  return false;
}

function runSkill(ctx: SkillContext, ref: string, registry: SkillRegistry): SkillResult {
  const skill = getSkill(ref, registry);
  if (!skill || skill.meta.kind === "measure") return { ok: false, reason: "bad-params", detail: `Unavailable trigger skill: ${ref}` };
  try {
    const preflight = skill.preflight(ctx);
    return preflight.ok ? skill.compute(ctx) : preflight;
  } catch (error) {
    return { ok: false, reason: "bad-params", detail: error instanceof Error ? error.message : "Skill failed" };
  }
}

function evaluateLeaf(
  condition: Extract<Condition, { skill: string }>, ctx: SkillContext,
  registry: SkillRegistry, skips: ConditionSkipCounts, path: string,
): boolean {
  const currentCtx = { ...ctx, params: condition.params ?? {} };
  const current = runSkill(currentCtx, condition.skill, registry);
  if (!current.ok) {
    countSkip(skips, path, current.reason);
    return false;
  }
  if (!Object.hasOwn(current.values, condition.out)) {
    countSkip(skips, path, "bad-params");
    return false;
  }

  if (condition.op !== "crossesAbove" && condition.op !== "crossesBelow") {
    return compareCondition(current.values[condition.out], condition.op, condition.value);
  }
  if (Array.isArray(condition.value) || typeof condition.value !== "number" || !Number.isFinite(condition.value)) return false;
  if (ctx.i < 1 || ctx.series.time[ctx.i] - ctx.series.time[ctx.i - 1] !== ctx.series.barMs) return false;

  const previous = runSkill({ ...currentCtx, i: ctx.i - 1 }, condition.skill, registry);
  if (!previous.ok) {
    countSkip(skips, path, previous.reason);
    return false;
  }
  const before = previous.values[condition.out];
  const now = current.values[condition.out];
  if (typeof before !== "number" || !Number.isFinite(before) || typeof now !== "number" || !Number.isFinite(now)) return false;
  return condition.op === "crossesAbove"
    ? before < condition.value && now >= condition.value
    : before > condition.value && now <= condition.value;
}

function evaluateNode(
  condition: Condition, ctx: SkillContext, registry: SkillRegistry,
  skips: ConditionSkipCounts, path: string, depth = 0,
): boolean {
  if (depth > 3) {
    countSkip(skips, path, "bad-params");
    return false;
  }
  if ("all" in condition) {
    for (let i = 0; i < condition.all.length; i += 1) {
      if (!evaluateNode(condition.all[i], ctx, registry, skips, `${path}.all[${i}]`, depth + 1)) return false;
    }
    return true;
  }
  if ("any" in condition) {
    for (let i = 0; i < condition.any.length; i += 1) {
      if (evaluateNode(condition.any[i], ctx, registry, skips, `${path}.any[${i}]`, depth + 1)) return true;
    }
    return false;
  }
  if ("not" in condition) {
    const before = skipTotal(skips);
    const passed = evaluateNode(condition.not, ctx, registry, skips, `${path}.not`, depth + 1);
    // Missing evidence cannot become a match merely because it is negated.
    return skipTotal(skips) === before && !passed;
  }
  return evaluateLeaf(condition, ctx, registry, skips, path);
}

/** Evaluate in declaration order with short-circuiting and typed skip accounting. */
export function evaluateCondition(
  condition: Condition, ctx: SkillContext, registry: SkillRegistry = SKILLS,
): ConditionEvaluation {
  const skips: ConditionSkipCounts = {};
  return { passed: evaluateNode(condition, ctx, registry, skips, "trigger"), skips };
}
