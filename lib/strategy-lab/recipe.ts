// Recipe schema and validator (docs/design-2026-11-24/09 §5.1–§5.3, SL-8). Pure: no I/O and no DOM.
// A recipe is data. It is validated here before any run, so the runner can trust its shape. Errors carry a
// path ("trigger.all[1].op") so the editor (SL-12) can point at the field. Defaults are filled in here.

import { LEVEL_KEYS } from "./levels.ts";
import { validateManagePlan } from "./manage.ts";
import { getSkill, SKILLS } from "./registry.ts";
import type { SkillRegistry } from "./registry.ts";
import type {
  Condition, ConditionOp, LevelKey, OutputSpec, ParamSpec, Recipe, SkillMeta, SkillOutputRef, Value,
} from "./types.ts";

export const RECIPE_SCHEMA = "mogmine.strategy-recipe.v1" as const;
/** Same bound the evaluator enforces at run time: a leaf may sit under at most three all/any/not wrappers. */
export const MAX_CONDITION_DEPTH = 3;
export const MAX_SLICES = 12;
export const MAX_HOLD_MINUTES = 1440;
export const DEFAULT_MAX_HOLD_MINUTES = 60;
export const DEFAULT_FLAT_AT_ET = "16:59";
export const LAB_SYMBOL = "MES" as const;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const OPS: readonly ConditionOp[] = ["==", "!=", "<", "<=", ">", ">=", "between", "in", "crossesAbove", "crossesBelow"];
const NUMERIC_OPS: readonly ConditionOp[] = ["==", "!=", "<", "<=", ">", ">="];

export interface RecipeIssue { path: string; message: string }
export type RecipeValidation = { ok: true; recipe: Recipe } | { ok: false; errors: RecipeIssue[] };

/** Defaults the editor shows and the runner uses when a field is left out. Fresh objects every call. */
export function defaultSizing(): Recipe["sizing"] { return { mode: "risk-r", riskR: 0.25 }; }
export function defaultSlippage(): Recipe["slippageTicks"] { return { stop: 1, market: 1 }; }
export function defaultDedupe(): Recipe["dedupe"] {
  return { maxPerSession: 1, cooldownMinutes: 30, oneAtATime: true };
}

/** "HH:MM" to minutes after midnight, or null. Accepts 00:00 through 23:59 only. */
export function parseEtMinute(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes after midnight to "HH:MM". Input is taken modulo one day. */
export function formatEtMinute(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** True when a decision minute falls in the window. A window whose end is before its start wraps midnight. */
export function inEtWindow(minute: number, startEt: string, endEt: string): boolean {
  const start = parseEtMinute(startEt);
  const end = parseEtMinute(endEt);
  if (start === null || end === null) return false;
  return start <= end ? minute >= start && minute <= end : minute >= start || minute <= end;
}

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;
const isInt = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** Clone JSON-shaped input so the validated recipe shares no objects with the caller. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function majorOfVersion(version: string): number {
  return Number(version.split(".")[0]);
}

/** Checks one parameter value against its declared spec. */
function checkParamValue(spec: ParamSpec, value: unknown, path: string, errors: RecipeIssue[]): void {
  const fail = (message: string) => errors.push({ path, message });
  if (spec.type === "boolean") {
    if (typeof value !== "boolean") fail(`${spec.label} must be true or false`);
    return;
  }
  if (spec.type === "enum") {
    if (typeof value !== "string" || !(spec.options ?? []).includes(value)) {
      fail(`${spec.label} must be one of ${(spec.options ?? []).map((o) => `"${o}"`).join(", ")}`);
    }
    return;
  }
  if (!isFiniteNumber(value)) { fail(`${spec.label} must be a number`); return; }
  if (spec.type === "integer" && !Number.isInteger(value)) { fail(`${spec.label} must be a whole number`); return; }
  if (spec.min !== undefined && value < spec.min) fail(`${spec.label} must be at least ${spec.min}`);
  if (spec.max !== undefined && value > spec.max) fail(`${spec.label} must be at most ${spec.max}`);
}

/** Returns the params object when every key is declared and typed, otherwise null (errors are pushed). */
function checkParams(meta: SkillMeta, params: unknown, path: string, errors: RecipeIssue[]): Record<string, Value> | null {
  if (params === undefined) return {};
  if (!isRecord(params)) { errors.push({ path, message: "params must be an object" }); return null; }
  let ok = true;
  for (const [key, value] of Object.entries(params)) {
    const spec = meta.params.find((p) => p.key === key);
    if (!spec) {
      errors.push({ path: `${path}.${key}`, message: `Unknown parameter "${key}" for ${meta.id}` });
      ok = false;
    } else {
      const before = errors.length;
      checkParamValue(spec, value, `${path}.${key}`, errors);
      if (errors.length !== before) ok = false;
    }
  }
  return ok ? (params as Record<string, Value>) : null;
}

/** Checks the operator and comparison value against the output's type (§5.2). */
function checkOp(spec: OutputSpec, op: unknown, value: unknown, path: string, errors: RecipeIssue[]): void {
  const fail = (message: string) => errors.push({ path, message });
  if (typeof op !== "string" || !OPS.includes(op as ConditionOp)) {
    fail(`Unknown operator "${String(op)}"`);
    return;
  }
  const operator = op as ConditionOp;
  if (spec.type === "number") {
    if (NUMERIC_OPS.includes(operator) || operator === "crossesAbove" || operator === "crossesBelow") {
      if (!isFiniteNumber(value)) fail(`"${operator}" on ${spec.key} needs a number`);
    } else if (operator === "between") {
      if (!Array.isArray(value) || value.length !== 2 || !value.every(isFiniteNumber) || value[0] > value[1]) {
        fail(`"between" needs [low, high] numbers, low first`);
      }
    } else if (!Array.isArray(value) || value.length === 0 || !value.every(isFiniteNumber)) {
      fail(`"in" needs a non-empty list of numbers`);
    }
    return;
  }
  if (spec.type === "category") {
    const categories = spec.categories ?? [];
    if (operator === "==" || operator === "!=") {
      if (typeof value !== "string" || !categories.includes(value)) {
        fail(`${spec.key} compares to one of ${categories.map((c) => `"${c}"`).join(", ")}`);
      }
    } else if (operator === "in") {
      if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && categories.includes(v))) {
        fail(`"in" on ${spec.key} needs a non-empty list of its categories`);
      }
    } else {
      fail(`"${operator}" does not apply to the category output ${spec.key}`);
    }
    return;
  }
  if (operator === "==" || operator === "!=") {
    if (typeof value !== "boolean") fail(`${spec.key} is true or false`);
  } else {
    fail(`"${operator}" does not apply to the boolean output ${spec.key}`);
  }
}

/** A skill-output reference (a trigger leaf or a slice). Measures are rejected: they are never triggers or slices. */
function checkRef(
  node: unknown, path: string, registry: SkillRegistry, errors: RecipeIssue[],
): { meta: SkillMeta; spec: OutputSpec; params: Record<string, Value> } | null {
  if (!isRecord(node)) { errors.push({ path, message: "Must be an object with skill and out" }); return null; }
  if (!isText(node.skill, 1, 80)) { errors.push({ path: `${path}.skill`, message: "skill is required" }); return null; }
  const skill = getSkill(node.skill, registry);
  if (!skill) { errors.push({ path: `${path}.skill`, message: `Unknown skill "${node.skill}"` }); return null; }
  if (skill.meta.kind === "measure") {
    errors.push({ path: `${path}.skill`, message: `"${node.skill}" is a measure. Measures only belong in the measure block, never in a trigger or a slice.` });
    return null;
  }
  const params = checkParams(skill.meta, node.params, `${path}.params`, errors);
  const spec = skill.meta.outputs.find((o) => o.key === node.out);
  if (!spec) {
    errors.push({ path: `${path}.out`, message: `Unknown output "${String(node.out)}" on ${skill.meta.id}` });
    return null;
  }
  return params === null ? null : { meta: skill.meta, spec, params };
}

function checkCondition(node: unknown, path: string, depth: number, registry: SkillRegistry, errors: RecipeIssue[]): void {
  if (!isRecord(node)) { errors.push({ path, message: "Condition must be an object" }); return; }
  if (depth > MAX_CONDITION_DEPTH) {
    errors.push({ path, message: `Conditions nest at most ${MAX_CONDITION_DEPTH} levels deep` });
    return;
  }
  if ("all" in node || "any" in node) {
    const key = "all" in node ? "all" : "any";
    const list = node[key];
    if (!Array.isArray(list) || list.length === 0) {
      errors.push({ path: `${path}.${key}`, message: "Needs a non-empty list of conditions" });
      return;
    }
    list.forEach((child, n) => checkCondition(child, `${path}.${key}[${n}]`, depth + 1, registry, errors));
    return;
  }
  if ("not" in node) {
    checkCondition(node.not, `${path}.not`, depth + 1, registry, errors);
    return;
  }
  const ref = checkRef(node, path, registry, errors);
  if (ref) checkOp(ref.spec, node.op, node.value, `${path}.value`, errors);
}

function checkStop(value: unknown, errors: RecipeIssue[]): Recipe["stop"] | null {
  const path = "stop";
  if (!isRecord(value)) { errors.push({ path, message: "stop is required" }); return null; }
  if (value.type === "points") {
    if (!isFiniteNumber(value.points) || value.points <= 0) { errors.push({ path: "stop.points", message: "points must be above zero" }); return null; }
    return { type: "points", points: value.points };
  }
  if (value.type === "beyond-swing") {
    const ok = isInt(value.ticks, 0, 20) && isInt(value.lookbackBars, 1, 240)
      && isFiniteNumber(value.maxPoints) && value.maxPoints > 0;
    if (!ok) {
      errors.push({ path, message: "beyond-swing needs ticks 0–20, lookbackBars 1–240 and maxPoints above zero" });
      return null;
    }
    return {
      type: "beyond-swing", ticks: value.ticks as number, lookbackBars: value.lookbackBars as number,
      maxPoints: value.maxPoints as number,
    };
  }
  errors.push({ path: "stop.type", message: 'stop.type must be "points" or "beyond-swing"' });
  return null;
}

function checkTarget(value: unknown, errors: RecipeIssue[]): Recipe["target"] | null {
  const path = "target";
  if (!isRecord(value)) { errors.push({ path, message: "target is required" }); return null; }
  if (value.type === "points") {
    if (!isFiniteNumber(value.points) || value.points <= 0) { errors.push({ path: "target.points", message: "points must be above zero" }); return null; }
    return { type: "points", points: value.points };
  }
  if (value.type === "rr") {
    if (!isFiniteNumber(value.multiple) || value.multiple <= 0) { errors.push({ path: "target.multiple", message: "multiple must be above zero" }); return null; }
    return { type: "rr", multiple: value.multiple };
  }
  if (value.type === "level") {
    const ok = typeof value.level === "string" && (LEVEL_KEYS as readonly string[]).includes(value.level)
      && isFiniteNumber(value.fallbackPoints) && value.fallbackPoints > 0;
    if (!ok) { errors.push({ path, message: "level target needs a known level key and fallbackPoints above zero" }); return null; }
    return { type: "level", level: value.level as LevelKey, fallbackPoints: value.fallbackPoints as number };
  }
  errors.push({ path: "target.type", message: 'target.type must be "points", "rr" or "level"' });
  return null;
}

function checkSizing(value: unknown, errors: RecipeIssue[]): Recipe["sizing"] | null {
  if (value === undefined) return defaultSizing();
  if (isRecord(value) && value.mode === "risk-r" && isFiniteNumber(value.riskR) && value.riskR > 0 && value.riskR <= 10) {
    return { mode: "risk-r", riskR: value.riskR };
  }
  if (isRecord(value) && value.mode === "contracts" && isInt(value.qty, 1, 1000)) {
    return { mode: "contracts", qty: value.qty as number };
  }
  errors.push({ path: "sizing", message: "sizing is risk-r with riskR above 0 (up to 10), or contracts with a whole qty of 1 or more" });
  return null;
}

function checkDedupe(value: unknown, errors: RecipeIssue[]): Recipe["dedupe"] | null {
  if (value === undefined) return defaultDedupe();
  if (isRecord(value) && isInt(value.maxPerSession, 1, 100) && isInt(value.cooldownMinutes, 0, 1440)
    && typeof value.oneAtATime === "boolean") {
    return { maxPerSession: value.maxPerSession as number, cooldownMinutes: value.cooldownMinutes as number, oneAtATime: value.oneAtATime };
  }
  errors.push({ path: "dedupe", message: "dedupe needs maxPerSession 1–100, cooldownMinutes 0–1440 and oneAtATime true or false" });
  return null;
}

function checkMeasure(value: unknown, errors: RecipeIssue[]): Recipe["measure"] | null {
  if (value === undefined) return {};
  if (!isRecord(value)) { errors.push({ path: "measure", message: "measure must be an object" }); return null; }
  const out: Recipe["measure"] = {};
  if (value.levelReach !== undefined) {
    const list = value.levelReach;
    const ok = Array.isArray(list) && list.every((k) => typeof k === "string" && (LEVEL_KEYS as readonly string[]).includes(k));
    if (!ok) { errors.push({ path: "measure.levelReach", message: "levelReach must list known level keys" }); return null; }
    out.levelReach = [...(list as LevelKey[])];
  }
  if (value.forwardMinutes !== undefined) {
    const list = value.forwardMinutes;
    if (!Array.isArray(list) || !list.every((m) => isInt(m, 1, 240))) {
      errors.push({ path: "measure.forwardMinutes", message: "forwardMinutes must be whole minutes from 1 to 240" });
      return null;
    }
    out.forwardMinutes = [...(list as number[])];
  }
  return out;
}

function checkWindow(value: unknown, errors: RecipeIssue[]): Recipe["window"] | null {
  if (!isRecord(value)) { errors.push({ path: "window", message: "window is required" }); return null; }
  if (parseEtMinute(value.startEt) === null) errors.push({ path: "window.startEt", message: 'startEt must be "HH:MM" ET' });
  if (parseEtMinute(value.endEt) === null) errors.push({ path: "window.endEt", message: 'endEt must be "HH:MM" ET' });
  if (value.days !== undefined && !(Array.isArray(value.days) && value.days.length > 0
    && value.days.every((d) => (WEEKDAYS as readonly unknown[]).includes(d)))) {
    errors.push({ path: "window.days", message: "days must be a non-empty list of Mon…Fri" });
  }
  if (errors.some((e) => e.path.startsWith("window"))) return null;
  const days = value.days as Recipe["window"]["days"];
  return { startEt: value.startEt as string, endEt: value.endEt as string, ...(days ? { days: [...days] } : {}) };
}

/** Validates an unknown value (a parsed JSON file, an editor draft or a card-generated recipe). */
export function validateRecipe(input: unknown, registry: SkillRegistry = SKILLS): RecipeValidation {
  if (!isRecord(input)) return { ok: false, errors: [{ path: "", message: "Recipe must be an object" }] };
  const errors: RecipeIssue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  if (input.schema !== undefined && input.schema !== RECIPE_SCHEMA) err("schema", `schema must be "${RECIPE_SCHEMA}"`);
  if (!isText(input.id, 1, 200)) err("id", "id must be 1–200 characters");
  if (!isInt(input.version ?? 1, 1, 1_000_000)) err("version", "version must be a whole number from 1");
  if (!isText(input.name, 1, 200)) err("name", "name must be 1–200 characters");
  if (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 2000)) err("notes", "notes must be text up to 2000 characters");
  if (input.playbookId !== undefined && input.playbookId !== null && !isText(input.playbookId, 1, 200)) {
    err("playbookId", "playbookId must be null or text");
  }
  if ((input.symbol ?? LAB_SYMBOL) !== LAB_SYMBOL) err("symbol", 'Only "MES" is supported in the MVP');
  if (input.side !== "long" && input.side !== "short") err("side", 'side must be "long" or "short"');
  const window = checkWindow(input.window, errors);

  checkCondition(input.trigger, "trigger", 0, registry, errors);
  if (input.entry !== undefined && !(isRecord(input.entry) && input.entry.at === "trigger-close")) {
    err("entry.at", 'entry.at must be "trigger-close"');
  }
  const stop = checkStop(input.stop, errors);
  const manageResult = input.manage === undefined || input.manage === null ? null : validateManagePlan(input.manage);
  if (manageResult && !manageResult.ok) manageResult.errors.forEach((issue) => err(`manage${issue.path ? `.${issue.path}` : ""}`, issue.message));
  const manage = manageResult?.ok ? manageResult.plan : null;
  const target = input.target === undefined && manage ? undefined : checkTarget(input.target, errors);
  if (!isInt(input.maxHoldMinutes ?? DEFAULT_MAX_HOLD_MINUTES, 1, MAX_HOLD_MINUTES)) err("maxHoldMinutes", "maxHoldMinutes must be a whole number from 1 to 1440");
  const flatAtEt = input.flatAtEt ?? DEFAULT_FLAT_AT_ET;
  if (parseEtMinute(flatAtEt) === null) err("flatAtEt", 'flatAtEt must be "HH:MM" ET');
  const sizing = checkSizing(input.sizing, errors);
  const account = input.account === undefined ? { accountId: null } : input.account;
  if (!(isRecord(account) && (account.accountId === null || isText(account.accountId, 1, 200)))) {
    err("account.accountId", "accountId must be null or text");
  }
  const slippage = input.slippageTicks === undefined ? defaultSlippage() : input.slippageTicks;
  if (!(isRecord(slippage) && isInt(slippage.stop, 0, 20) && isInt(slippage.market, 0, 20))) {
    err("slippageTicks", "slippageTicks needs stop and market as whole ticks 0–20");
  }
  const dedupe = checkDedupe(input.dedupe, errors);

  const sliceBy: SkillOutputRef[] = [];
  if (input.sliceBy !== undefined) {
    if (!Array.isArray(input.sliceBy) || input.sliceBy.length > MAX_SLICES) {
      err("sliceBy", `sliceBy must be a list of at most ${MAX_SLICES} outputs`);
    } else {
      input.sliceBy.forEach((node, n) => {
        const ref = checkRef(node, `sliceBy[${n}]`, registry, errors);
        if (ref) sliceBy.push({ skill: ref.meta.id, ...(Object.keys(ref.params).length ? { params: ref.params } : {}), out: ref.spec.key });
      });
    }
  }
  const measure = checkMeasure(input.measure, errors);

  if (errors.length > 0 || !window || !stop || (!target && !manage) || !sizing || !dedupe || !measure) {
    return { ok: false, errors: errors.length > 0 ? errors : [{ path: "", message: "Recipe is incomplete" }] };
  }
  const recipe = {
    schema: RECIPE_SCHEMA,
    id: input.id as string,
    version: (input.version ?? 1) as number,
    name: input.name as string,
    ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
    playbookId: (input.playbookId ?? null) as string | null,
    symbol: LAB_SYMBOL,
    side: input.side as "long" | "short",
    window,
    trigger: cloneJson(input.trigger) as Condition,
    entry: { at: "trigger-close" as const },
    stop,
    ...(target ? { target } : {}),
    manage,
    maxHoldMinutes: (input.maxHoldMinutes ?? DEFAULT_MAX_HOLD_MINUTES) as number,
    flatAtEt: flatAtEt as string,
    sizing,
    account: { accountId: (account as { accountId: string | null }).accountId },
    slippageTicks: { stop: (slippage as { stop: number }).stop, market: (slippage as { market: number }).market },
    dedupe,
    sliceBy,
    measure,
  } satisfies Recipe;
  return { ok: true, recipe };
}

/** Index of the output spec for a ref, if the skill declares it. Used by the editor and the splits. */
export function outputSpecOf(ref: SkillOutputRef, registry: SkillRegistry = SKILLS): OutputSpec | undefined {
  return getSkill(ref.skill, registry)?.meta.outputs.find((o) => o.key === ref.out);
}
