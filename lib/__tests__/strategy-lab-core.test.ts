import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../strategy-lab/aggregate.ts";
import { compareCondition, evaluateCondition } from "../strategy-lab/conditions.ts";
import { createSkillRegistry, getSkill, listSkills } from "../strategy-lab/registry.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import type {
  Condition, LabLevel, Skill, SkillContext, SkillMeta, SourceBar, Value,
} from "../strategy-lab/types.ts";
import { assertNoLookahead } from "./strategy-lab-lookahead-harness.ts";

function barsAt(start: number, count: number, volume = 100): SourceBar[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * 60_000,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume,
  }));
}

const emptyLevels = (asOf: number) => ({
  asOf,
  levels: [] as LabLevel[],
  byKey: new Map(),
});

function context(series: ReturnType<typeof buildBarSeries>, i: number): SkillContext {
  return {
    series,
    i,
    params: {},
    spec: { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 },
    rSizeUsd: 300,
    levels: emptyLevels(series.time[i] + series.barMs),
  };
}

function meta(id: string, version = "1.0.0", kind: SkillMeta["kind"] = "feature"): SkillMeta {
  return {
    id, version, kind, title: id, description: id, status: "active", params: [],
    outputs: [{ key: "value", type: "number", label: "Value" }],
    needs: { baseTimeframe: "1m", lookbackMinutes: 0, volume: false },
    knownAt: kind === "measure" ? "after-entry" : "bar-close",
  };
}

function closeSkill(id = "close", version = "1.0.0"): Skill {
  return {
    meta: meta(id, version),
    preflight: ({ i, series }) => i >= 0 && i < series.close.length
      ? { ok: true }
      : { ok: false, reason: "warmup", detail: "No bar" },
    compute: ({ i, series }) => ({ ok: true, values: { value: series.close[i] } }),
  };
}

test("BarSeries drops duplicate and invalid OHLC rows and maps zero volume to NaN", () => {
  const start = Date.parse("2026-07-13T13:30:00Z");
  const source = barsAt(start, 3);
  source[0].volume = 0;
  source.push({ ...source[1] });
  source.push({ ...source[2], time: start + 3 * 60_000, low: source[2].open + 1 });

  const series = buildBarSeries("MES", source);
  assert.equal(series.time.length, 2, "both rows at a duplicate timestamp are discarded");
  assert.equal(series.dropped.duplicates, 2);
  assert.equal(series.dropped.invalid, 1);
  assert.equal(Number.isNaN(series.volume[0]), true);
  assert.equal(series.byTime.get(start), 0);
  assert.equal(series.sessions[0].droppedDuplicates, 2);
  assert.equal(series.sessions[0].droppedInvalid, 1);
});

test("ET minute is America/New_York-correct on both sides of DST", () => {
  const summer = buildBarSeries("MES", barsAt(Date.parse("2026-07-13T13:30:00Z"), 1));
  const winter = buildBarSeries("MES", barsAt(Date.parse("2026-12-14T14:30:00Z"), 1));
  assert.equal(summer.etMinute[0], 9 * 60 + 30);
  assert.equal(winter.etMinute[0], 9 * 60 + 30);
  assert.equal(summer.sessionDate[0], "2026-07-13");
  assert.equal(winter.sessionDate[0], "2026-12-14");
});

test("15m aggregation is ET-aligned, exact, and labels a partial bucket forming", () => {
  const source = barsAt(Date.parse("2026-07-13T13:00:00Z"), 15);
  source[0] = { ...source[0], open: 100, low: 98, close: 100.5 };
  source[14] = { ...source[14], high: 120, close: 119 };
  const series = buildBarSeries("MES", source);

  const forming = aggregate(series, 7, 15);
  assert.deepEqual(
    forming && { open: forming.open, high: forming.high, low: forming.low, close: forming.close,
      volume: forming.volume, expected: forming.expected, present: forming.present, forming: forming.forming },
    { open: 100, high: 109, low: 98, close: 108, volume: 800, expected: 8, present: 8, forming: true },
  );

  const completed = aggregate(series, 14, 15);
  assert.equal(completed?.forming, false);
  assert.equal(completed?.expected, 15);
  assert.equal(completed?.present, 15);
  assert.equal(completed?.high, 120);
  assert.equal(completed?.close, 119);
});

test("aggregation preserves gaps and marks aggregate volume missing", () => {
  const start = Date.parse("2026-07-13T13:00:00Z");
  const source = barsAt(start, 8).filter((_, i) => i !== 3);
  source[2].volume = 0;
  const series = buildBarSeries("MES", source);
  const result = aggregate(series, series.time.length - 1, 15);
  assert.equal(result?.expected, 8);
  assert.equal(result?.present, 7);
  assert.equal(result?.volumeMissing, 1);
  assert.equal(Number.isNaN(result?.volume), true);
});

test("condition scalar operators, inclusive between, and in use typed values", () => {
  assert.equal(compareCondition(2, "==", 2), true);
  assert.equal(compareCondition(2, "!=", 3), true);
  assert.equal(compareCondition(2, "<", 3), true);
  assert.equal(compareCondition(2, "<=", 2), true);
  assert.equal(compareCondition(3, ">", 2), true);
  assert.equal(compareCondition(3, ">=", 3), true);
  assert.equal(compareCondition(2, "between", [2, 4]), true);
  assert.equal(compareCondition(4, "between", [2, 4]), true);
  assert.equal(compareCondition("up", "in", ["down", "up"]), true);
  assert.equal(compareCondition(null, ">", 0), false);
});

test("conditions compose in order and crossesAbove requires consecutive one-minute bars", () => {
  const start = Date.parse("2026-07-13T13:00:00Z");
  const source = barsAt(start, 3);
  source[0].close = 99;
  source[1].close = 100;
  source[2].close = 101;
  const series = buildBarSeries("MES", source);
  const registry = createSkillRegistry([closeSkill()]);
  const crosses: Condition = { skill: "close", out: "value", op: "crossesAbove", value: 100 };
  assert.equal(evaluateCondition(crosses, context(series, 1), registry).passed, true);

  const nested: Condition = { all: [
    { skill: "close", out: "value", op: ">=", value: 100 },
    { any: [
      { skill: "close", out: "value", op: "==", value: 50 },
      { not: { skill: "close", out: "value", op: "<", value: 100 } },
    ] },
  ] };
  assert.equal(evaluateCondition(nested, context(series, 1), registry).passed, true);

  const gapped = buildBarSeries("MES", [source[0], { ...source[2], time: start + 2 * 60_000 }]);
  assert.equal(evaluateCondition(crosses, context(gapped, 1), registry).passed, false);
});

test("a skipped skill is false and its typed reason is counted at the condition path", () => {
  const series = buildBarSeries("MES", barsAt(Date.parse("2026-07-13T13:00:00Z"), 1));
  const skipped: Skill = {
    meta: meta("rvol"),
    preflight: () => ({ ok: false, reason: "warmup", detail: "Need prior sessions" }),
    compute: () => { throw new Error("compute must not run after failed preflight"); },
  };
  const result = evaluateCondition(
    { skill: "rvol", out: "value", op: ">=", value: 1.3 },
    context(series, 0),
    createSkillRegistry([skipped]),
  );
  assert.equal(result.passed, false);
  assert.deepEqual(result.skips, { trigger: { warmup: 1 } });

  const negated = evaluateCondition(
    { not: { skill: "rvol", out: "value", op: ">=", value: 1.3 } },
    context(series, 0),
    createSkillRegistry([skipped]),
  );
  assert.equal(negated.passed, false, "not must not turn unavailable evidence into a match");
  assert.deepEqual(negated.skips, { "trigger.not": { warmup: 1 } });
});

test("registry pins major versions, resolves latest major, and lists metadata for agents", () => {
  const v1 = closeSkill("price", "1.2.0");
  const v2 = closeSkill("price", "2.0.0");
  const other = closeSkill("clock", "1.0.0");
  const registry = createSkillRegistry([v1, v2, other]);
  assert.equal(getSkill("price@1", registry), v1);
  assert.equal(getSkill("price", registry), v2);
  assert.deepEqual(listSkills(registry).map(({ id, version }) => `${id}@${version}`), [
    "clock@1.0.0", "price@1.2.0", "price@2.0.0",
  ]);
});

test("known-at harness proves registered feature values do not change when future bars are removed", () => {
  const series = buildBarSeries("MES", barsAt(Date.parse("2026-07-13T13:00:00Z"), 5));
  const skill = closeSkill();
  assertNoLookahead(skill, context(series, 2));
});

test("condition params are passed as Value records", () => {
  const series = buildBarSeries("MES", barsAt(Date.parse("2026-07-13T13:00:00Z"), 1));
  const echo: Skill = {
    meta: meta("echo"),
    preflight: () => ({ ok: true }),
    compute: ({ params }) => ({ ok: true, values: { value: params.threshold as Value } }),
  };
  const result = evaluateCondition(
    { skill: "echo", params: { threshold: 7 }, out: "value", op: "==", value: 7 },
    context(series, 0), createSkillRegistry([echo]),
  );
  assert.equal(result.passed, true);
});

test("condition nesting deeper than three is rejected and counted as bad params", () => {
  const series = buildBarSeries("MES", barsAt(Date.parse("2026-07-13T13:00:00Z"), 1));
  const leaf: Condition = { skill: "close", out: "value", op: ">", value: 0 };
  const tooDeep: Condition = { all: [{ all: [{ all: [{ all: [leaf] }] }] }] };
  const result = evaluateCondition(tooDeep, context(series, 0), createSkillRegistry([closeSkill()]));
  assert.equal(result.passed, false);
  assert.deepEqual(result.skips, { "trigger.all[0].all[0].all[0].all[0]": { "bad-params": 1 } });
});
