// Recipe editor model (docs/design-2026-11-24/09 §5, §11.1, §12.4, SL-12). Pure: no DOM, no I/O.
// The editor works on a plain JSON-shaped draft. The Form tab and the JSON tab both edit that one draft, so a
// round trip (form → JSON → form) cannot lose anything. Saving validates the draft (SL-8 validator, errors carry
// paths) and bumps `version` only when a recipe that has runs is changed (§12.4).

import { RECIPE_SCHEMA, MAX_SLICES, validateRecipe, type RecipeIssue, type RecipeValidation } from "./recipe.ts";
import { getSkill, listSkills, SKILLS, type SkillRegistry } from "./registry.ts";
import { recipeVersions, saveRecipe, type RecipeStore, type SaveOutcome } from "./recipes-store.ts";
import type { Condition, ConditionOp, OutputSpec, Recipe, SkillMeta, SkillOutputRef, Value } from "./types.ts";

export type Draft = Record<string, unknown>;
export type PathKey = string | number;
export type JsonParse = { ok: true; draft: Draft } | { ok: false; errors: RecipeIssue[] };
export type CommitOutcome =
  | { ok: true; store: RecipeStore; recipe: Recipe; changed: boolean; bumped: boolean }
  | { ok: false; errors: RecipeIssue[] };

const NUMBER_OPS: readonly ConditionOp[] = ["==", "!=", "<", "<=", ">", ">=", "between", "in", "crossesAbove", "crossesBelow"];
const CATEGORY_OPS: readonly ConditionOp[] = ["==", "!=", "in"];
const BOOLEAN_OPS: readonly ConditionOp[] = ["==", "!="];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Immutable set at a path. Creates missing objects and arrays along the way. Never mutates `root`. */
export function setIn(root: unknown, path: readonly PathKey[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const copy: unknown[] = Array.isArray(root) ? [...root] : [];
    copy[head] = setIn(copy[head], rest, value);
    return copy;
  }
  const copy: Record<string, unknown> = isRecord(root) ? { ...root } : {};
  copy[head] = setIn(copy[head], rest, value);
  return copy;
}

/** Reads a path. Missing steps give undefined. */
export function getIn(root: unknown, path: readonly PathKey[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (typeof key === "number") node = Array.isArray(node) ? node[key] : undefined;
    else node = isRecord(node) ? node[key] : undefined;
  }
  return node;
}

/** The errors whose path is `prefix` or sits under it (`prefix.x` or `prefix[0]`). For inline messages. */
export function issuesFor(errors: readonly RecipeIssue[], prefix: string): RecipeIssue[] {
  return errors.filter((e) => e.path === prefix || e.path.startsWith(`${prefix}.`) || e.path.startsWith(`${prefix}[`));
}

/** Sliceable outputs: categories, or numbers with default buckets (§5.1 `sliceBy`, §8.3). */
export interface SliceChoice { skill: string; out: string; label: string; volume: boolean; spec: OutputSpec }

export function sliceChoices(registry: SkillRegistry = SKILLS): SliceChoice[] {
  const choices: SliceChoice[] = [];
  for (const meta of listSkills(registry)) {
    if (meta.kind === "measure") continue;
    for (const spec of meta.outputs) {
      const sliceable = spec.type === "category" || (spec.type === "number" && (spec.buckets?.length ?? 0) > 0);
      if (sliceable) choices.push({ skill: meta.id, out: spec.key, label: spec.label, volume: meta.needs.volume, spec });
    }
  }
  return choices;
}

/** Volume chips are pre-selected on a new recipe (§12.4). */
export function defaultSlices(registry: SkillRegistry = SKILLS): SkillOutputRef[] {
  return sliceChoices(registry).filter((c) => c.volume).slice(0, MAX_SLICES).map((c) => ({ skill: c.skill, out: c.out }));
}

export function isSliceOn(slices: readonly SkillOutputRef[], choice: SliceChoice): boolean {
  return slices.some((s) => s.skill === choice.skill && s.out === choice.out);
}

/** Toggles one chip. Adding past the cap (§5.1, 12 slices) leaves the list unchanged. */
export function toggleSlice(slices: readonly SkillOutputRef[], choice: SliceChoice): SkillOutputRef[] {
  if (isSliceOn(slices, choice)) return slices.filter((s) => !(s.skill === choice.skill && s.out === choice.out));
  if (slices.length >= MAX_SLICES) return [...slices];
  return [...slices, { skill: choice.skill, out: choice.out }];
}

/** A new draft with every required field filled by the defaults in §5.1 / SL-8. Its trigger starts empty, so it
 *  fails validation until a condition is added. That is intended: the editor shows the error with its path. */
export function newRecipeDraft(
  input: { id: string; name?: string; playbookId?: string | null; side?: "long" | "short" },
  registry: SkillRegistry = SKILLS,
): Draft {
  return {
    schema: RECIPE_SCHEMA,
    id: input.id,
    version: 1,
    name: input.name ?? "New recipe",
    playbookId: input.playbookId ?? null,
    symbol: "MES",
    side: input.side ?? "long",
    window: { startEt: "07:00", endEt: "09:15" },
    trigger: { all: [] },
    entry: { at: "trigger-close" },
    stop: { type: "points", points: 4 },
    target: { type: "rr", multiple: 2 },
    maxHoldMinutes: 60,
    flatAtEt: "16:59",
    sizing: { mode: "risk-r", riskR: 0.25 },
    account: { accountId: null },
    slippageTicks: { stop: 1, market: 1 },
    dedupe: { maxPerSession: 1, cooldownMinutes: 30, oneAtATime: true },
    sliceBy: defaultSlices(registry),
    measure: {},
  };
}

/** A stored recipe as an editable draft: a deep copy, so editing never touches the store. */
export function draftFromRecipe(recipe: Recipe): Draft {
  return JSON.parse(JSON.stringify(recipe)) as Draft;
}

/** The JSON tab text. Pretty-printed with a trailing newline, the same shape as the backup export. */
export function draftToJson(draft: unknown): string {
  return `${JSON.stringify(draft, null, 2)}\n`;
}

/** Parses the JSON tab. Syntax errors and non-object roots come back with path "" (the whole document). */
export function parseDraftJson(text: string): JsonParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return { ok: false, errors: [{ path: "", message: `Not valid JSON: ${reason}` }] };
  }
  if (!isRecord(raw)) return { ok: false, errors: [{ path: "", message: "A recipe is a JSON object" }] };
  return { ok: true, draft: raw };
}

/** Validates a draft with the SL-8 validator. Errors carry paths such as `trigger.all[1].value`. */
export function checkDraft(draft: unknown, registry: SkillRegistry = SKILLS): RecipeValidation {
  return validateRecipe(draft, registry);
}

/** The recipe's content without `version`. Two recipes with equal keys are the same recipe. */
export function recipeContentKey(recipe: Recipe): string {
  const content: Partial<Recipe> = { ...recipe };
  delete content.version;
  return JSON.stringify(content);
}

/**
 * Saves an edited draft. A new id starts at version 1. An unchanged recipe is not re-saved. A changed recipe
 * whose newest version has runs appends the next version (§12.4); one without runs is fixed in place.
 */
export function commitDraft(
  store: RecipeStore,
  draft: unknown,
  options: { newestHasRuns: boolean },
  registry: SkillRegistry = SKILLS,
): CommitOutcome {
  const checked = validateRecipe(draft, registry);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const versions = recipeVersions(store, checked.recipe.id);
  const newest = versions[versions.length - 1];
  if (newest && recipeContentKey(newest) === recipeContentKey(checked.recipe)) {
    return { ok: true, store, recipe: newest, changed: false, bumped: false };
  }
  const bump = Boolean(newest) && options.newestHasRuns;
  const outcome: SaveOutcome = saveRecipe(store, draft, { newVersion: bump }, registry);
  if (!outcome.ok) return { ok: false, errors: outcome.errors };
  return { ok: true, store: outcome.store, recipe: outcome.recipe, changed: true, bumped: bump };
}

// ----- trigger rows (the Form tab's "skill · output · op · value" lines, §12.4) -----

const isLeaf = (node: unknown): node is Condition =>
  isRecord(node) && !("all" in node) && !("any" in node) && !("not" in node);

/** The trigger as flat rows. Null when it nests (any/not or nested all), which only the JSON tab can edit. */
export function triggerRows(trigger: unknown): Condition[] | null {
  if (isLeaf(trigger)) return [trigger];
  if (isRecord(trigger) && Array.isArray(trigger.all) && trigger.all.every(isLeaf)) return [...(trigger.all as Condition[])];
  return null;
}

export function setTriggerRows(draft: Draft, rows: readonly Condition[]): Draft {
  return setIn(draft, ["trigger"], { all: [...rows] }) as Draft;
}

/** The output a row points at, looked up in the registry. Undefined if the skill or output is unknown. */
export function rowSpec(row: Condition, registry: SkillRegistry = SKILLS): { meta: SkillMeta; spec: OutputSpec } | undefined {
  const leaf = row as { skill?: unknown; out?: unknown };
  if (typeof leaf.skill !== "string" || typeof leaf.out !== "string") return undefined;
  const skill = getSkill(leaf.skill, registry);
  const spec = skill?.meta.outputs.find((o) => o.key === leaf.out);
  return skill && spec ? { meta: skill.meta, spec } : undefined;
}

export function opsFor(spec: OutputSpec | undefined): readonly ConditionOp[] {
  if (!spec) return [];
  if (spec.type === "number") return NUMBER_OPS;
  if (spec.type === "category") return CATEGORY_OPS;
  return BOOLEAN_OPS;
}

/** A new row for a skill output, with a sensible first operator and value. */
export function newRow(meta: SkillMeta, spec: OutputSpec): Condition {
  const base = { skill: meta.id, out: spec.key };
  if (spec.type === "boolean") return { ...base, op: "==", value: true } as Condition;
  if (spec.type === "category") return { ...base, op: "==", value: spec.categories?.[0] ?? "" } as Condition;
  return { ...base, op: ">=", value: spec.buckets?.[0] ?? 0 } as Condition;
}

/** Text shown in a row's value box. Lists join with ", ". Null and undefined show as empty. */
export function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Reads a row's value box for an operator. `between` and `in` take a comma list. Numbers that do not parse stay as
 * text, so the validator reports them with a path instead of the editor guessing a value.
 */
export function parseValueText(text: string, spec: OutputSpec, op: ConditionOp): Value | Value[] | undefined {
  const scalar = (raw: string): Value => {
    const trimmed = raw.trim();
    if (spec.type === "boolean") return trimmed === "true" ? true : trimmed === "false" ? false : trimmed;
    if (spec.type === "category") return trimmed;
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  };
  if (op === "between" || op === "in") {
    const items = text.split(",").map((s) => s.trim()).filter((s) => s !== "");
    return items.map(scalar) as Value[];
  }
  return scalar(text);
}
