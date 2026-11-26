import test from "node:test";
import assert from "node:assert/strict";
import { ownerManagePresets, validateManagePlan } from "../strategy-lab/manage.ts";
import { validateRecipe } from "../strategy-lab/recipe.ts";

function recipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "mogmine.strategy-recipe.v1",
    id: "old-recipe", name: "Old recipe", side: "long",
    window: { startEt: "09:30", endEt: "10:30" },
    trigger: { skill: "sessionClock", out: "minutesFromRthOpen", op: ">=", value: 0 },
    stop: { type: "points", points: 2 },
    target: { type: "rr", multiple: 2 },
    ...overrides,
  };
}

test("manage validator reports precise paths and fills JSON defaults", () => {
  const invalid = validateManagePlan({
    id: "bad", name: "Bad", rules: [{
      when: { kind: "candle", tf: "1h", pattern: "unknown" },
      then: { kind: "scaleOut", fraction: 1 }, once: "yes",
    }],
  });
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.deepEqual(invalid.errors.map((issue) => issue.path), [
    "rules[0].when.tf", "rules[0].when.pattern", "rules[0].then.fraction", "rules[0].once",
  ]);

  const valid = validateManagePlan({
    id: "trail", name: "Trail", rules: [{
      when: { kind: "profitR", atLeast: 1 },
      then: { kind: "stopTo", to: "breakeven" },
    }],
  });
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.plan.schema, "mogmine.manage-plan.v1");
  assert.equal(valid.plan.version, 1);
  assert.equal(valid.plan.rules[0].once, true);
  assert.deepEqual(valid.plan.rules[0].then, { kind: "stopTo", to: "breakeven", offsetTicks: 0 });
});

test("all eight owner presets validate and calls return fresh objects", () => {
  const first = ownerManagePresets();
  const second = ownerManagePresets();
  assert.equal(first.length, 8);
  first.forEach((preset) => assert.equal(validateManagePlan(preset).ok, true, preset.name));
  first[0].name = "edited";
  assert.equal(second[0].name, "Fixed bracket");
  assert.notEqual(first[1].rules, second[1].rules);
  const giveback = second.find((preset) => preset.id === "trail-30-giveback");
  assert.deepEqual(giveback?.rules[0].then, { kind: "trail", by: { mode: "givebackPct", pct: 30 } });
  const wick = second.find((preset) => preset.id === "trail-15m-wicks-half");
  assert.deepEqual(wick?.rules[0].then, { kind: "trail", by: { mode: "wick", tf: "15m", part: "half", ticks: 1 } });
});

test("recipe validation remains additive and target is required only for fixed management", () => {
  const old = validateRecipe(recipe());
  assert.equal(old.ok, true);
  if (old.ok) assert.equal(old.recipe.manage, null);

  const missingFixedTarget = validateRecipe(recipe({ target: undefined, manage: null }));
  assert.equal(missingFixedTarget.ok, false);
  if (!missingFixedTarget.ok) assert.equal(missingFixedTarget.errors.some((issue) => issue.path === "target"), true);

  const managed = validateRecipe(recipe({ target: undefined, manage: ownerManagePresets()[3] }));
  assert.equal(managed.ok, true);
  if (managed.ok) {
    assert.equal(managed.recipe.target, undefined);
    assert.equal(managed.recipe.manage?.schema, "mogmine.manage-plan.v1");
  }
});
