import test from "node:test";
import assert from "node:assert/strict";
import { equityIndexSessionBounds } from "../session.ts";
import { computeSessionIndicators, type GapPolicy } from "../session-indicators.ts";
import { createLevelIndex, levelBookAt } from "../strategy-lab/levels.ts";
import { getSkill, listSkills, SKILLS } from "../strategy-lab/registry.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import { CONTEXT_SKILLS, contextRanges, openingRange, vwapRelation } from "../strategy-lab/skills/context.ts";
import { vwapAt, vwapLevelsAt } from "../strategy-lab/vwap.ts";
import type { BarSeries, Skill, SkillContext, Value } from "../strategy-lab/types.ts";
import type { Candle } from "../trades.ts";
import { assertNoLookahead } from "./strategy-lab-lookahead-harness.ts";

const MIN = 60_000;
const SPEC = { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 } as const;
const FRI = "2026-07-10";
const MON = "2026-07-13";
const TUE = "2026-07-14";
const POLICIES: readonly GapPolicy[] = ["complete", "globex-tolerant"];

interface Bar { open: number; high: number; low: number; close: number; volume: number }
/** A `null` patch drops the bar. Any other patch merges over the base bar. */
type Patch = Partial<Bar> | null;

/** Minute `k` of the regular session (k = 0 is 09:30 ET; negative values reach back before the open). */
const rthAt = (date: string, k: number) => equityIndexSessionBounds(date).rthOpen + k * MIN;
/** Minute `k` of the Globex session that opens at 18:00 ET the evening before `date`. */
const globexAt = (date: string, k: number) => equityIndexSessionBounds(date).open + k * MIN;
const flat = (price: number, volume = 100): Bar => ({ open: price, high: price, low: price, close: price, volume });

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random-walk bars with some zero-volume bars (the Yahoo artifact) and valid OHLC on the 0.25 tick. */
function walk(seed: number, start: number): () => Bar {
  const rand = mulberry32(seed);
  let price = start;
  return () => {
    const open = price;
    const close = open + (Math.round(rand() * 8) - 4) * 0.25;
    const high = Math.max(open, close) + Math.floor(rand() * 3) * 0.25;
    const low = Math.min(open, close) - Math.floor(rand() * 3) * 0.25;
    price = close;
    const volume = rand() < 0.08 ? 0 : 1 + Math.floor(rand() * 1500);
    return { open, high, low, close, volume };
  };
}

interface Layout {
  dates: readonly string[];
  base: (time: number) => Bar;
  /** UTC [from, to) to build for each date. Defaults to the whole Globex session. */
  window?: (date: string) => readonly [number, number];
  patches?: ReadonlyMap<number, Patch>;
}

/** Candles minute by minute for each date. */
function buildCandles({ dates, base, window, patches }: Layout): Candle[] {
  const out: Candle[] = [];
  for (const date of dates) {
    const bounds = equityIndexSessionBounds(date);
    const [from, to] = window ? window(date) : [bounds.open, bounds.close];
    for (let time = from; time < to; time += MIN) {
      const patch = patches?.get(time);
      if (patch === null) continue;
      out.push({ time, ...base(time), ...patch });
    }
  }
  return out;
}

const seriesOf = (candles: readonly Candle[]): BarSeries => buildBarSeries("MES", candles);

function indexOf(series: BarSeries, time: number): number {
  const i = series.byTime.get(time);
  assert.notEqual(i, undefined, `no bar at ${new Date(time).toISOString()}`);
  return i as number;
}

function ctxAt(series: BarSeries, i: number, levelIndex = createLevelIndex(series)): SkillContext {
  return { series, i, params: {}, spec: SPEC, rSizeUsd: 300, levels: levelBookAt(levelIndex, i) };
}

/** Runs the skill and checks it returns exactly its declared output keys. */
function okValues(skill: Skill, ctx: SkillContext): Record<string, Value> {
  const result = skill.compute(ctx);
  assert.equal(result.ok, true, `${skill.meta.id} skipped: ${!result.ok ? result.detail : ""}`);
  if (!result.ok) return {};
  assert.deepEqual(
    Object.keys(result.values).sort(),
    skill.meta.outputs.map(({ key }) => key).sort(),
    `${skill.meta.id} outputs must match its declared keys`,
  );
  return result.values;
}

/** The reference: the last VWAP point of computeSessionIndicators as of `asOf`. */
function referenceVwap(candles: readonly Candle[], asOf: number, anchor: "rth" | "globex", gapPolicy: GapPolicy): number | null {
  const reference = computeSessionIndicators(candles, { symbol: "MES", timeframe: "1m", asOf, anchor, gapPolicy });
  return reference?.vwap.at(-1)?.value ?? null;
}

// ----------------------------------------------------------------------------------------------
// Golden VWAP: lab == computeSessionIndicators to the tick.
// ----------------------------------------------------------------------------------------------

/** Friday, Monday and Tuesday with every case that matters: zero-volume first bars, scattered zero
 *  volume, an overnight gap inside the Globex tolerance, an overnight gap beyond 15 minutes, and a
 *  missing regular-hours bar. Monday's drops run to 09:50, so its regular session is incomplete. */
function goldenCandles(): Candle[] {
  const next = walk(42, 5000);
  const patches = new Map<number, Patch>();
  for (const date of [FRI, MON, TUE]) patches.set(globexAt(date, 0), { volume: 0 });
  for (const m of [100, 400, 700]) patches.set(globexAt(FRI, m), null);
  for (let m = 200; m <= 211; m += 1) patches.set(globexAt(MON, m), null);
  for (let m = 600; m <= 950; m += 50) patches.set(globexAt(MON, m), null);
  for (let m = 300; m <= 319; m += 1) patches.set(globexAt(TUE, m), null);
  patches.set(rthAt(TUE, 60), null);
  return buildCandles({ dates: [FRI, MON, TUE], base: () => next(), patches });
}

function goldenSamples(): number[] {
  const samples: number[] = [];
  for (const date of [FRI, MON, TUE]) {
    const bounds = equityIndexSessionBounds(date);
    for (let m = 0; m < 1380; m += 61) samples.push(globexAt(date, m) + 17_000);
    samples.push(
      bounds.open, bounds.open + MIN, rthAt(date, -1), rthAt(date, 0), rthAt(date, 1),
      rthAt(date, 120) + 17_000, rthAt(date, 389), bounds.rthClose, bounds.close - MIN, bounds.close,
    );
  }
  return samples;
}

test("golden: lab VWAP equals computeSessionIndicators to the tick at ≥ 20 asOf times, both anchors and gap policies", () => {
  const candles = goldenCandles();
  const series = seriesOf(candles);
  const samples = goldenSamples();
  assert.ok(samples.length >= 20, `need ≥ 20 asOf times, have ${samples.length}`);

  let comparisons = 0;
  let valued = 0;
  let tolerantOnly = 0;
  let rthWithheld = 0;
  for (const asOf of samples) {
    for (const anchor of ["rth", "globex"] as const) {
      for (const policy of POLICIES) {
        const expected = referenceVwap(candles, asOf, anchor, policy);
        const lab = vwapAt(series, anchor, asOf, policy).value;
        assert.strictEqual(lab, expected, `${anchor}/${policy} at ${new Date(asOf).toISOString()}`);
        comparisons += 1;
        if (expected !== null) valued += 1;
      }
    }
    if (referenceVwap(candles, asOf, "globex", "globex-tolerant") !== null
      && referenceVwap(candles, asOf, "globex", "complete") === null) tolerantOnly += 1;
    if (asOf > rthAt(TUE, 60) && referenceVwap(candles, asOf, "rth", "globex-tolerant") === null) rthWithheld += 1;
  }
  assert.equal(comparisons, samples.length * 4);
  assert.ok(valued >= 40, `enough samples carry a value to be meaningful (${valued})`);
  assert.ok(tolerantOnly > 0, "fixture must exercise the Globex tolerance");
  assert.ok(rthWithheld > 0, "fixture must exercise RTH withholding after a missing bar");
});

test("golden: VWAP levels for the LevelBook match the readings", () => {
  const series = seriesOf(goldenCandles());
  for (const i of [indexOf(series, globexAt(MON, 701)), indexOf(series, rthAt(MON, 90))]) {
    const asOf = series.time[i] + series.barMs;
    for (const level of vwapLevelsAt(series, i)) {
      const anchor = level.key === "vwap_globex" ? "globex" : "rth";
      assert.equal(level.value, vwapAt(series, anchor, asOf).value);
      assert.ok(level.availableAt <= asOf, "a level is never available before its VWAP exists");
    }
  }
});

test("Globex tolerance at the boundary: exactly 3% missing is tolerated, a bit more is not", () => {
  const asOf = globexAt(FRI, 200); // the window is the first 200 minutes
  const within = [10, 20, 30, 40, 50, 60]; // 6 of 200 = 3%
  for (const minutes of [within, [...within, 70]]) {
    const next = walk(7, 5000);
    const patches = new Map<number, Patch>([[globexAt(FRI, 0), { volume: 0 }]]);
    for (const m of minutes) patches.set(globexAt(FRI, m), null);
    const candles = buildCandles({
      dates: [FRI], base: () => next(), window: (d) => [globexAt(d, 0), globexAt(d, 200)], patches,
    });
    const series = seriesOf(candles);
    const expected = referenceVwap(candles, asOf, "globex", "globex-tolerant");
    const lab = vwapAt(series, "globex", asOf, "globex-tolerant");
    assert.strictEqual(lab.value, expected);
    assert.equal(expected !== null, minutes.length === 6, `${minutes.length} missing of 200 bars`);
    assert.equal(lab.coverage.approximate, minutes.length === 6);
  }
});

test("Globex tolerance at the boundary: a 15-minute gap is tolerated, 16 minutes is not", () => {
  const asOf = globexAt(FRI, 600); // 15 missing of 600 is 2.5%, so the share is inside the limit
  for (const gap of [15, 16]) {
    const next = walk(9, 5000);
    const patches = new Map<number, Patch>([[globexAt(FRI, 0), { volume: 0 }]]);
    for (let m = 100; m < 100 + gap; m += 1) patches.set(globexAt(FRI, m), null);
    const candles = buildCandles({
      dates: [FRI], base: () => next(), window: (d) => [globexAt(d, 0), globexAt(d, 600)], patches,
    });
    const series = seriesOf(candles);
    const expected = referenceVwap(candles, asOf, "globex", "globex-tolerant");
    assert.strictEqual(vwapAt(series, "globex", asOf, "globex-tolerant").value, expected);
    assert.equal(expected !== null, gap === 15, `${gap}-minute gap`);
    assert.strictEqual(referenceVwap(candles, asOf, "globex", "complete"), null, "the strict policy withholds any gap");
  }
});

test("a zero-volume first bar does not move VWAP and is not counted as activity", () => {
  const patches = new Map<number, Patch>([[globexAt(MON, 0), { open: 6000, high: 6000, low: 6000, close: 6000, volume: 0 }]]);
  const candles = buildCandles({ dates: [MON], base: () => flat(5000), window: (d) => [globexAt(d, 0), globexAt(d, 300)], patches });
  const series = seriesOf(candles);

  const first = vwapAt(series, "globex", globexAt(MON, 1));
  assert.equal(first.value, null, "one zero-volume bar has no VWAP yet");
  assert.equal(first.withheld, "no-volume");
  assert.equal(vwapAt(series, "globex", globexAt(MON, 2)).value, 5000, "the first real bar is its own typical price");
  assert.equal(vwapAt(series, "globex", globexAt(MON, 200)).value, 5000, "the 6000 bar never entered the sum");
  assert.equal(referenceVwap(candles, globexAt(MON, 200), "globex", "globex-tolerant"), 5000, "the reference agrees");
});

test("sessions reset: Globex at 18:00 and RTH at 09:30, with overnight prices kept out of RTH", () => {
  // Friday trades at 5000. Monday's overnight trades at 5100 and its regular session at 5200.
  const monday = (time: number) => {
    if (time < rthAt(MON, 0)) return flat(5100);
    return flat(5200);
  };
  const candles = buildCandles({
    dates: [FRI, MON],
    base: (time) => time >= globexAt(MON, 0) ? monday(time) : flat(5000),
  });
  const series = seriesOf(candles);

  assert.equal(vwapAt(series, "globex", globexAt(MON, 1)).value, 5100, "18:00 starts a new Globex session");
  assert.equal(vwapAt(series, "rth", rthAt(MON, 1)).value, 5200, "09:30 starts a new RTH session");
  const blended = vwapAt(series, "globex", rthAt(MON, 1)).value;
  assert.ok(blended !== null && blended > 5100 && blended < 5200, `Globex still holds the overnight bars (${blended})`);
});

// ----------------------------------------------------------------------------------------------
// S9 vwapRelation: reclaim once, side, slope.
// ----------------------------------------------------------------------------------------------

/** Monday RTH: ten bars at 5000, five at 4990, then 5002 from the sixteenth bar. Running VWAP at k = 15 is 4997. */
function reclaimSeries(): BarSeries {
  const price = (k: number) => (k < 10 ? 5000 : k < 15 ? 4990 : 5002);
  const patches = new Map<number, Patch>();
  for (let k = 0; k < 40; k += 1) patches.set(rthAt(MON, k), flat(price(k)));
  return seriesOf(buildCandles({ dates: [MON], base: () => flat(5000), patches }));
}

test("vwapRelation: reclaim fires once, on the bar whose close crosses above VWAP", () => {
  const series = reclaimSeries();
  const reclaims: number[] = [];
  for (let k = 1; k < 40; k += 1) {
    const values = okValues(vwapRelation, ctxAt(series, indexOf(series, rthAt(MON, k))));
    if (values.event === "reclaim") reclaims.push(k);
  }
  assert.deepEqual(reclaims, [15]);

  const at15 = okValues(vwapRelation, ctxAt(series, indexOf(series, rthAt(MON, 15))));
  assert.ok(Math.abs((at15.vwap as number) - 4997) < 1e-9, "running VWAP is 4997");
  assert.equal(at15.side, "above-far", "5 points is 20 ticks, beyond the 12-tick default");
  assert.equal(at15.distTicks, 20);
  assert.equal(okValues(vwapRelation, ctxAt(series, indexOf(series, rthAt(MON, 16)))).event, "none", "no second reclaim");
});

test("vwapRelation: the mark selects the side, and a bad anchor is rejected", () => {
  const series = reclaimSeries();
  const i = indexOf(series, rthAt(MON, 15));
  const marked = vwapRelation.compute({ ...ctxAt(series, i), mark: { price: 4997.25, side: "long" } });
  assert.ok(marked.ok && marked.values.side === "at", "a mark one tick above VWAP is 'at'");
  assert.equal(vwapRelation.preflight({ ...ctxAt(series, i), params: { anchor: "eth" } }).ok, false);
});

test("vwapRelation: slope is points per minute over five minutes", () => {
  const series = reclaimSeries();
  const values = okValues(vwapRelation, ctxAt(series, indexOf(series, rthAt(MON, 15))));
  // Five minutes earlier (k = 10) the bars are ten at 5000 and one at 4990: (5000 × 1000 + 4990 × 100) ÷ 1100.
  const earlier = (5000 * 1000 + 4990 * 100) / 1100;
  assert.ok(Math.abs((values.slope5 as number) - (4997 - earlier) / 5) < 1e-6);
});

// ----------------------------------------------------------------------------------------------
// S7 contextRanges.
// ----------------------------------------------------------------------------------------------

/** Friday (prior week, with a 6000 spike), Monday and Tuesday. Flat 5005 unless patched. */
function rangeSeries(options: { dropMondayRth?: boolean } = {}): BarSeries {
  const patches = new Map<number, Patch>([
    [rthAt(FRI, 60), { high: 6000 }],
    [globexAt(MON, 480), { high: 5010, low: 5000 }], // 02:00 Monday sets the overnight high and low
    [globexAt(MON, 540), { open: 5000, close: 5000, high: 5000, low: 5000 }], // 03:00 at the low
    [globexAt(MON, 600), { open: 5005, close: 5010, high: 5010, low: 5005 }], // 04:00 at the high
    [rthAt(MON, -1), { close: 5010, high: 5010 }], // 09:29 closes 10 points above the open
    [rthAt(MON, 30), { high: 5100 }], // 10:00 Monday: the week high
    [rthAt(TUE, 30), { close: 5010, high: 5010 }], // 10:00 Tuesday: above PDC
  ]);
  if (options.dropMondayRth) patches.set(rthAt(MON, 60), null);
  return seriesOf(buildCandles({ dates: [FRI, MON, TUE], base: () => flat(5005), patches }));
}

test("contextRanges: overnight position is 0 at the low, 50 mid, 100 at the high", () => {
  const series = rangeSeries();
  const at = (k: number) => okValues(contextRanges, ctxAt(series, indexOf(series, globexAt(MON, k))));
  assert.equal(at(540).overnightPosPct, 0);
  assert.equal(at(600).overnightPosPct, 100);
  const mid = at(660);
  assert.equal(mid.overnightPosPct, 50);
  assert.equal(mid.overnightRange, 10);
  assert.equal(mid.overnightTrend, "flat", "the overnight open and latest close are level");
});

test("contextRanges: the overnight trend turns up once the close is beyond a quarter of the range, and the high freezes at 09:30", () => {
  const series = rangeSeries();
  const after = okValues(contextRanges, ctxAt(series, indexOf(series, rthAt(MON, 0))));
  assert.equal(after.overnightTrend, "up", "09:29 closed 5 points above the 5005 open of a 10-point range");
  assert.equal(after.overnightHigh, 5010);
});

test("contextRanges: week to date starts at the Monday session, so Friday's spike is excluded", () => {
  const series = rangeSeries();
  assert.equal(okValues(contextRanges, ctxAt(series, indexOf(series, globexAt(MON, 660)))).weekHigh, 5010, "Friday's 6000 is last week");
  const tuesday = okValues(contextRanges, ctxAt(series, indexOf(series, rthAt(TUE, 30))));
  assert.equal(tuesday.weekHigh, 5100, "Monday's 5100 is this week");
  assert.equal(tuesday.weekLow, 5000);
});

test("contextRanges: prior RTH range and direction, and the PDC side", () => {
  const series = rangeSeries();
  const tuesday = okValues(contextRanges, ctxAt(series, indexOf(series, rthAt(TUE, 30))));
  assert.equal(tuesday.yesterdayRange, 95, "Monday RTH 5005 to 5100");
  assert.equal(tuesday.yesterdayDirection, "flat");
  assert.equal(tuesday.pdcSide, "above", "close 5010 against PDC 5005");
  assert.equal(tuesday.pdcDistPoints, 5);
});

test("contextRanges: a missing prior RTH bar nulls the yesterday outputs", () => {
  const series = rangeSeries({ dropMondayRth: true });
  const tuesday = okValues(contextRanges, ctxAt(series, indexOf(series, rthAt(TUE, 30))));
  assert.equal(tuesday.yesterdayRange, null);
  assert.equal(tuesday.yesterdayDirection, null);
});

// ----------------------------------------------------------------------------------------------
// S8 openingRange.
// ----------------------------------------------------------------------------------------------

/** Monday from 08:30 to 10:10. The opening range is 09:30–09:44, high 5010 and low 5000. */
function openingSeries(): BarSeries {
  const patches = new Map<number, Patch>([
    [rthAt(MON, 0), { high: 5010 }],
    [rthAt(MON, 10), { low: 5000 }],
    [rthAt(MON, 16), { close: 5011, high: 5011 }], // 09:46 closes above the range
    [rthAt(MON, 17), { open: 5011, close: 5012, high: 5012 }], // 09:47 still above
    [rthAt(MON, 18), { open: 5012, close: 5009, high: 5012, low: 5008.75 }], // 09:48 back inside: a failed break
    [rthAt(MON, 25), { close: 5012, high: 5012 }], // 09:55 closes above, with no break in its five-bar window
  ]);
  return seriesOf(buildCandles({
    dates: [MON], base: () => flat(5005), window: (d) => [rthAt(d, -60), rthAt(d, 40)], patches,
  }));
}

test("openingRange: unavailable until the range has closed, then reports levels and relation", () => {
  const series = openingSeries();
  const early = openingRange.compute(ctxAt(series, indexOf(series, rthAt(MON, 10))));
  assert.ok(!early.ok && early.reason === "not-known-yet");

  const closed = okValues(openingRange, ctxAt(series, indexOf(series, rthAt(MON, 14))));
  assert.equal(closed.orHigh, 5010);
  assert.equal(closed.orLow, 5000);
  assert.equal(closed.orMid, 5005);
  assert.equal(closed.orWidthPoints, 10);
  assert.equal(closed.relation, "inside");
  assert.equal(closed.failedBreakUp, false, "no break yet");
  assert.equal(closed.widthBucket, null, "fewer than six prior ranges");

  const above = okValues(openingRange, ctxAt(series, indexOf(series, rthAt(MON, 25))));
  assert.equal(above.relation, "above");
  assert.equal(above.failedBreakUp, false, "a close above that stays above is not a failure");
});

test("openingRange: a break above that closes back inside within the window is a failed break", () => {
  const series = openingSeries();
  const failed = okValues(openingRange, ctxAt(series, indexOf(series, rthAt(MON, 18))));
  assert.equal(failed.failedBreakUp, true);
  assert.equal(failed.failedBreakDown, false);
  assert.equal(failed.relation, "inside");
});

test("openingRange: the width bucket uses terciles of the prior sessions' ranges", () => {
  // Seven prior sessions with ranges 1–7 points, then the decision session. Its width is the variable.
  const chain = [
    "2026-07-03", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", FRI, MON, TUE,
  ];
  const bucketFor = (decisionWidth: number) => {
    const patches = new Map<number, Patch>();
    chain.forEach((date, n) => patches.set(rthAt(date, 0), { high: 5005 + (n < 7 ? n + 1 : decisionWidth) }));
    const series = seriesOf(buildCandles({
      dates: chain, base: () => flat(5005), window: (d) => [rthAt(d, 0), rthAt(d, 20)], patches,
    }));
    return okValues(openingRange, ctxAt(series, indexOf(series, rthAt(TUE, 14)))).widthBucket;
  };
  // Prior terciles over 1–7: low edge 3, high edge 5.
  assert.equal(bucketFor(4.5), "medium");
  assert.equal(bucketFor(0.5), "narrow");
  assert.equal(bucketFor(6.5), "wide");
});

// ----------------------------------------------------------------------------------------------
// Shared: metadata, declared output keys, and the known-at harness.
// ----------------------------------------------------------------------------------------------

test("context skills: registered metadata, declared output keys, and no lookahead", () => {
  assert.deepEqual(CONTEXT_SKILLS.map(({ meta }) => `${meta.id}@${meta.version}`), [
    "contextRanges@1.0.0", "openingRange@1.0.0", "vwapRelation@1.0.0",
  ]);
  assert.equal(contextRanges.meta.kind, "feature");
  assert.equal(openingRange.meta.kind, "feature");
  assert.equal(vwapRelation.meta.kind, "label");

  const series = seriesOf(goldenCandles());
  const levelIndex = createLevelIndex(series);
  for (const date of [FRI, MON, TUE]) {
    for (const k of [90, 200]) {
      const ctx = ctxAt(series, indexOf(series, rthAt(date, k)), levelIndex);
      for (const skill of CONTEXT_SKILLS) assertNoLookahead(skill, ctx);
    }
  }
  // Friday's regular session is complete, so every skill is computed rather than skipped.
  const friday = ctxAt(series, indexOf(series, rthAt(FRI, 90)), levelIndex);
  for (const skill of CONTEXT_SKILLS) okValues(skill, friday);

  // Default SKILLS registry wires all 23 skills: S1–S9, V1–V5, M1–M3, plus 6 batch-2 skills.
  assert.equal(Object.keys(SKILLS).length, 23);
  assert.equal(listSkills().length, 23);
  for (const skill of CONTEXT_SKILLS) {
    assert.equal(getSkill(skill.meta.id), skill);
  }
});
