import test from "node:test";
import assert from "node:assert/strict";
import { buildBarSeries } from "../strategy-lab/series.ts";
import { findSimilarRecipe, similarWindow } from "../strategy-lab/similar.ts";
import {
  exportRecipesJson, findRecipe, importRecipesJson, latestRecipes, loadRecipeStore, parseRecipeStore,
  recipeVersions, RECIPE_STORE_KEY, removeRecipe, saveRecipe, saveRecipeStore, type RecipeStore,
} from "../strategy-lab/recipes-store.ts";
import { parseEtMinute, validateRecipe } from "../strategy-lab/recipe.ts";
import { readOutput, runRecipe } from "../strategy-lab/runner.ts";
import type { BarSeries, Recipe, SourceBar, Value } from "../strategy-lab/types.ts";

const MINUTE = 60_000;
const R300 = { rSizeUsd: 300 };

// The four §5.3 examples, verbatim from docs/design-2026-11-24/09-strategy-lab.md.
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

const EXAMPLE_B = {
  schema: "mogmine.strategy-recipe.v1",
  id: "rcp-pdl-first-hour", version: 1,
  name: "PDL first touch, first hour, close back above",
  playbookId: null,
  symbol: "MES", side: "long",
  window: { startEt: "09:31", endEt: "10:30" },
  trigger: { all: [
    { skill: "levelMap", params: { level: "pdl", toleranceTicks: 2 }, out: "touch", op: "==", value: true },
    { skill: "levelMap", params: { level: "pdl", toleranceTicks: 2 }, out: "closeDistTicks", op: ">=", value: 0 },
  ]},
  entry: { at: "trigger-close" },
  stop: { type: "points", points: 4 },
  target: { type: "level", level: "rth_open", fallbackPoints: 8 },
  maxHoldMinutes: 90, flatAtEt: "15:59",
  sizing: { mode: "risk-r", riskR: 0.25 },
  account: { accountId: null },
  slippageTicks: { stop: 1, market: 1 },
  dedupe: { maxPerSession: 1, cooldownMinutes: 60, oneAtATime: true },
  sliceBy: [
    { skill: "volumeAtLevel", params: { level: "pdl", toleranceTicks: 2 }, out: "touches" },
    { skill: "volumeAtLevel", params: { level: "pdl", toleranceTicks: 2 }, out: "volumeShareBucket" },
    { skill: "entryVolume", params: { k: 5 }, out: "entryVsMedianBucket" },
    { skill: "contextRanges", out: "overnightTrend" },
    { skill: "openingRange", params: { minutes: 15 }, out: "widthBucket" },
    { skill: "sessionClock", out: "todBucket" },
  ],
  measure: { levelReach: ["rth_open", "vwap_rth", "pdc"], forwardMinutes: [15, 30] },
};

const EXAMPLE_C = {
  schema: "mogmine.strategy-recipe.v1",
  id: "rcp-vwap-reclaim", version: 1,
  name: "RTH VWAP reclaim after 10:00 on a spike",
  playbookId: "vwap-trend-push",
  symbol: "MES", side: "long",
  window: { startEt: "10:00", endEt: "15:00" },
  trigger: { all: [
    { skill: "vwapRelation", params: { anchor: "rth" }, out: "event", op: "==", value: "reclaim" },
    { skill: "volumeSpike", params: { lookbackBars: 30, multiple: 2.5 }, out: "spike", op: "==", value: true },
  ]},
  entry: { at: "trigger-close" },
  stop: { type: "beyond-swing", ticks: 2, lookbackBars: 10, maxPoints: 8 },
  target: { type: "rr", multiple: 1.5 },
  maxHoldMinutes: 45, flatAtEt: "15:59",
  sizing: { mode: "risk-r", riskR: 0.25 },
  account: { accountId: null },
  slippageTicks: { stop: 1, market: 1 },
  dedupe: { maxPerSession: 3, cooldownMinutes: 30, oneAtATime: true },
  sliceBy: [
    { skill: "rvol", params: { windowMinutes: 5, sessions: 10 }, out: "rvolBucket" },
    { skill: "deltaProxy", params: { bars: 10 }, out: "sign" },
    { skill: "contextRanges", out: "pdcSide" },
    { skill: "structure5m", out: "structure" },
    { skill: "sessionClock", out: "todBucket" },
  ],
  measure: { levelReach: ["pdh", "onh"], forwardMinutes: [15, 30, 60] },
};

const EXAMPLE_D = {
  schema: "mogmine.strategy-recipe.v1",
  id: "rcp-or-failed-breakout-short", version: 1,
  name: "Failed ORH breakout, short back into the range",
  playbookId: "orb-reclaim",
  symbol: "MES", side: "short",
  window: { startEt: "09:46", endEt: "11:30" },
  trigger: { all: [
    { skill: "openingRange", params: { minutes: 15, failBars: 5 }, out: "failedBreakUp", op: "==", value: true },
    { not: { skill: "vwapRelation", params: { anchor: "rth" }, out: "side", op: "==", value: "above-far" } },
  ]},
  entry: { at: "trigger-close" },
  stop: { type: "beyond-swing", ticks: 2, lookbackBars: 5, maxPoints: 8 },
  target: { type: "level", level: "or_mid", fallbackPoints: 6 },
  maxHoldMinutes: 60, flatAtEt: "15:59",
  sizing: { mode: "risk-r", riskR: 0.25 },
  account: { accountId: null },
  slippageTicks: { stop: 1, market: 1 },
  dedupe: { maxPerSession: 1, cooldownMinutes: 60, oneAtATime: true },
  sliceBy: [
    { skill: "volumeSpike", out: "spike" },
    { skill: "entryVolume", params: { k: 5 }, out: "trend" },
    { skill: "openingRange", params: { minutes: 15 }, out: "widthBucket" },
    { skill: "contextRanges", out: "yesterdayDirection" },
    { skill: "deltaProxy", out: "sign" },
  ],
  measure: { levelReach: ["or_low", "vwap_rth", "pdl"], forwardMinutes: [15, 30] },
};

/** A minimal valid recipe; tests override one field at a time. */
function minimal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "mogmine.strategy-recipe.v1",
    id: "rcp-min", name: "Minimal", side: "long",
    window: { startEt: "09:30", endEt: "10:29" },
    trigger: { all: [{ skill: "sessionClock", out: "minutesFromRthOpen", op: "==", value: 30 }] },
    stop: { type: "points", points: 2 },
    target: { type: "rr", multiple: 2 },
    ...overrides,
  };
}

// ---- Fixtures ------------------------------------------------------------------------------------------------

/** The previous calendar day, YYYY-MM-DD. */
function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

interface Ohlcv { o: number; h: number; l: number; c: number; v: number | null }

/**
 * One session's 1-minute bars: 18:00 ET the previous evening to 16:59 ET on `date` (EDT, UTC−4), 1380 bars.
 * `shape(k, time)` gives each bar. Times are UTC ms.
 */
function sessionFeed(date: string, shape: (k: number, time: number) => Ohlcv): SourceBar[] {
  const start = Date.parse(`${previousDay(date)}T22:00:00Z`);
  const bars: SourceBar[] = [];
  for (let k = 0; k < 1380; k += 1) {
    const time = start + k * MINUTE;
    const b = shape(k, time);
    bars.push({ time, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
  }
  return bars;
}

const flat = (price: number, volume: number | null = 1000): Ohlcv => ({ o: price, h: price, l: price, c: price, v: volume });

/** Deterministic PRNG (mulberry32). Same seed, same sequence, on every machine. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random-walk session on a 0.25 grid. The first bar has zero volume, as Yahoo serves it (NaN here). */
function walkSession(date: string, seed: number): SourceBar[] {
  const rand = prng(seed);
  let price = 5900;
  return sessionFeed(date, (k) => {
    const open = price;
    price = Math.round((price + (rand() - 0.5) * 2) * 4) / 4;
    const close = price;
    const high = Math.max(open, close) + Math.floor(rand() * 3) * 0.25;
    const low = Math.min(open, close) - Math.floor(rand() * 3) * 0.25;
    const volume = k === 0 ? 0 : rand() < 0.02 ? 0 : 300 + Math.floor(rand() * 2500);
    return { o: open, h: high, l: low, c: close, v: volume };
  });
}

/** Weekdays of July 2026, starting from the first one on or after 1 July. */
function julyWeekdays(count: number): string[] {
  const out: string[] = [];
  for (let t = Date.parse("2026-07-01T12:00:00Z"); out.length < count; t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day >= 1 && day <= 5) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function seriesFrom(bars: SourceBar[]): BarSeries {
  return buildBarSeries("MES", bars);
}

// ---- Recipe validation -----------------------------------------------------------------------------------------

test("the four §5.3 example recipes validate", () => {
  for (const example of [EXAMPLE_A, EXAMPLE_B, EXAMPLE_C, EXAMPLE_D]) {
    const checked = validateRecipe(example);
    assert.ok(checked.ok, `${example.id}: ${checked.ok ? "" : JSON.stringify(checked.errors)}`);
  }
});

test("a measure in the trigger is rejected (the lookahead guard, §5.2)", () => {
  const checked = validateRecipe(minimal({
    trigger: { all: [{ skill: "bracketOutcome", out: "resultR", op: ">=", value: 0 }] },
  }));
  assert.equal(checked.ok, false);
  if (checked.ok) return;
  assert.ok(checked.errors.some((e) => e.path === "trigger.all[0].skill" && /measure/.test(e.message)), JSON.stringify(checked.errors));
});

test("a measure in sliceBy is rejected too", () => {
  const checked = validateRecipe(minimal({ sliceBy: [{ skill: "forwardReturn", params: { side: "long", forwardMinutes: 15 }, out: "points" }] }));
  assert.equal(checked.ok, false);
});

test("unknown skills, unknown outputs and operators that do not fit the output type are named", () => {
  const unknownSkill = validateRecipe(minimal({ trigger: { skill: "nope", out: "x", op: "==", value: 1 } }));
  assert.ok(!unknownSkill.ok && unknownSkill.errors.some((e) => e.message.includes('"nope"')));

  const unknownOut = validateRecipe(minimal({ trigger: { skill: "rvol", out: "nope", op: ">=", value: 1 } }));
  assert.ok(!unknownOut.ok && unknownOut.errors.some((e) => e.message.includes('"nope"')));

  // A boolean output compared with ">=" is a type error, not a silent false.
  const badOp = validateRecipe(minimal({ trigger: { skill: "confirm1m", out: "reclaim", op: ">=", value: 1 } }));
  assert.ok(!badOp.ok && badOp.errors.some((e) => e.message.includes("does not apply")));

  // A category compared to a value it does not have.
  const badCategory = validateRecipe(minimal({ trigger: { skill: "volumeAtLevel", params: { level: "pdl" }, out: "volumeShareBucket", op: "==", value: "huge" } }));
  assert.ok(!badCategory.ok);
});

test("unknown parameters and out-of-range parameters are errors with a path", () => {
  const unknownParam = validateRecipe(minimal({ trigger: { skill: "rvol", params: { windowMinute: 5 }, out: "rvol", op: ">=", value: 1 } }));
  assert.ok(!unknownParam.ok && unknownParam.errors.some((e) => e.path === "trigger.params.windowMinute"));

  const outOfRange = validateRecipe(minimal({ trigger: { skill: "rvol", params: { windowMinutes: 500 }, out: "rvol", op: ">=", value: 1 } }));
  assert.ok(!outOfRange.ok && outOfRange.errors.some((e) => e.path === "trigger.params.windowMinutes"));
});

test("conditions nest at most three levels, and sliceBy holds at most 12", () => {
  const leaf = { skill: "sessionClock", out: "minutesFromRthOpen", op: ">=", value: 0 };
  let deep: unknown = leaf;
  for (let n = 0; n < 4; n += 1) deep = { all: [deep] };
  const tooDeep = validateRecipe(minimal({ trigger: deep }));
  assert.ok(!tooDeep.ok && tooDeep.errors.some((e) => /at most 3/.test(e.message)));

  const tooMany = validateRecipe(minimal({
    sliceBy: Array.from({ length: 13 }, () => ({ skill: "sessionClock", out: "todBucket" })),
  }));
  assert.ok(!tooMany.ok && tooMany.errors.some((e) => e.path === "sliceBy"));
});

test("window times must parse and stop and target must be positive", () => {
  assert.equal(parseEtMinute("24:00"), null);
  assert.equal(parseEtMinute("9:30"), null);
  assert.equal(parseEtMinute("09:31"), 571);
  const badWindow = validateRecipe(minimal({ window: { startEt: "25:00", endEt: "10:00" } }));
  assert.ok(!badWindow.ok && badWindow.errors.some((e) => e.path === "window.startEt"));
  const zeroStop = validateRecipe(minimal({ stop: { type: "points", points: 0 } }));
  assert.ok(!zeroStop.ok && zeroStop.errors.some((e) => e.path === "stop.points"));
});

test("defaults are filled in and the shape is a fresh object each time", () => {
  const first = validateRecipe(minimal());
  const second = validateRecipe(minimal());
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.equal(first.recipe.flatAtEt, "16:59");
  assert.deepEqual(first.recipe.sizing, { mode: "risk-r", riskR: 0.25 });
  assert.deepEqual(first.recipe.slippageTicks, { stop: 1, market: 1 });
  assert.deepEqual(first.recipe.dedupe, { maxPerSession: 1, cooldownMinutes: 30, oneAtATime: true });
  assert.equal(first.recipe.maxHoldMinutes, 60);
  assert.equal(first.recipe.symbol, "MES");
  assert.equal(first.recipe.entry.at, "trigger-close");
  assert.notEqual(first.recipe.sizing, second.recipe.sizing, "defaults must not share an object");
});

// ---- Runner: a hand-checked trade -------------------------------------------------------------------------------

/** Flat 5,900 session. The trigger bar opens 09:59 (decision 10:00); the next bar pushes to 5,904.25. */
function hand10amSeries(): BarSeries {
  const triggerOpen = Date.parse("2026-07-13T13:59:00Z");
  const next = triggerOpen + MINUTE;
  return seriesFrom(sessionFeed("2026-07-13", (k, time) => {
    if (time === next) return { o: 5900, h: 5904.25, l: 5900, c: 5904, v: 1000 };
    return flat(5900);
  }));
}

const MIN_RECIPE = {
  schema: "mogmine.strategy-recipe.v1",
  id: "rcp-hand", version: 1, name: "Hand check", side: "long",
  window: { startEt: "09:30", endEt: "10:29" },
  trigger: { all: [{ skill: "sessionClock", out: "minutesFromRthOpen", op: "==", value: 30 }] },
  entry: { at: "trigger-close" },
  stop: { type: "points", points: 2 },
  target: { type: "rr", multiple: 2 },
  maxHoldMinutes: 60, flatAtEt: "16:59",
  sizing: { mode: "risk-r", riskR: 0.25 },
  account: { accountId: null },
  slippageTicks: { stop: 1, market: 1 },
  dedupe: { maxPerSession: 1, cooldownMinutes: 30, oneAtATime: true },
  sliceBy: [],
  measure: {},
  symbol: "MES", playbookId: null,
};

test("hand-checked trade: entry at the trigger close, stop 2 points, target 4 points, qty from fixed R", () => {
  const result = runRecipe(MIN_RECIPE as unknown as Recipe, hand10amSeries(), R300);
  assert.equal(result.matches.length, 1);
  const [match] = result.matches;
  assert.equal(match.entry, 5900);
  assert.equal(match.stop, 5898);
  assert.equal(match.target, 5904);
  // $300 × 0.25 = $75 at risk. A 2-point stop is $10 per contract, so 7 contracts (6.25 floored).
  assert.equal(match.qty, 7);
  assert.equal(match.oversized, false);
  assert.equal(match.outcome.exitReason, "target");
  assert.equal(match.outcome.pnlPoints, 4);
  assert.equal(match.outcome.pnlUsd, 140);
  assert.ok(Math.abs(match.outcome.resultR - 140 / 300) < 1e-12);
  assert.equal(match.outcome.exitTime, Date.parse("2026-07-13T14:01:00Z"), "exit is the close of the 10:00 bar that hit the target");
  // The stop is the same width at R $250, but the quantity follows R, not the stop: floor(62.5 / 10) = 6.
  const at250 = runRecipe(MIN_RECIPE as unknown as Recipe, hand10amSeries(), { rSizeUsd: 250, rSizeSource: "default" });
  assert.equal(at250.matches[0].qty, 6);
  assert.equal(at250.data.rSize.usd, 250);
});

test("a stop too tight for one contract at the R size is kept and flagged oversized", () => {
  const result = runRecipe(MIN_RECIPE as unknown as Recipe, hand10amSeries(), { rSizeUsd: 10 });
  assert.equal(result.matches[0].qty, 1);
  assert.equal(result.matches[0].oversized, true);
});

// ---- Runner: 22 sessions, deterministic ----------------------------------------------------------------------

function fixture22(): SourceBar[] {
  return julyWeekdays(22).flatMap((date, n) => walkSession(date, 1000 + n));
}

const SCAN_RECIPE = {
  schema: "mogmine.strategy-recipe.v1",
  id: "rcp-scan-22", version: 1, name: "22-session scan", side: "long",
  window: { startEt: "07:00", endEt: "10:30" },
  trigger: { all: [{ skill: "contextRanges", out: "overnightPosPct", op: "<=", value: 50 }] },
  entry: { at: "trigger-close" },
  stop: { type: "beyond-swing", ticks: 2, lookbackBars: 15, maxPoints: 10 },
  target: { type: "rr", multiple: 2 },
  maxHoldMinutes: 60, flatAtEt: "16:59",
  sizing: { mode: "risk-r", riskR: 0.25 },
  account: { accountId: null },
  slippageTicks: { stop: 1, market: 1 },
  dedupe: { maxPerSession: 2, cooldownMinutes: 10, oneAtATime: true },
  sliceBy: [
    { skill: "rvol", params: { windowMinutes: 5, sessions: 10 }, out: "rvolBucket" },
    { skill: "volumeSpike", out: "spike" },
    { skill: "deltaProxy", out: "sign" },
    { skill: "mtfCandle", params: { minutes: 15 }, out: "lowerWickPctile" },
    { skill: "sessionClock", out: "todBucket" },
  ],
  measure: { levelReach: ["vwap_globex", "onh"], forwardMinutes: [15, 30] },
  symbol: "MES", playbookId: null,
} as unknown as Recipe;

function stripTiming<T extends { ms: number }>(result: T): Omit<T, "ms"> {
  const { ms: _ms, ...rest } = result;
  return rest;
}

test("a 22-session fixture run is deterministic, and its matches obey the dedupe rules", () => {
  const bars = fixture22();
  const series = seriesFrom(bars);
  assert.equal(series.sessions.length, 22);

  const first = runRecipe(SCAN_RECIPE, series, R300);
  const second = runRecipe(SCAN_RECIPE, seriesFrom(fixture22()), R300);
  assert.deepEqual(stripTiming(first), stripTiming(second), "same bars and recipe give the same result");

  assert.equal(first.data.sessionsUsed.length, 22);
  assert.ok(first.candidates > 0);
  assert.ok(first.matches.length > 0, "the scan should find some matches on this fixture");

  // Dedupe: at most two per session, a 10-minute cooldown, and no overlapping trades (oneAtATime).
  const perDate = new Map<string, number>();
  for (const m of first.matches) perDate.set(m.sessionDate, (perDate.get(m.sessionDate) ?? 0) + 1);
  for (const count of perDate.values()) assert.ok(count <= 2);
  for (let n = 1; n < first.matches.length; n += 1) {
    const prev = first.matches[n - 1];
    const cur = first.matches[n];
    if (prev.sessionDate !== cur.sessionDate) continue;
    assert.ok(cur.time + MINUTE >= prev.outcome.exitTime, "no new entry while the previous trade is open");
    assert.ok(cur.time - prev.time >= 10 * MINUTE, "cooldown respected");
  }

  // Structure of every match: long stop below entry below target, prices on the tick grid, qty at least one.
  for (const m of first.matches) {
    assert.ok(m.stop < m.entry && m.entry < m.target);
    for (const price of [m.entry, m.stop, m.target]) assert.equal(price % 0.25, 0);
    assert.ok(m.qty >= 1);
    assert.ok(m.outcome.exitTime > m.time);
    assert.ok(m.outcome.resultR === m.outcome.pnlUsd / 300);
  }
  // Volume 0 is missing, so a session that starts with the artifact bar reports it.
  assert.ok(first.data.volumeMissing >= 22);
});

test("disabling oneAtATime and raising maxPerSession allows more matches, still deterministic", () => {
  const series = seriesFrom(fixture22());
  const loose = { ...SCAN_RECIPE, dedupe: { maxPerSession: 5, cooldownMinutes: 0, oneAtATime: false } } as Recipe;
  const tight = runRecipe(SCAN_RECIPE, series, R300);
  const wide = runRecipe(loose, series, R300);
  assert.ok(wide.matches.length >= tight.matches.length);
  assert.deepEqual(stripTiming(wide), stripTiming(runRecipe(loose, series, R300)));
});

test("an invalid recipe is refused before any bar is read", () => {
  const bad = { ...SCAN_RECIPE, trigger: { skill: "bracketOutcome", out: "resultR", op: ">=", value: 0 } } as unknown as Recipe;
  assert.throws(() => runRecipe(bad, seriesFrom(fixture22()), R300), /measure/);
});

test("readOutput returns a single output at a bar and null when the skill skips", () => {
  const series = seriesFrom(walkSession("2026-07-13", 7));
  const i = series.time.length - 1;
  const pos = readOutput({ skill: "contextRanges", out: "overnightPosPct" }, {
    series, i, params: {}, spec: { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 }, rSizeUsd: 300,
    levels: { asOf: series.time[i], levels: [], byKey: new Map() },
  });
  assert.ok(typeof pos === "number" || pos === null);
  const missing: Value = readOutput({ skill: "rvol", params: { windowMinutes: 5, sessions: 10 }, out: "rvol" }, {
    series, i, params: {}, spec: { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 }, rSizeUsd: 300,
    levels: { asOf: series.time[i], levels: [], byKey: new Map() },
  });
  assert.equal(missing, null, "one session has no baseline, so RVOL skips to null");
});

// ---- Find similar ------------------------------------------------------------------------------------------------

test("card to recipe: a mark one tick off a level becomes a level-touch trigger in the RTH window", () => {
  // Overnight 5950 base, a 5880 low at 03:00 so the overnight range is wide. Open 09:30 at 5950.
  const series = seriesFrom(sessionFeed("2026-07-13", () => flat(5950)));
  const mark = { time: Date.parse("2026-07-13T14:00:00Z"), price: 5950.25, side: "long" as const };
  const result = findSimilarRecipe(series, mark, R300);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  if (!result.ok) return;
  const trigger = result.recipe.trigger as { all: { skill: string; out: string; op: string; value: Value }[] };
  const [first] = trigger.all;
  assert.equal(first.skill, "levelMap");
  assert.equal(first.out, "touch");
  assert.equal(first.op, "==");
  assert.equal(first.value, true);
  assert.deepEqual(result.recipe.window, { startEt: "09:30", endEt: "10:29" });
  assert.equal(result.recipe.target.type, "rr");
  assert.ok(result.reasons.some((r) => /tick/.test(r)), JSON.stringify(result.reasons));
  // Slices never repeat a trigger output, and the list is capped at 12.
  assert.ok(result.recipe.sliceBy.length <= 12);
  assert.ok(!result.recipe.sliceBy.some((s) => s.skill === "levelMap"));
  assert.ok(validateRecipe(result.recipe).ok, "the generated recipe validates");
});

test("card to recipe: a premarket mark near the overnight low, with no level close, uses the overnight position", () => {
  // 5950 base; the overnight low is a 5880 bar at 03:00. A 5889 mark sits 9 of 71 points above it (12.7%).
  const lowTime = Date.parse("2026-07-13T07:00:00Z");
  const series = seriesFrom(sessionFeed("2026-07-13", (k, time) => {
    if (time === lowTime) return { o: 5950, h: 5951, l: 5880, c: 5950, v: 1000 };
    return flat(5950);
  }));
  const mark = { time: Date.parse("2026-07-13T12:12:00Z"), price: 5889, side: "long" as const };
  const result = findSimilarRecipe(series, mark, R300);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.deepEqual((result.recipe.trigger as { all: unknown[] }).all[0], {
    skill: "contextRanges", out: "overnightPosPct", op: "<=", value: 15,
  });
  assert.deepEqual(result.recipe.window, { startEt: "07:00", endEt: "09:29" });
  assert.equal(result.recipe.stop.type, "beyond-swing");
});

test("the Find-similar window is the mark's 30-minute bucket ±60 minutes, clipped to the phase", () => {
  assert.deepEqual(similarWindow(8 * 60 + 12), { startEt: "07:00", endEt: "09:29" });
  assert.deepEqual(similarWindow(10 * 60), { startEt: "09:30", endEt: "10:29" });
  assert.equal(similarWindow(17 * 60 + 30), null, "the halt has no bars");
});

test("a mark with no bar at its minute is refused with a reason", () => {
  const series = seriesFrom(sessionFeed("2026-07-13", () => flat(5900)));
  const noBar = findSimilarRecipe(series, { time: Date.parse("2026-07-14T14:00:00Z"), price: 5900, side: "long" }, R300);
  assert.equal(noBar.ok, false);
});

// ---- Recipe store ------------------------------------------------------------------------------------------------

function memoryStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(RECIPE_STORE_KEY, initial);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    raw: () => map.get(RECIPE_STORE_KEY),
  };
}

test("store: a new recipe is version 1, a post-run edit appends version 2, and a plain edit replaces the newest", () => {
  let store: RecipeStore = { recipes: [] };
  const created = saveRecipe(store, EXAMPLE_B);
  assert.ok(created.ok);
  if (!created.ok) return;
  store = created.store;
  assert.equal(created.recipe.version, 1);

  const appended = saveRecipe(store, { ...EXAMPLE_B, name: "PDL after a run" }, { newVersion: true });
  assert.ok(appended.ok);
  if (!appended.ok) return;
  store = appended.store;
  assert.deepEqual(recipeVersions(store, EXAMPLE_B.id).map((r) => r.version), [1, 2]);
  assert.equal(findRecipe(store, EXAMPLE_B.id)?.name, "PDL after a run");
  assert.equal(findRecipe(store, EXAMPLE_B.id, 1)?.name, EXAMPLE_B.name, "version 1 is kept");

  const edited = saveRecipe(store, { ...EXAMPLE_B, name: "PDL fixed typo" });
  assert.ok(edited.ok);
  if (!edited.ok) return;
  assert.equal(edited.recipe.version, 2);
  assert.equal(recipeVersions(edited.store, EXAMPLE_B.id).length, 2);
  assert.equal(latestRecipes(edited.store).length, 1);
});

test("store: an invalid draft is refused with errors, and a bad stored entry is dropped alone", () => {
  const refused = saveRecipe({ recipes: [] }, { ...EXAMPLE_A, trigger: { skill: "bracketOutcome", out: "resultR", op: ">=", value: 0 } });
  assert.equal(refused.ok, false);

  const parsed = parseRecipeStore({ recipes: [EXAMPLE_A, { id: "broken" }, EXAMPLE_C] });
  assert.equal(parsed.store.recipes.length, 2);
  assert.equal(parsed.dropped.length, 1);
  assert.equal(parsed.dropped[0].index, 1);
});

test("store: load and save go through storage, bad JSON is reported and not thrown, and the JSON backup round-trips", () => {
  const storage = memoryStorage();
  assert.deepEqual(loadRecipeStore(storage).store.recipes, []);
  const saved = saveRecipe({ recipes: [] }, EXAMPLE_A);
  assert.ok(saved.ok);
  if (!saved.ok) return;
  saveRecipeStore(storage, saved.store);
  assert.ok(storage.raw()?.includes("rcp-premarket-bottom"));
  assert.equal(loadRecipeStore(storage).store.recipes.length, 1);

  const corrupt = loadRecipeStore(memoryStorage("{not json"));
  assert.equal(corrupt.error, "Stored recipes are not valid JSON");
  assert.deepEqual(corrupt.store.recipes, []);

  const backup = exportRecipesJson(saved.store);
  const restored = importRecipesJson(backup);
  assert.equal(restored.error, undefined);
  assert.deepEqual(restored.store.recipes, saved.store.recipes);
  assert.equal(importRecipesJson("oops").error, "Pasted text is not valid JSON");
});

test("store: removing a recipe removes every version, and playbook filters work", () => {
  let store: RecipeStore = { recipes: [] };
  const a = saveRecipe(store, EXAMPLE_A);
  assert.ok(a.ok);
  if (!a.ok) return;
  store = a.store;
  const c = saveRecipe(store, EXAMPLE_C);
  assert.ok(c.ok);
  if (!c.ok) return;
  store = c.store;
  assert.deepEqual(latestRecipes(store).map((r) => r.id).sort(), ["rcp-premarket-bottom", "rcp-vwap-reclaim"]);
  assert.deepEqual(store.recipes.filter((r) => r.playbookId === "vwap-trend-push").map((r) => r.id), ["rcp-vwap-reclaim"]);
  assert.deepEqual(removeRecipe(store, "rcp-premarket-bottom").recipes.map((r) => r.id), ["rcp-vwap-reclaim"]);
});
