import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition } from "../strategy-lab/conditions.ts";
import { labRSize, rBasisLabel } from "../strategy-lab/r.ts";
import { createSkillRegistry } from "../strategy-lab/registry.ts";
import { buildBarSeries, truncateSeries } from "../strategy-lab/series.ts";
import {
  bracketOutcome, forwardReturn, levelReach, measureBracket,
  type Bracket, type BracketResult,
} from "../strategy-lab/skills/measure.ts";
import type {
  BarSeries, LabLevel, LevelBook, LevelKey, Outcome, SkillContext, SourceBar, Value,
} from "../strategy-lab/types.ts";

// Prices are MES (tick 0.25, $5 per point, $1.25 per tick). T0 is 10:00 America/New_York on 13 Jul 2026.
const BAR_MS = 60_000;
const T0 = Date.parse("2026-07-13T14:00:00Z");
const SPEC = { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 };

type Row = [open: number, high: number, low: number, close: number];

function seriesOf(rows: readonly Row[], start = T0): BarSeries {
  return buildBarSeries("MES", rows.map(([open, high, low, close], n) => ({
    time: start + n * BAR_MS, open, high, low, close, volume: 1000,
  })));
}

/** Rows at explicit minute offsets from T0, so gaps can be placed on purpose. */
function seriesAt(entries: readonly (readonly [number, Row])[]): BarSeries {
  const bars: SourceBar[] = entries.map(([minute, [open, high, low, close]]) => ({
    time: T0 + minute * BAR_MS, open, high, low, close, volume: 1000,
  }));
  return buildBarSeries("MES", bars);
}

function emptyBook(asOf: number): LevelBook {
  return { asOf, levels: [], byKey: new Map() };
}

function bookWith(asOf: number, entries: readonly Pick<LabLevel, "key" | "value" | "availableAt">[]): LevelBook {
  const levels: LabLevel[] = entries.map((entry) => ({ ...entry }));
  return { asOf, levels, byKey: new Map(levels.map((level) => [level.key as LevelKey, level])) };
}

function ctxFor(series: BarSeries, i: number, params: Record<string, Value>, levels = emptyBook(0)): SkillContext {
  return { series, i, params, spec: SPEC, rSizeUsd: 300, levels };
}

function outcomeOf(result: BracketResult): Outcome {
  if (!result.ok) assert.fail(result.detail);
  return result.outcome;
}

function near(actual: number, expected: number, message = "") {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message} expected ${expected}, got ${actual}`);
}

// Long from 100.00 (400 ticks): stop 99.00 (396 ticks, 4 ticks behind), target 101.00 (404 ticks), 2 contracts.
const LONG_HOLD_3: Bracket = {
  side: "long", stop: 99, target: 101, qty: 2, stopSlippageTicks: 1, marketSlippageTicks: 1,
  maxHoldMinutes: 3, flatMinuteEt: 1019,
};
const mirror = (rows: readonly Row[]): Row[] => rows.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c]);

test("entry bar is never inside the hold (R-POST-1): its low below the stop does not stop the trade", () => {
  const series = seriesOf([
    [100, 100.25, 98, 100], // trigger bar: low 98 is below the stop and must be ignored
    [100, 100.5, 99.5, 100.25],
    [100.25, 100.75, 99.75, 100.5],
    [100.5, 100.75, 99.75, 100.5],
  ]);
  const outcome = outcomeOf(measureBracket(series, 0, LONG_HOLD_3, SPEC, 300));
  assert.equal(outcome.exitReason, "time");
  assert.equal(outcome.exitTime, T0 + 4 * BAR_MS, "exit at the close of the bar that ends the 3-minute hold");
  near(outcome.minutesToExit, 3);
  near(outcome.pnlPoints, 0.25);
  near(outcome.pnlUsd, 2.5);
  near(outcome.resultR, 2.5 / 300);
  near(outcome.riskMultiple, 0.25);
  // MFE and MAE come only from bars after the entry: the trigger bar's 98 low would give MAE -8 points.
  near(outcome.mfePoints, 0.75);
  near(outcome.maePoints, -0.5);
  near(outcome.mfeR, 750 / 30000);
  near(outcome.maeR, -500 / 30000);
  assert.equal(outcome.minutesToTarget, null);
});

test("a stop hit exits at the stop less stop slippage, and a loser's R and × risk are separate numbers", () => {
  const series = seriesOf([
    [100, 100.25, 99.75, 100],
    [100, 100.25, 98.75, 99.25], // low 98.75 is through the 99.00 stop
  ]);
  const outcome = outcomeOf(measureBracket(series, 0, LONG_HOLD_3, SPEC, 300));
  assert.equal(outcome.exitReason, "stop");
  // Exit at 396 − 1 tick = 395; 395 − 400 = −5 ticks = −1.25 points = −$12.50 for 2 contracts.
  near(outcome.pnlPoints, -1.25);
  near(outcome.pnlUsd, -12.5);
  near(outcome.resultR, -12.5 / 300);
  near(outcome.riskMultiple, -1.25, "× risk is P&L ÷ stop distance (5 ticks ÷ 4 ticks), not R");
  near(outcome.minutesToExit, 1);
  near(outcome.mfePoints, 0.25);
  near(outcome.maePoints, -1.25);
});

test("a stop and a target inside the same bar is ambiguous and counts as the stop", () => {
  const series = seriesOf([
    [100, 100.25, 99.75, 100],
    [100, 101.5, 98.5, 100], // high through the target, low through the stop
  ]);
  const outcome = outcomeOf(measureBracket(series, 0, LONG_HOLD_3, SPEC, 300));
  assert.equal(outcome.exitReason, "ambiguous-stop");
  near(outcome.pnlPoints, -1.25, "exit at the stop less one tick of slippage");
  assert.equal(outcome.minutesToTarget, null);
});

test("a target exits at the limit with no slippage", () => {
  const series = seriesOf([
    [100, 100.25, 99.75, 100],
    [100, 101.25, 99.75, 101], // high 101.25 through the 101.00 target; low never reaches the stop
  ]);
  const outcome = outcomeOf(measureBracket(series, 0, LONG_HOLD_3, SPEC, 300));
  assert.equal(outcome.exitReason, "target");
  near(outcome.pnlPoints, 1, "target fill is at the limit, no slippage");
  near(outcome.pnlUsd, 10);
  near(outcome.riskMultiple, 1);
  near(outcome.minutesToTarget ?? Number.NaN, 1);
  near(outcome.mfePoints, 1.25);
  near(outcome.maePoints, -0.25);
});

test("flat time exits at the close of the bar that ends on the flat minute, reported as session-end", () => {
  // 15:50 ET trigger; flat at 15:53 ET. The bar 15:52 closes at 15:53.
  const start = Date.parse("2026-07-13T19:50:00Z");
  const series = seriesOf([
    [100, 100.25, 99.75, 100],
    [100, 100.25, 99.75, 100],
    [100.25, 100.5, 99.75, 100.5],
  ], start);
  const outcome = outcomeOf(measureBracket(series, 0, { ...LONG_HOLD_3, maxHoldMinutes: 60, flatMinuteEt: 953 }, SPEC, 300));
  assert.equal(outcome.exitReason, "session-end");
  assert.equal(outcome.exitTime, Date.parse("2026-07-13T19:53:00Z"));
  near(outcome.minutesToExit, 2);
  near(outcome.pnlPoints, 0.25, "close 100.50 less one tick of market slippage");
});

test("a gap longer than 15 minutes inside the hold is coverage; a shorter gap is skipped", () => {
  const longGap = seriesAt([
    [0, [100, 100.25, 99.75, 100]],
    [20, [100, 100.25, 98.75, 99.25]],
  ]);
  const longResult = measureBracket(longGap, 0, { ...LONG_HOLD_3, maxHoldMinutes: 60 }, SPEC, 300);
  assert.equal(longResult.ok, false);
  if (!longResult.ok) assert.equal(longResult.reason, "coverage");

  const shortGap = seriesAt([
    [0, [100, 100.25, 99.75, 100]],
    [5, [100, 100.25, 98.75, 99.25]], // 5-minute gap is skipped; the stop is still found
  ]);
  const outcome = outcomeOf(measureBracket(shortGap, 0, { ...LONG_HOLD_3, maxHoldMinutes: 60 }, SPEC, 300));
  assert.equal(outcome.exitReason, "stop");
  near(outcome.minutesToExit, 5);
});

test("short is the exact mirror of long: the same bars reflected around the entry give the same result", () => {
  const stopRows: Row[] = [
    [100, 100.25, 99.75, 100],
    [100, 100.25, 98.75, 99.25],
  ];
  const targetRows: Row[] = [
    [100, 100.25, 99.75, 100],
    [100, 101.25, 99.75, 101],
  ];
  const shortOf = (stop: number, target: number): Bracket => ({ ...LONG_HOLD_3, side: "short", stop, target });

  const longStop = outcomeOf(measureBracket(seriesOf(stopRows), 0, LONG_HOLD_3, SPEC, 300));
  const shortStop = outcomeOf(measureBracket(seriesOf(mirror(stopRows)), 0, shortOf(101, 99), SPEC, 300));
  assert.deepEqual(shortStop, longStop);

  const longTarget = outcomeOf(measureBracket(seriesOf(targetRows), 0, LONG_HOLD_3, SPEC, 300));
  const shortTarget = outcomeOf(measureBracket(seriesOf(mirror(targetRows)), 0, shortOf(101, 99), SPEC, 300));
  assert.deepEqual(shortTarget, longTarget);
  assert.equal(shortTarget.exitReason, "target");
});

test("R is the fixed account size: $300 and $250 change resultR, never the P&L or the stop-based multiple", () => {
  const series = seriesOf([
    [100, 100.25, 99.75, 100],
    [100, 101.25, 99.75, 101],
  ]);
  const at300 = outcomeOf(measureBracket(series, 0, LONG_HOLD_3, SPEC, 300));
  const at250 = outcomeOf(measureBracket(series, 0, LONG_HOLD_3, SPEC, 250));
  near(at300.pnlUsd, 10);
  near(at250.pnlUsd, 10);
  near(at300.resultR, 10 / 300);
  near(at250.resultR, 10 / 250);
  near(at300.riskMultiple, at250.riskMultiple ?? Number.NaN);
  near(at300.riskMultiple, 1);
});

test("riskMultiple has its own output label and never shares R's", () => {
  const outputs = bracketOutcome.meta.outputs;
  const riskMultiple = outputs.find((output) => output.key === "riskMultiple");
  const resultR = outputs.find((output) => output.key === "resultR");
  assert.ok(riskMultiple?.label.includes("not R"), riskMultiple?.label);
  assert.equal(resultR?.unit, "r");
  assert.equal(riskMultiple?.unit, "ratio");
  assert.equal(bracketOutcome.meta.knownAt, "after-entry");
  assert.equal(bracketOutcome.meta.kind, "measure");
});

test("invalid brackets are rejected: wrong side, off-grid target, zero size, zero R, and missing parameters", () => {
  const series = seriesOf([[100, 100.25, 99.75, 100], [100, 101.25, 99.75, 101]]);
  const cases: [string, Bracket, number][] = [
    ["stop above the entry for a long", { ...LONG_HOLD_3, stop: 100.5 }, 300],
    ["target off the 0.25 grid", { ...LONG_HOLD_3, target: 100.6 }, 300],
    ["zero contracts", { ...LONG_HOLD_3, qty: 0 }, 300],
    ["zero R size", LONG_HOLD_3, 0],
  ];
  for (const [label, bracket, rSize] of cases) {
    const result = measureBracket(series, 0, bracket, SPEC, rSize);
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.equal(result.reason, "bad-params", label);
  }
  const missing = bracketOutcome.compute(ctxFor(series, 0, {}));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "bad-params");
});

test("no bars after the trigger is coverage, not a zero result", () => {
  const series = seriesOf([[100, 100.25, 99.75, 100]]);
  const result = measureBracket(series, 0, LONG_HOLD_3, SPEC, 300);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "coverage");
});

test("lookahead harness: the outcome never reads a bar after its exit", () => {
  const series = seriesOf([
    [100, 100.25, 98, 100],
    [100, 100.5, 99.5, 100.25],
    [100.25, 100.75, 99.75, 100.5],
    [100.5, 100.75, 99.75, 100.5],
    [100.5, 101.5, 90, 101], // poison bar after the exit: a stop and a target
  ]);
  const outcome = outcomeOf(measureBracket(series, 0, LONG_HOLD_3, SPEC, 300));
  const exitIndex = series.byTime.get(outcome.exitTime - BAR_MS);
  assert.equal(exitIndex, 3);
  assert.deepEqual(outcomeOf(measureBracket(truncateSeries(series, exitIndex ?? 0), 0, LONG_HOLD_3, SPEC, 300)), outcome);
  const early = measureBracket(truncateSeries(series, 2), 0, LONG_HOLD_3, SPEC, 300);
  assert.equal(early.ok, false, "the walk does need bar 3 to close the hold");
});

test("lookahead harness: bars at or before the trigger, including its range, do not change the outcome", () => {
  const rows: Row[] = [
    [50, 150, 40, 60],
    [100, 100.25, 98, 100], // trigger bar at index 1
    [100, 100.5, 99.5, 100.25],
    [100.25, 100.5, 99.75, 100.5],
    [100.5, 100.75, 99.75, 100.5],
  ];
  const holdTwo = { ...LONG_HOLD_3, maxHoldMinutes: 2 };
  const original = outcomeOf(measureBracket(seriesOf(rows, T0 - BAR_MS), 1, holdTwo, SPEC, 300));
  const mutated: Row[] = [
    [10, 500, 1, 10],
    [100, 500, 1, 100],
    ...rows.slice(2),
  ];
  assert.deepEqual(outcomeOf(measureBracket(seriesOf(mutated, T0 - BAR_MS), 1, holdTwo, SPEC, 300)), original);
});

test("levelReach: reached on the bar that touches the level, with minutes from the decision", () => {
  const series = seriesOf([
    [100, 100.25, 99.75, 100],
    [100, 100.5, 99.75, 100.25],
    [100.25, 100.75, 99.75, 100.5], // high 100.75 touches the pdh
  ]);
  const levels = bookWith(T0, [{ key: "pdh", value: 100.75, availableAt: T0 - BAR_MS }]);
  const params = { side: "long", stop: 99, level: "pdh", maxHoldMinutes: 60, flatMinuteEt: 1019 };
  const result = levelReach.compute(ctxFor(series, 0, params, levels));
  assert.deepEqual(result, {
    ok: true,
    values: { levelPrice: 100.75, levelOnTargetSide: true, reached: true, minutesToReach: 2 },
  });
  // Bars after the touch are never read.
  assert.deepEqual(levelReach.compute(ctxFor(truncateSeries(series, 2), 0, params, levels)), result);
});

test("levelReach: a level reached only after the stop is not reached, and a stop in the touch bar wins", () => {
  const levels = bookWith(T0, [{ key: "pdh", value: 100.75, availableAt: T0 - BAR_MS }]);
  const params = { side: "long", stop: 99, level: "pdh", maxHoldMinutes: 60, flatMinuteEt: 1019 };
  const afterStop = seriesOf([
    [100, 100.25, 99.75, 100],
    [100, 100.25, 98.75, 99.25], // stop first
    [100.25, 100.75, 99.75, 100.5], // touches the level later: must not count
  ]);
  const stopFirst = levelReach.compute(ctxFor(afterStop, 0, params, levels));
  assert.deepEqual(stopFirst, { ok: true, values: { levelPrice: 100.75, levelOnTargetSide: true, reached: false, minutesToReach: null } });

  const sameBar = seriesOf([
    [100, 100.25, 99.75, 100],
    [100, 100.75, 98.75, 100], // touch and stop in one bar: the stop counts
  ]);
  const same = levelReach.compute(ctxFor(sameBar, 0, params, levels));
  assert.deepEqual(same, { ok: true, values: { levelPrice: 100.75, levelOnTargetSide: true, reached: false, minutesToReach: null } });
});

test("levelReach: missing, not-yet-known and wrong-side levels are reported, never guessed", () => {
  const series = seriesOf([[100, 100.25, 99.75, 100], [100, 100.5, 99.75, 100.25]]);
  const params = { side: "long", stop: 99, level: "pdh", maxHoldMinutes: 60, flatMinuteEt: 1019 };

  const missing = levelReach.compute(ctxFor(series, 0, params, emptyBook(T0)));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "no-level");

  const later = bookWith(T0, [{ key: "pdh", value: 100.75, availableAt: T0 + 2 * BAR_MS }]);
  const notYet = levelReach.compute(ctxFor(series, 0, params, later));
  assert.equal(notYet.ok, false);
  if (!notYet.ok) assert.equal(notYet.reason, "not-known-yet");

  const wrongSide = bookWith(T0, [{ key: "pdh", value: 99.5, availableAt: T0 - BAR_MS }]);
  assert.deepEqual(levelReach.compute(ctxFor(series, 0, params, wrongSide)), {
    ok: true,
    values: { levelPrice: 99.5, levelOnTargetSide: false, reached: null, minutesToReach: null },
  });
});

test("forwardReturn: signed points to the close N minutes after the trigger; short flips the sign", () => {
  const series = seriesOf([
    [100, 100.25, 99.75, 100],
    [100, 100.5, 99.75, 100.25],
    [100.25, 100.75, 99.75, 100.75],
  ]);
  const long = forwardReturn.compute(ctxFor(series, 0, { side: "long", forwardMinutes: 2 }));
  assert.deepEqual(long, { ok: true, values: { points: 0.75, barOpen: T0 + 2 * BAR_MS } });
  const short = forwardReturn.compute(ctxFor(series, 0, { side: "short", forwardMinutes: 2 }));
  assert.deepEqual(short, { ok: true, values: { points: -0.75, barOpen: T0 + 2 * BAR_MS } });
});

test("forwardReturn: a missing minute falls back to the nearest earlier bar within 2 minutes, else null", () => {
  // Offsets 0 (trigger), 1 and 3: the minute at +2 is missing, so +1 is used.
  const withGap = seriesAt([
    [0, [100, 100.25, 99.75, 100]],
    [1, [100, 100.5, 99.75, 100.5]],
    [3, [101, 101.25, 100.75, 101]],
  ]);
  assert.deepEqual(
    forwardReturn.compute(ctxFor(withGap, 0, { side: "long", forwardMinutes: 2 })),
    { ok: true, values: { points: 0.5, barOpen: T0 + BAR_MS } },
  );
  // Offsets 0 and 3 only: nothing within 2 minutes before +2 after the trigger, so null.
  const wider = seriesAt([
    [0, [100, 100.25, 99.75, 100]],
    [3, [101, 101.25, 100.75, 101]],
  ]);
  assert.deepEqual(forwardReturn.compute(ctxFor(wider, 0, { side: "long", forwardMinutes: 2 })), {
    ok: true,
    values: { points: null, barOpen: null },
  });
});

test("measures are never allowed in a trigger", () => {
  const series = seriesOf([[100, 100.25, 99.75, 100], [100, 101.25, 99.75, 101]]);
  const registry = createSkillRegistry([bracketOutcome]);
  const result = evaluateCondition(
    { skill: "bracketOutcome", out: "exitReason", op: "==", value: "target" },
    ctxFor(series, 0, {}),
    registry,
  );
  assert.equal(result.passed, false);
  assert.equal(result.skips.trigger?.["bad-params"], 1);
});

test("labRSize: the account's R size wins; $300 for SIM Eval 50K", () => {
  const accounts = [{ id: "sim-eval-50k", r_size_cents: 30000 }];
  assert.deepEqual(labRSize("sim-eval-50k", accounts, { riskBudgetUsd: 250 }), { usd: 300, source: "account" });
  assert.equal(rBasisLabel(labRSize("sim-eval-50k", accounts, { riskBudgetUsd: 250 }), "SIM Eval 50K"), "R = $300 (SIM Eval 50K)");
});

test("labRSize: falls back to the prefs risk budget, then $250, when the account has no R size", () => {
  const accounts = [{ id: "sim", r_size_cents: null }];
  assert.deepEqual(labRSize("sim", accounts, { riskBudgetUsd: 250 }), { usd: 250, source: "default" });
  assert.deepEqual(labRSize(null, [], { riskBudgetUsd: 400 }), { usd: 400, source: "default" });
  assert.deepEqual(labRSize(null, [], null), { usd: 250, source: "default" });
  assert.equal(rBasisLabel(labRSize(null, [], null), null), "R = $250 (default risk budget)");
});
