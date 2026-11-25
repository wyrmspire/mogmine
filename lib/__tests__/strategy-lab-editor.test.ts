import test from "node:test";
import assert from "node:assert/strict";
import {
  commitDraft, checkDraft, draftFromRecipe, draftToJson, getIn, issuesFor, newRecipeDraft, newRow, opsFor,
  parseDraftJson, parseValueText, rowSpec, setIn, setTriggerRows, sliceChoices, defaultSlices, toggleSlice,
  triggerRows, valueText, type Draft,
} from "../strategy-lab/recipe-draft.ts";
import { listSkills, SKILLS } from "../strategy-lab/registry.ts";
import { recipeVersions, type RecipeStore } from "../strategy-lab/recipes-store.ts";
import type { Condition, Recipe, SkillOutputRef } from "../strategy-lab/types.ts";

const EMPTY: RecipeStore = { recipes: [] };

// §5.3 example A, verbatim from docs/design-2026-11-24/09-strategy-lab.md.
const EXAMPLE_A = {
  schema: "mogmine.strategy-recipe.v1",
  id: "rcp-premarket-bottom", version: 1,
  name: "Premarket low as the bottom, 1m reclaim, RVOL",
  playbookId: "onl-sweep-smt",
  symbol: "MES", side: "long",
  window: { startEt: "07:00", endEt: "09:15" },
  trigger: { all: [
    { skill: "contextRanges", out: "overnightPosPct", op: "<=", value: 15 },
    { skill: "confirm1m", params: { lookbackBars: 15 }, out: "reclaim", op: "==", value: true },
    { skill: "rvol", params: { windowMinutes: 5, sessions: 10 }, out: "rvol", op: ">=", value: 1.3 },
  ]},
  entry: { at: "trigger-close" },
  stop: { type: "beyond-swing", ticks: 2, lookbackBars: 15, maxPoints: 10 },
  target: { type: "rr", multiple: 2 },
  maxHoldMinutes: 60, flatAtEt: "16:59",
  sizing: { mode: "risk-r", riskR: 0.25 },
  account: { accountId: null },
  slippageTicks: { stop: 1, market: 1 },
  dedupe: { maxPerSession: 1, cooldownMinutes: 30, oneAtATime: true },
  sliceBy: [
    { skill: "mtfCandle", params: { minutes: 15 }, out: "lowerWickPctile" },
    { skill: "structure5m", out: "structure" },
    { skill: "contextRanges", out: "weekPosPct" },
    { skill: "contextRanges", out: "pdcSide" },
    { skill: "rvol", params: { windowMinutes: 5, sessions: 10 }, out: "rvolBucket" },
    { skill: "volumeSpike", out: "spike" },
    { skill: "deltaProxy", out: "sign" },
  ],
  measure: { levelReach: ["vwap_globex", "onh", "pdc"], forwardMinutes: [15, 30, 60] },
};

function validRecipe(): Recipe {
  const checked = checkDraft(EXAMPLE_A);
  assert.ok(checked.ok, "example A must validate");
  return checked.recipe;
}

/** A draft with one valid trigger row, the minimum that validates. */
function draftWithOneRow(id = "rcp-test"): Draft {
  const draft = newRecipeDraft({ id, name: "Test recipe" });
  const { meta, spec } = rowSpecOf("contextRanges", "overnightPosPct");
  return setTriggerRows(draft, [newRow(meta, spec)]);
}

function rowSpecOf(skill: string, out: string) {
  const meta = listSkills().find((m) => m.id === skill);
  const spec = meta?.outputs.find((o) => o.key === out);
  assert.ok(meta && spec, `${skill}.${out} must exist in the registry`);
  return { meta, spec };
}

// ----- immutable paths -----

test("setIn returns a new tree and leaves the original untouched", () => {
  const original = { window: { startEt: "07:00" }, list: [{ a: 1 }] };
  const next = setIn(original, ["window", "startEt"], "08:00") as typeof original;
  assert.equal(next.window.startEt, "08:00");
  assert.equal(original.window.startEt, "07:00");
  const deeper = setIn(original, ["list", 0, "a"], 2) as typeof original;
  assert.equal(deeper.list[0]?.a, 2);
  assert.equal(original.list[0]?.a, 1);
  assert.equal(getIn(deeper, ["list", 0, "a"]), 2);
});

test("setIn creates missing objects and arrays along the path", () => {
  const made = setIn({}, ["trigger", "all", 0, "value"], 5) as Record<string, unknown>;
  assert.deepEqual(made, { trigger: { all: [{ value: 5 }] } });
});

// ----- round trips -----

test("form to JSON to form is lossless", () => {
  const draft = draftWithOneRow();
  const edited = setIn(draft, ["stop", "points"], 6) as Draft;
  const text = draftToJson(edited);
  const parsed = parseDraftJson(text);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.draft, edited, "the JSON tab must show exactly what the form holds");
  assert.equal(draftToJson(parsed.draft), text, "a second serialise is byte-identical");
});

test("a stored recipe survives draft and JSON round trip with the same content", () => {
  const recipe = validRecipe();
  const text = draftToJson(draftFromRecipe(recipe));
  const parsed = parseDraftJson(text);
  assert.ok(parsed.ok);
  const checked = checkDraft(parsed.draft);
  assert.ok(checked.ok);
  assert.deepEqual(checked.recipe, recipe);
});

test("a JSON edit becomes the next draft, and the form reads it back", () => {
  const recipe = validRecipe();
  const text = draftToJson(draftFromRecipe(recipe)).replace('"name": "Premarket low as the bottom, 1m reclaim, RVOL"', '"name": "Renamed in JSON"');
  const parsed = parseDraftJson(text);
  assert.ok(parsed.ok);
  assert.equal(getIn(parsed.draft, ["name"]), "Renamed in JSON");
  assert.equal(triggerRows(parsed.draft.trigger)?.length, 3);
});

test("trigger rows read back from the JSON tab, and nested triggers stay JSON-only", () => {
  const rows = triggerRows(EXAMPLE_A.trigger);
  assert.equal(rows?.length, 3);
  assert.equal(triggerRows({ all: [{ all: [] }] }), null);
  assert.equal(triggerRows({ not: { skill: "rvol", out: "rvol", op: ">=", value: 1 } }), null);
  const single = triggerRows({ skill: "rvol", out: "rvol", op: ">=", value: 1 });
  assert.equal(single?.length, 1, "a bare leaf reads as one row");
});

// ----- validator errors with paths -----

test("an empty trigger reports its path", () => {
  const checked = checkDraft(newRecipeDraft({ id: "rcp-empty" }));
  assert.equal(checked.ok, false);
  if (checked.ok) return;
  assert.ok(checked.errors.some((e) => e.path === "trigger.all"), JSON.stringify(checked.errors));
});

test("a bad comparison value points at trigger.all[n].value", () => {
  const draft = setTriggerRows(newRecipeDraft({ id: "rcp-bad-value" }), [
    { skill: "contextRanges", out: "overnightPosPct", op: "==", value: "low" } as Condition,
  ]);
  const checked = checkDraft(draft);
  assert.equal(checked.ok, false);
  if (checked.ok) return;
  assert.ok(checked.errors.some((e) => e.path === "trigger.all[0].value"), JSON.stringify(checked.errors));
});

test("an unknown output points at trigger.all[n].out and an unknown skill at .skill", () => {
  const badOut = setTriggerRows(newRecipeDraft({ id: "rcp-bad-out" }), [
    { skill: "rvol", out: "nope", op: ">=", value: 1 } as Condition,
  ]);
  const badSkill = setTriggerRows(newRecipeDraft({ id: "rcp-bad-skill" }), [
    { skill: "notASkill", out: "x", op: ">=", value: 1 } as Condition,
  ]);
  const outErrors = checkDraft(badOut);
  const skillErrors = checkDraft(badSkill);
  assert.ok(!outErrors.ok && outErrors.errors.some((e) => e.path === "trigger.all[0].out"));
  assert.ok(!skillErrors.ok && skillErrors.errors.some((e) => e.path === "trigger.all[0].skill"));
});

test("a measure skill in the trigger is rejected at its skill path", () => {
  const measure = listSkills().find((m) => m.kind === "measure");
  assert.ok(measure, "an M-series measure must be registered");
  const output = measure.outputs[0];
  assert.ok(output);
  const draft = setTriggerRows(newRecipeDraft({ id: "rcp-measure" }), [
    { skill: measure.id, out: output.key, op: "==", value: true } as Condition,
  ]);
  const checked = checkDraft(draft);
  assert.ok(!checked.ok && checked.errors.some((e) => e.path === "trigger.all[0].skill" && /measure/.test(e.message)));
});

test("bad stop, window and sizing fields report their own paths", () => {
  const draft = setIn(
    setIn(draftWithOneRow("rcp-fields"), ["window", "startEt"], "7am") as Draft,
    ["sizing", "riskR"], -1,
  ) as Draft;
  const stopped = setIn(draft, ["stop"], { type: "points", points: 0 }) as Draft;
  const checked = checkDraft(stopped);
  assert.ok(!checked.ok);
  if (checked.ok) return;
  const paths = checked.errors.map((e) => e.path);
  assert.ok(paths.includes("window.startEt"), paths.join(", "));
  assert.ok(paths.includes("sizing"), paths.join(", "));
  assert.ok(paths.includes("stop.points"), paths.join(", "));
  assert.equal(issuesFor(checked.errors, "window").length, 1);
});

test("bad JSON and a non-object root report the whole document as path \"\"", () => {
  const broken = parseDraftJson("{ \"name\": ");
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.errors[0]?.path, "");
  const array = parseDraftJson("[1, 2]");
  assert.equal(array.ok, false);
  if (!array.ok) assert.equal(array.errors[0]?.path, "");
});

// ----- version bump on edit after a run (§12.4) -----

test("a new recipe starts at version 1", () => {
  const outcome = commitDraft(EMPTY, draftWithOneRow("rcp-new"), { newestHasRuns: false }, SKILLS);
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.equal(outcome.recipe.version, 1);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.bumped, false);
});

test("editing a recipe with no runs fixes version 1 in place", () => {
  const first = commitDraft(EMPTY, draftWithOneRow("rcp-fix"), { newestHasRuns: false });
  assert.ok(first.ok);
  if (!first.ok) return;
  const edited = setIn(draftWithOneRow("rcp-fix"), ["name"], "Renamed") as Draft;
  const second = commitDraft(first.store, edited, { newestHasRuns: false });
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.bumped, false);
  assert.equal(recipeVersions(second.store, "rcp-fix").length, 1);
  assert.equal(second.recipe.name, "Renamed");
});

test("editing a recipe that has runs appends the next version and keeps the old one", () => {
  const first = commitDraft(EMPTY, draftWithOneRow("rcp-bump"), { newestHasRuns: false });
  assert.ok(first.ok);
  if (!first.ok) return;
  const oldVersion = first.recipe;
  const edited = setIn(draftWithOneRow("rcp-bump"), ["name"], "After a run") as Draft;
  const bumped = commitDraft(first.store, edited, { newestHasRuns: true });
  assert.ok(bumped.ok);
  if (!bumped.ok) return;
  assert.equal(bumped.bumped, true);
  assert.equal(bumped.recipe.version, 2);
  const versions = recipeVersions(bumped.store, "rcp-bump");
  assert.deepEqual(versions.map((r) => r.version), [1, 2]);
  assert.deepEqual(versions[0], oldVersion, "v1 is kept exactly as it was run");
});

test("saving an unchanged recipe after a run does not bump the version", () => {
  const first = commitDraft(EMPTY, draftWithOneRow("rcp-same"), { newestHasRuns: false });
  assert.ok(first.ok);
  if (!first.ok) return;
  const again = commitDraft(first.store, draftWithOneRow("rcp-same"), { newestHasRuns: true });
  assert.ok(again.ok);
  if (!again.ok) return;
  assert.equal(again.changed, false);
  assert.equal(again.bumped, false);
  assert.equal(again.recipe.version, 1);
  assert.equal(again.store, first.store);
});

test("an invalid draft is refused with path errors and the store is untouched", () => {
  const first = commitDraft(EMPTY, draftWithOneRow("rcp-invalid"), { newestHasRuns: false });
  assert.ok(first.ok);
  if (!first.ok) return;
  const broken = setIn(draftWithOneRow("rcp-invalid"), ["side"], "sideways") as Draft;
  const outcome = commitDraft(first.store, broken, { newestHasRuns: true });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.ok(outcome.errors.some((e) => e.path === "side"));
  assert.equal(first.store.recipes.length, 1);
});

// ----- form helpers -----

test("operators follow the output type (§5.2)", () => {
  const number = rowSpecOf("contextRanges", "overnightPosPct").spec;
  const boolean = rowSpecOf("confirm1m", "reclaim").spec;
  assert.ok(opsFor(number).includes("between"));
  assert.ok(opsFor(number).includes("crossesAbove"));
  assert.deepEqual([...opsFor(boolean)], ["==", "!="]);
  assert.deepEqual([...opsFor(undefined)], []);
});

test("row values parse by type and keep bad numbers as text for the validator", () => {
  const number = rowSpecOf("contextRanges", "overnightPosPct").spec;
  const boolean = rowSpecOf("confirm1m", "reclaim").spec;
  assert.equal(parseValueText("1.5", number, ">="), 1.5);
  assert.equal(parseValueText("", number, ">="), null);
  assert.equal(parseValueText("abc", number, ">="), "abc");
  assert.deepEqual(parseValueText("2, 4", number, "between"), [2, 4]);
  assert.equal(parseValueText("true", boolean, "=="), true);
  assert.equal(valueText([2, 4]), "2, 4");
  assert.equal(valueText(null), "");
});

test("a row resolves to its skill output through getSkill", () => {
  const row = { skill: "rvol", out: "rvol", op: ">=", value: 1.3 } as Condition;
  const found = rowSpec(row, SKILLS);
  assert.equal(found?.meta.id, "rvol");
  assert.equal(found?.spec.key, "rvol");
  assert.equal(rowSpec({ skill: "rvol", out: "nope", op: ">=", value: 1 } as Condition, SKILLS), undefined);
});

test("slice chips: volume outputs are pre-selected, toggling is symmetric and capped at 12", () => {
  const choices = sliceChoices(SKILLS);
  assert.ok(choices.length > 0);
  assert.ok(choices.every((c) => c.spec.type === "category" || (c.spec.buckets?.length ?? 0) > 0));
  const defaults = defaultSlices(SKILLS);
  assert.ok(defaults.length > 0 && defaults.length <= 12);
  const volumeSkills = new Set(choices.filter((c) => c.volume).map((c) => c.skill));
  assert.ok(defaults.every((s) => volumeSkills.has(s.skill)));

  const choice = choices[0];
  assert.ok(choice);
  const on = toggleSlice([], choice);
  assert.equal(on.length, 1);
  assert.deepEqual(toggleSlice(on, choice), []);

  let full: SkillOutputRef[] = [];
  for (let n = 0; n < 15; n += 1) {
    const other = { ...choice, skill: `x${n}`, out: "y" };
    full = toggleSlice(full, other);
  }
  assert.equal(full.length, 12, "adding past 12 slices is ignored");
});

test("a new draft with one row and the default slices validates as a version 1 recipe", () => {
  const checked = checkDraft(draftWithOneRow("rcp-defaults"));
  assert.ok(checked.ok, JSON.stringify(!checked.ok ? checked.errors : []));
  if (!checked.ok) return;
  assert.equal(checked.recipe.version, 1);
  assert.equal(checked.recipe.sliceBy.length, defaultSlices(SKILLS).length);
});
