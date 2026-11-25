import test from "node:test";
import assert from "node:assert/strict";
import { equityIndexSessionBounds } from "../session.ts";
import { createLevelIndex, levelBookAt, resolveLevelsAt, withLevels } from "../strategy-lab/levels.ts";
import { createSkillRegistry, getSkill, listSkills } from "../strategy-lab/registry.ts";
import { levelMap, structureStop } from "../strategy-lab/skills/levels.ts";
import { buildBarSeries, truncateSeries } from "../strategy-lab/series.ts";
import type { LabLevel, LevelBook, LevelKey, SkillContext, SourceBar, Value } from "../strategy-lab/types.ts";
import { assertNoLookahead } from "./strategy-lab-lookahead-harness.ts";

const MINUTE = 60_000;
const PRIOR = "2026-07-10"; // Friday
const MONDAY = "2026-07-13";
const THURSDAY = "2026-07-16";
const SPEC = { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 } as const;

/** Wall-clock ET minute on a trading date. 0–569 is the same calendar day before 09:30; 1080 is 18:00 the day before. */
function at(date: string, minuteOfDay: number): number {
  return equityIndexSessionBounds(date).rthOpen + (minuteOfDay - 570) * MINUTE;
}

interface BuildOptions {
  /** Return true to leave a minute out of the series. */
  drop?: (time: number, date: string) => boolean;
  /** Overrides applied to individual bars, keyed by UTC open time. */
  patch?: Map<number, Partial<SourceBar>>;
}

/** Full 1m Globex sessions with deterministic, valid OHLC (volume 100). */
function buildSessions(dates: readonly string[], options: BuildOptions = {}) {
  const bars: SourceBar[] = [];
  for (const date of dates) {
    const bounds = equityIndexSessionBounds(date);
    for (let time = bounds.open; time < bounds.close; time += MINUTE) {
      if (options.drop?.(time, date)) continue;
      const offset = (time - bounds.open) / MINUTE;
      const price = 5000 + ((offset * 7) % 13) * 0.25;
      const bar: SourceBar = { time, open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 100 };
      bars.push({ ...bar, ...options.patch?.get(time) });
    }
  }
  return buildBarSeries("MES", bars);
}

function patchOf(entries: [number, Partial<SourceBar>][]): Map<number, Partial<SourceBar>> {
  return new Map(entries);
}

function levelOf(book: LevelBook, key: LevelKey): LabLevel | undefined {
  return book.byKey.get(key);
}

function snapshot(book: LevelBook) {
  return book.levels.map(({ key, value, availableAt, approx }) => ({ key, value, availableAt, approx }));
}

test("ONH and ONL are absent before 09:30 and present from the first RTH bar's close", () => {
  const series = buildSessions([PRIOR, MONDAY], {
    patch: patchOf([
      [at(MONDAY, 3 * 60), { high: 5050 }],
      [at(MONDAY, 2 * 60), { low: 4990 }],
    ]),
  });
  const index = createLevelIndex(series);
  const before = levelBookAt(index, series.byTime.get(at(MONDAY, 9 * 60 + 29))!);
  assert.equal(levelOf(before, "onh"), undefined, "ONH must not exist at the 09:29 decision");
  assert.equal(levelOf(before, "rth_open"), undefined);

  const firstRth = levelBookAt(index, series.byTime.get(at(MONDAY, 9 * 60 + 30))!);
  assert.equal(levelOf(firstRth, "onh")?.value, 5050);
  assert.equal(levelOf(firstRth, "onl")?.value, 4990);
  assert.equal(levelOf(firstRth, "onh")?.availableAt, at(MONDAY, 9 * 60 + 31));
  assert.equal(levelOf(firstRth, "rth_open")?.value, series.open[series.byTime.get(at(MONDAY, 9 * 60 + 30))!]);
});

test("prior-session extremes are exact and pdc is always approximate (≈)", () => {
  const series = buildSessions([PRIOR, MONDAY], {
    patch: patchOf([
      [at(PRIOR, 10 * 60), { high: 5100 }],
      [at(PRIOR, 11 * 60), { low: 4900 }],
    ]),
  });
  const index = createLevelIndex(series);
  const book = levelBookAt(index, series.byTime.get(at(MONDAY, 10 * 60))!);
  const pdh = levelOf(book, "pdh");
  const pdl = levelOf(book, "pdl");
  const pdc = levelOf(book, "pdc");
  assert.equal(pdh?.value, 5100);
  assert.equal(pdl?.value, 4900);
  assert.equal(pdh?.approx, false, "a complete prior session is exact");
  assert.equal(pdc?.approx, true, "PDC is the last RTH close, labelled ≈");
  assert.equal(pdc?.value, series.close[series.byTime.get(at(PRIOR, 15 * 60 + 59))!]);
  assert.equal(pdh?.availableAt, equityIndexSessionBounds(PRIOR).close, "prior extremes are known at the prior session's close");
});

test("extremes are withheld when the prior session misses more than 3% of bars or has a gap over 15 minutes", () => {
  const offsetOf = (time: number, date: string) => (time - equityIndexSessionBounds(date).open) / MINUTE;
  const priorOnly = (drop: (time: number, date: string) => boolean) =>
    buildSessions([PRIOR, MONDAY], { drop: (time, date) => date === PRIOR && drop(time, date) });
  const pdhAt = (series: ReturnType<typeof buildSessions>) => {
    const index = createLevelIndex(series);
    return resolveLevelsAt(index, series.byTime.get(at(MONDAY, 10 * 60))!);
  };

  // 28 of 1,380 bars (2.0%) missing in scattered single minutes: usable and approximate.
  const twoPercent = pdhAt(priorOnly((time, date) => offsetOf(time, date) % 50 === 0));
  assert.equal(levelOf(twoPercent.book, "pdh")?.approx, true);
  assert.equal(twoPercent.withheld.pdh, undefined);

  // 69 of 1,380 bars (5.0%) missing: withheld.
  const fivePercent = pdhAt(priorOnly((time, date) => offsetOf(time, date) % 20 === 5));
  assert.equal(levelOf(fivePercent.book, "pdh"), undefined);
  assert.equal(levelOf(fivePercent.book, "pdl"), undefined);
  assert.match(fivePercent.withheld.pdh ?? "", /missing/);

  // A single 16-minute gap (1.2% of bars) exceeds the 15-minute limit: withheld.
  const sixteenGap = pdhAt(priorOnly((time, date) => offsetOf(time, date) >= 300 && offsetOf(time, date) < 316));
  assert.equal(levelOf(sixteenGap.book, "pdh"), undefined);
  assert.match(sixteenGap.withheld.pdh ?? "", /longest gap 16 min/);

  // A 15-minute gap is still inside the limit.
  const fifteenGap = pdhAt(priorOnly((time, date) => offsetOf(time, date) >= 300 && offsetOf(time, date) < 315));
  assert.equal(levelOf(fifteenGap.book, "pdh")?.approx, true);
});

test("opening range exists only after its 15th bar closes and is withheld when incomplete", () => {
  const series = buildSessions([PRIOR, MONDAY], {
    patch: patchOf([[at(MONDAY, 9 * 60 + 35), { high: 5020, low: 4980 }]]),
  });
  const index = createLevelIndex(series);
  const beforeEnd = levelBookAt(index, series.byTime.get(at(MONDAY, 9 * 60 + 43))!);
  assert.equal(levelOf(beforeEnd, "or_high"), undefined);
  const atEnd = levelBookAt(index, series.byTime.get(at(MONDAY, 9 * 60 + 44))!);
  assert.equal(levelOf(atEnd, "or_high")?.value, 5020);
  assert.equal(levelOf(atEnd, "or_low")?.value, 4980);
  assert.equal(levelOf(atEnd, "or_mid")?.value, 5000);
  assert.equal(levelOf(atEnd, "or_high")?.availableAt, at(MONDAY, 9 * 60 + 45));

  const holed = buildSessions([PRIOR, MONDAY], { drop: (time, date) => date === MONDAY && time === at(MONDAY, 9 * 60 + 37) });
  const resolved = resolveLevelsAt(createLevelIndex(holed), holed.byTime.get(at(MONDAY, 9 * 60 + 44))!);
  assert.equal(levelOf(resolved.book, "or_high"), undefined);
  assert.match(resolved.withheld.or_high ?? "", /opening range incomplete/);
});

test("week high and low are week-to-date and grow only as bars close", () => {
  const series = buildSessions([PRIOR, MONDAY, "2026-07-14", "2026-07-15", THURSDAY], {
    patch: patchOf([
      [at("2026-07-10", 10 * 60), { high: 9999, low: 1 }],
      [at("2026-07-14", 10 * 60), { high: 5200, low: 4800 }],
      [at(THURSDAY, 11 * 60), { high: 5300 }],
    ]),
  });
  const index = createLevelIndex(series);
  const at0900 = levelBookAt(index, series.byTime.get(at(THURSDAY, 9 * 60))!);
  assert.equal(levelOf(at0900, "week_high")?.value, 5200, "the prior week's Friday is excluded");
  assert.equal(levelOf(at0900, "week_low")?.value, 4800);
  const before = levelBookAt(index, series.byTime.get(at(THURSDAY, 10 * 60 + 59))!);
  assert.equal(levelOf(before, "week_high")?.value, 5200, "a high at 11:00 is unknown at 10:59");
  const after = levelBookAt(index, series.byTime.get(at(THURSDAY, 11 * 60))!);
  assert.equal(levelOf(after, "week_high")?.value, 5300);
});

test("levels at bar i are identical when every later bar is deleted (known-at)", () => {
  const dates = [PRIOR, MONDAY, "2026-07-14", "2026-07-15", THURSDAY];
  const series = buildSessions(dates, {
    patch: patchOf([
      [at(PRIOR, 10 * 60), { high: 5100 }],
      [at(MONDAY, 3 * 60), { high: 5050 }],
      [at(MONDAY, 9 * 60 + 35), { high: 5020, low: 4980 }],
      [at(THURSDAY, 11 * 60), { high: 5300 }],
    ]),
  });
  const index = createLevelIndex(series);
  const probes = [at(MONDAY, 9 * 60 + 29), at(MONDAY, 9 * 60 + 30), at(MONDAY, 9 * 60 + 44), at(THURSDAY, 10 * 60 + 59), at(THURSDAY, 11 * 60), at(THURSDAY, 15 * 60)];
  for (const time of probes) {
    const i = series.byTime.get(time)!;
    const full = levelBookAt(index, i);
    const truncated = levelBookAt(createLevelIndex(truncateSeries(series, i)), i);
    assert.deepEqual(snapshot(truncated), snapshot(full), `levels changed after deleting bars past ${new Date(time).toISOString()}`);
  }
});

test("withLevels adds externally computed levels only when they are available", () => {
  const book = levelBookAt(createLevelIndex(buildSessions([PRIOR, MONDAY])), 100);
  const extra: LabLevel[] = [
    { key: "vwap_globex", value: 5001.5, availableAt: book.asOf, approx: false },
    { key: "vwap_rth", value: 5002, availableAt: book.asOf + MINUTE, approx: false },
  ];
  const merged = withLevels(book, extra);
  assert.equal(levelOf(merged, "vwap_globex")?.value, 5001.5);
  assert.equal(levelOf(merged, "vwap_rth"), undefined, "a level available later is dropped");
});

// ---- S5 levelMap and S6 structureStop: pure skill math on synthetic books ----

function bookOf(entries: [LevelKey, number][]): LevelBook {
  const levels = entries.map(([key, value]) => ({ key, value, availableAt: 0, approx: false }));
  return { asOf: 0, levels, byKey: new Map(levels.map((level) => [level.key, level])) };
}

function singleBar(close: number, high = close + 0.5, low = close - 0.5, time = 1_000_000) {
  return buildBarSeries("MES", [{ time, open: close, high, low, close, volume: 100 }]);
}

function ctxOf(series: ReturnType<typeof singleBar>, params: Record<string, Value>, levels: LevelBook, extra: Partial<SkillContext> = {}): SkillContext {
  return { series, i: 0, params, spec: SPEC, rSizeUsd: 300, levels, ...extra };
}

test("S5 level mode: 6.25 pt gap is 25 ticks, $31.25 per contract, 0.104 R at $300", () => {
  const series = singleBar(5000, 5001, 4999.5);
  const ctx = ctxOf(series, { level: "pdl", toleranceTicks: 2 }, bookOf([["pdl", 4993.75]]));
  assert.deepEqual(levelMap.preflight(ctx), { ok: true });
  const result = levelMap.compute(ctx);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.closeDistTicks, 25);
  assert.equal(result.values.distPoints, 6.25);
  assert.equal(result.values.distUsd, 31.25);
  assert.equal(Math.round(Number(result.values.distR) * 1000) / 1000, 0.104);
  assert.equal(result.values.touch, false, "bar low 4999.5 is 5.75 pt above the level plus tolerance");
  assert.equal(result.values.nearestAboveKey, null);
});

test("S5 level mode: touch is true when the bar range reaches the level ± tolerance", () => {
  const series = singleBar(5000, 5001, 4994);
  const result = levelMap.compute(ctxOf(series, { level: "pdl", toleranceTicks: 2 }, bookOf([["pdl", 4993.75]])));
  assert.equal(result.ok && result.values.touch, true);
});

test("S5 with a level that is not available yet is a counted no-level skip", () => {
  const series = singleBar(5000);
  const result = levelMap.preflight(ctxOf(series, { level: "onh", toleranceTicks: 2 }, bookOf([["pdl", 4993.75]])));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no-level");
});

test("S5 context mode lists the nearest level above and below, signed in ticks", () => {
  const levels = bookOf([["pdc", 5000], ["pdh", 5010], ["onh", 5018.25], ["pdl", 4993.75]]);
  const result = levelMap.compute(ctxOf(singleBar(5000), {}, levels));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.nearestAboveKey, "pdc");
  assert.equal(result.values.nearestAboveTicks, 0);
  assert.equal(result.values.nearestBelowKey, "pdl");
  assert.equal(result.values.nearestBelowTicks, -25);
  assert.equal(result.notes?.length, 4, "the full list is in notes");
  assert.ok(result.notes?.includes("PDL -25 ticks"));
});

test("S5 context mode measures from the mark, not the decision close", () => {
  const levels = bookOf([["pdh", 5010], ["onh", 5018.25], ["pdl", 4993.75]]);
  const result = levelMap.compute(ctxOf(singleBar(5000), {}, levels, { mark: { price: 5012, side: "long" } }));
  assert.equal(result.ok && result.values.nearestAboveKey, "onh");
  assert.equal(result.ok && result.values.nearestAboveTicks, 25);
  assert.equal(result.ok && result.values.nearestBelowTicks, -8);
});

test("S6 long: stop 2 ticks below the low, $10 per contract, 7 contracts at 0.25 R of $300", () => {
  const bars: SourceBar[] = Array.from({ length: 16 }, (_, k) => ({
    time: 1_000_000 + k * MINUTE, open: 5912.5, high: 5913, low: 5912, close: 5912.25, volume: 100,
  }));
  bars[13] = { ...bars[13], low: 5910.75 };
  const series = buildBarSeries("MES", bars);
  const levels = bookOf([["pdh", 5905], ["onh", 5930.25]]);
  const ctx = ctxOf(series, {}, levels, { i: 15, mark: { price: 5912.25, side: "long" } });
  assert.deepEqual(structureStop.preflight(ctx), { ok: true });
  const result = structureStop.compute(ctx);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.stopPrice, 5910.25);
  assert.equal(result.values.stopPoints, 2);
  assert.equal(result.values.stopTicks, 8);
  assert.equal(result.values.stopUsdPerContract, 10);
  assert.equal(result.values.qtyAtRiskR, 7);
  assert.equal(result.values.riskR, 0.233333);
  assert.equal(result.values.oversized, false);
  assert.equal(result.values["rrTo.onh"], 9, "(5930.25 − 5912.25) ÷ 2.00");
  assert.equal(result.values["rrTo.pdh"], null, "pdh is below a long entry, so it is not a target");
});

test("S6 sizes from the fixed account R, not from the stop width", () => {
  const bars: SourceBar[] = Array.from({ length: 16 }, (_, k) => ({
    time: 1_000_000 + k * MINUTE, open: 5912.5, high: 5913, low: 5912, close: 5912.25, volume: 100,
  }));
  bars[13] = { ...bars[13], low: 5910.75 };
  const series = buildBarSeries("MES", bars);
  const base = { i: 15, mark: { price: 5912.25, side: "long" as const } };
  const fallback = structureStop.compute(ctxOf(series, {}, bookOf([]), { ...base, rSizeUsd: 250 }));
  assert.equal(fallback.ok && fallback.values.qtyAtRiskR, 6, "$250 R: 62.50 budget ÷ $10 = 6");
  assert.equal(fallback.ok && fallback.values.riskR, 0.24);

  const tiny = structureStop.compute(ctxOf(series, { riskR: 0.01 }, bookOf([]), base));
  assert.equal(tiny.ok && tiny.values.qtyAtRiskR, 1, "never below one contract");
  assert.equal(tiny.ok && tiny.values.oversized, true, "one contract already exceeds the target");
});

test("S6 stop distance of zero is bad-params, never a division", () => {
  const bars: SourceBar[] = [{ time: 1_000_000, open: 5910.25, high: 5911, low: 5910.25, close: 5910.25, volume: 100 }];
  const series = buildBarSeries("MES", bars);
  const result = structureStop.compute(ctxOf(series, { ticks: 0 }, bookOf([]), { mark: { price: 5910.25, side: "long" } }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "bad-params");
});

test("S6 short mirrors long: stop above the highest high, targets below", () => {
  const bars: SourceBar[] = Array.from({ length: 16 }, (_, k) => ({
    time: 1_000_000 + k * MINUTE, open: 5888.25, high: 5888.5, low: 5887.5, close: 5888.25, volume: 100,
  }));
  bars[13] = { ...bars[13], high: 5889.75 };
  const series = buildBarSeries("MES", bars);
  const levels = bookOf([["pdl", 5870.25], ["pdh", 5900]]);
  const result = structureStop.compute(ctxOf(series, {}, levels, { i: 15, mark: { price: 5888.25, side: "short" } }));
  assert.equal(result.ok && result.values.stopPrice, 5890.25);
  assert.equal(result.ok && result.values.stopPoints, 2);
  assert.equal(result.ok && result.values.qtyAtRiskR, 7);
  assert.equal(result.ok && result.values["rrTo.pdl"], 9, "(5888.25 − 5870.25) ÷ 2.00");
  assert.equal(result.ok && result.values["rrTo.pdh"], null);
});

// ---- Known-at harness for both skills ----

test("levelMap and structureStop read no bar after the decision bar", () => {
  const series = buildSessions([PRIOR, MONDAY], {
    patch: patchOf([[at(MONDAY, 9 * 60 + 35), { high: 5020, low: 4980 }]]),
  });
  const index = createLevelIndex(series);
  for (const time of [at(MONDAY, 9 * 60 + 31), at(MONDAY, 9 * 60 + 35), at(MONDAY, 10 * 60)]) {
    const i = series.byTime.get(time)!;
    const ctx: SkillContext = { series, i, params: {}, spec: SPEC, rSizeUsd: 300, levels: levelBookAt(index, i) };
    assertNoLookahead(levelMap, ctx);
    assertNoLookahead(levelMap, { ...ctx, params: { level: "onh", toleranceTicks: 2 } });
    assertNoLookahead(structureStop, { ...ctx, params: { side: "long", ticks: 2, lookbackBars: 15, riskR: 0.25 } });
    assertNoLookahead(structureStop, { ...ctx, params: { side: "short", ticks: 2, lookbackBars: 30, riskR: 0.25 } });
  }
});

test("registry exposes both skills with unique output keys matching their values", () => {
  const registry = createSkillRegistry([levelMap, structureStop]);
  assert.equal(getSkill("levelMap", registry), levelMap);
  assert.equal(getSkill("structureStop@1", registry), structureStop);
  const metas = listSkills(registry);
  assert.deepEqual(metas.map((meta) => meta.id), ["levelMap", "structureStop"]);
  for (const meta of metas) {
    assert.equal(meta.kind, "feature");
    assert.equal(new Set(meta.outputs.map((output) => output.key)).size, meta.outputs.length);
  }
  const ctx = ctxOf(singleBar(5000), {}, bookOf([["pdl", 4993.75]]), { mark: { price: 5000, side: "long" } });
  const result = levelMap.compute(ctx);
  assert.equal(result.ok, true);
  if (result.ok) {
    for (const key of Object.keys(result.values)) {
      assert.ok(levelMap.meta.outputs.some((output) => output.key === key), `undeclared output ${key}`);
    }
  }
});
