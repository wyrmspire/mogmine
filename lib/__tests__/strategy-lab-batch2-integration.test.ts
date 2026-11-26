import test from "node:test";
import assert from "node:assert/strict";
import { createLevelIndex, levelBookAt, withLevels } from "../strategy-lab/levels.ts";
import { listSkills, SKILLS } from "../strategy-lab/registry.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import { validateRecipe } from "../strategy-lab/recipe.ts";
import { runRecipe } from "../strategy-lab/runner.ts";
import { vwapLevelsAt } from "../strategy-lab/vwap.ts";
import type { BarSeries, Recipe, SkillContext, SourceBar } from "../strategy-lab/types.ts";
import { assertNoLookahead } from "./strategy-lab-lookahead-harness.ts";

// End-to-end proof for the six batch-2 skills (§9 end, SL-16): registry, recipe validation, runRecipe, lookahead.

const MINUTE = 60_000;
const SPEC = { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 } as const;
const BATCH2 = ["rangeRegime", "trendRegime", "adrExtension", "gapOpen", "emaRelation", "profileRelation"] as const;

// ---- Fixtures (same shape as strategy-lab-recipe-run.test.ts) -------------------------------------------------

interface Ohlcv { o: number; h: number; l: number; c: number; v: number | null }

function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** One session: 18:00 ET the previous evening to 16:59 ET on `date` (EDT), 1,380 one-minute bars. */
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

/** Deterministic PRNG (mulberry32). */
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

/** A random-walk session on a 0.25 grid. Bar zero has no volume; 2% of later bars have none either. */
function walkSession(date: string, seed: number): SourceBar[] {
  const rand = prng(seed);
  let price = 5900;
  return sessionFeed(date, (k) => {
    const open = price;
    price = Math.round((price + (rand() - 0.5) * 2) * 4) / 4;
    const close = price;
    const high = Math.max(open, close) + Math.floor(rand() * 3) * 0.25;
    const low = Math.min(open, close) - Math.floor(rand() * 3) * 0.25;
    const volume = k === 0 ? null : rand() < 0.02 ? 0 : 300 + Math.floor(rand() * 2500);
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

/** 22 weekday sessions: enough for the 5-session range and 700-bar EMA warm-ups to finish inside the run. */
function fixtureSeries(): BarSeries {
  const bars = julyWeekdays(22).flatMap((date, n) => walkSession(date, 1000 + n));
  return buildBarSeries("MES", bars);
}

/** Bar index at a given ET wall-clock time on a session date (the bar that opens at that minute). */
function indexAt(series: BarSeries, date: string, hh: number, mm: number): number {
  const i = series.byTime.get(Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-04:00`));
  assert.notEqual(i, undefined, `no bar at ${date} ${hh}:${mm} ET`);
  return i as number;
}

// ---- Recipes --------------------------------------------------------------------------------------------------------

const WINDOW = { startEt: "09:30", endEt: "11:29" };

/** Batch-2 regime and range skills in the trigger; EMA and profile in sliceBy. */
const REGIME_RECIPE = {
  schema: "mogmine.strategy-recipe.v1",
  id: "rcp-batch2-regime", version: 1,
  name: "Batch-2 regime trigger",
  symbol: "MES", side: "long",
  window: WINDOW,
  trigger: { all: [
    { skill: "rangeRegime", out: "regime", op: "==", value: "expanded" },
    { skill: "trendRegime", out: "regime", op: "!=", value: "balance" },
    { skill: "adrExtension", out: "extensionBucket", op: "!=", value: "overextended" },
    { skill: "gapOpen", out: "direction", op: "in", value: ["gap-up", "flat"] },
  ] },
  entry: { at: "trigger-close" },
  stop: { type: "beyond-swing", ticks: 2, lookbackBars: 15, maxPoints: 10 },
  target: { type: "rr", multiple: 2 },
  maxHoldMinutes: 60, flatAtEt: "16:59",
  sizing: { mode: "risk-r", riskR: 0.25 },
  account: { accountId: null },
  slippageTicks: { stop: 1, market: 1 },
  dedupe: { maxPerSession: 1, cooldownMinutes: 30, oneAtATime: true },
  sliceBy: [
    { skill: "emaRelation", params: { minutes: 1 }, out: "side200" },
    { skill: "emaRelation", params: { minutes: 1 }, out: "stack" },
    { skill: "profileRelation", params: { anchor: "rth" }, out: "location" },
    { skill: "rangeRegime", out: "regime" },
    { skill: "trendRegime", out: "regime" },
    { skill: "adrExtension", out: "extensionBucket" },
    { skill: "gapOpen", out: "direction" },
  ],
  measure: { levelReach: ["vwap_globex", "onh", "pdc"], forwardMinutes: [15, 30, 60] },
};

/** EMA and profile in the trigger; batch-2 regime skills in sliceBy. */
const EMA_PROFILE_RECIPE = {
  ...REGIME_RECIPE,
  id: "rcp-batch2-ema-profile", name: "Batch-2 EMA and profile trigger",
  trigger: { all: [
    { skill: "emaRelation", params: { minutes: 5 }, out: "side200", op: "==", value: "above" },
    { skill: "profileRelation", params: { anchor: "rth" }, out: "location", op: "in", value: ["above-va", "inside-va", "at-poc"] },
  ] },
  sliceBy: [
    { skill: "rangeRegime", out: "regime" },
    { skill: "trendRegime", out: "regime" },
    { skill: "adrExtension", out: "extensionBucket" },
    { skill: "gapOpen", out: "direction" },
  ],
};

// ---- Registry ---------------------------------------------------------------------------------------------------

test("listSkills returns all 23 skills, sorted, with valid metadata", () => {
  const metas = listSkills();
  assert.equal(metas.length, 23);
  assert.equal(Object.keys(SKILLS).length, 23);

  const ids = metas.map((m) => `${m.id}@${m.version}`);
  const sorted = [...ids].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  assert.deepEqual(ids, sorted, "listSkills must sort by id");

  for (const meta of metas) {
    assert.ok(meta.id && meta.title && meta.description, `${meta.id} needs id, title and description`);
    assert.match(meta.version, /^\d+\.\d+\.\d+/, `${meta.id} version`);
    assert.ok(["feature", "label", "measure"].includes(meta.kind), `${meta.id} kind`);
    assert.ok(["active", "degraded", "experimental"].includes(meta.status), `${meta.id} status`);
    assert.ok(Array.isArray(meta.params) && Array.isArray(meta.outputs) && meta.outputs.length > 0, `${meta.id} params/outputs`);
    assert.equal(meta.knownAt === "after-entry", meta.kind === "measure", `${meta.id} knownAt matches kind`);
    const keys = meta.outputs.map((o) => o.key);
    assert.equal(new Set(keys).size, keys.length, `${meta.id} output keys are unique`);
    for (const output of meta.outputs) {
      if (output.type === "category") assert.ok((output.categories ?? []).length > 0, `${meta.id}.${output.key} categories`);
    }
  }

  for (const id of BATCH2) {
    assert.ok(metas.some((m) => m.id === id), `${id} is listed`);
  }
});

// ---- Recipes validate and run -----------------------------------------------------------------------------------

test("recipes using all six batch-2 skills in trigger and sliceBy validate", () => {
  for (const recipe of [REGIME_RECIPE, EMA_PROFILE_RECIPE]) {
    const checked = validateRecipe(recipe);
    assert.ok(checked.ok, `${recipe.id}: ${checked.ok ? "" : JSON.stringify(checked.errors)}`);
  }
});

test("a batch-2 recipe runs through runRecipe with attribution splits and skip-reason counts", () => {
  const series = fixtureSeries();
  const result = runRecipe(REGIME_RECIPE as unknown as Recipe, series, { rSizeUsd: 300, now: () => 0 });

  assert.equal(result.recipe.id, "rcp-batch2-regime");
  assert.ok(result.candidates > 0, "the window has bars to evaluate");
  assert.equal(result.data.rSize.usd, 300);

  // rangeRegime needs five prior sessions; the first sessions skip with warmup and are counted, not dropped.
  const allSkipReasons = Object.values(result.skips).flatMap((reasons) => Object.keys(reasons));
  assert.ok(allSkipReasons.includes("warmup"), `warm-up skips are counted: ${JSON.stringify(result.skips)}`);

  assert.ok(Array.isArray(result.splits), "attribution splits are produced");
  assert.ok(Array.isArray(result.timeOfDay));
  assert.ok(result.stats && typeof result.stats === "object");

  // Every match carries a feature value for each sliceBy output, keyed by skill@major:out(params).
  for (const match of result.matches) {
    assert.ok(Object.keys(match.features).length >= REGIME_RECIPE.sliceBy.length, "each match keeps its slice features");
  }
});

test("the EMA and profile trigger recipe runs cleanly and stays deterministic", () => {
  const series = fixtureSeries();
  const first = runRecipe(EMA_PROFILE_RECIPE as unknown as Recipe, series, { rSizeUsd: 300, now: () => 0 });
  const second = runRecipe(EMA_PROFILE_RECIPE as unknown as Recipe, series, { rSizeUsd: 300, now: () => 0 });
  assert.deepEqual(first.matches.map((m) => [m.sessionDate, m.entry, m.stop, m.target]),
    second.matches.map((m) => [m.sessionDate, m.entry, m.stop, m.target]));
  assert.deepEqual(first.skips, second.skips);
  assert.ok(first.candidates > 0);
});

// ---- Lookahead over every feature and label skill ------------------------------------------------------------

test("every feature and label skill in SKILLS passes assertNoLookahead", () => {
  const series = fixtureSeries();
  const levelIndex = createLevelIndex(series);
  const samples = [
    indexAt(series, julyWeekdays(22)[21], 9, 45),
    indexAt(series, julyWeekdays(22)[21], 10, 30),
    indexAt(series, julyWeekdays(22)[15], 13, 0),
    indexAt(series, julyWeekdays(22)[12], 15, 5),
  ];
  const checked: string[] = [];
  for (const i of samples) {
    const ctx: SkillContext = {
      series, i, params: {}, spec: { ...SPEC }, rSizeUsd: 300,
      levels: withLevels(levelBookAt(levelIndex, i), vwapLevelsAt(series, i)),
    };
    for (const skill of Object.values(SKILLS)) {
      if (skill.meta.kind === "measure") continue;
      assertNoLookahead(skill, ctx);
      checked.push(skill.meta.id);
    }
  }
  for (const id of BATCH2) assert.ok(checked.includes(id), `${id} was checked`);
});
