import assert from "node:assert/strict";
import { test } from "node:test";
import { computeEma200 } from "../ema.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import { EMA_PROFILE_SKILLS, emaRelation, profileRelation } from "../strategy-lab/skills/ema-profile.ts";
import type {
  BarSeries, LevelBook, SkillContext, SkillPreflight, SkillResult, SourceBar, Value,
} from "../strategy-lab/types.ts";
import { computeSessionIndicators } from "../session-indicators.ts";
import type { Candle } from "../trades.ts";
import { assertNoLookahead } from "./strategy-lab-lookahead-harness.ts";

const MIN = 60_000;
const TICK = 0.25;
const DAY = "2026-11-24";
// Nov 24 2026 is EST (−05:00).
const et = (hhmm: string, date = DAY) => Date.parse(`${date}T${hhmm}:00-05:00`);
const ALPHA_200 = 2 / 201;

function bar(time: number, close: number, volume: number | null = 100): SourceBar {
  return { time, open: close, high: close + 0.5, low: close - 0.5, close, volume };
}

/** Contiguous 1m bars from 18:00 ET, so the 5m buckets are ET-aligned. */
function continuousBars(count: number, closeOf: (k: number) => number): SourceBar[] {
  const start = et("18:00");
  return Array.from({ length: count }, (_, k) => bar(start + k * MIN, closeOf(k)));
}

function candlesOf(bars: readonly SourceBar[]): Candle[] {
  return bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }));
}

function ctxOf(series: BarSeries, i: number, params: Record<string, Value> = {}): SkillContext {
  const levels: LevelBook = { asOf: series.time[i] + series.barMs, levels: [], byKey: new Map() };
  return { series, i, params, spec: { symbol: "MES", tickSize: TICK, pointValueUsd: 5 }, rSizeUsd: 300, levels };
}

function valuesOf(result: SkillResult): Record<string, Value> {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.values;
}

function assertSkip(result: SkillResult | SkillPreflight, reason: string) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.reason, reason);
}

function assertClose(actual: Value, expected: number, epsilon = 1e-6) {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs((actual as number) - expected) < epsilon, `${actual} vs ${expected}`);
}

const closeAt = (k: number) => 5000 + 8 * Math.sin(k / 37) + 0.003 * k + 2 * Math.sin(k / 3);

// ---------- emaRelation ----------

test("emaRelation (1m) matches computeEma200 at sampled bars, from the 700th bar", () => {
  const source = continuousBars(1200, closeAt);
  const series = buildBarSeries("MES", source);
  const points = new Map(computeEma200(candlesOf(source), "1m").points.map((p) => [p.time, p.value]));
  for (const i of [699, 700, 701, 760, 800, 900, 1000, 1050, 1100, 1199]) {
    const expected = points.get(series.time[i]);
    assert.notEqual(expected, undefined, `point at ${i}`);
    assertClose(valuesOf(emaRelation.compute(ctxOf(series, i))).ema200, expected as number);
  }
});

test("emaRelation skips with warmup below 700 bars and starts at the 700th", () => {
  const series = buildBarSeries("MES", continuousBars(700, () => 5000));
  assertSkip(emaRelation.preflight(ctxOf(series, 698)), "warmup");
  assertSkip(emaRelation.compute(ctxOf(series, 698)), "warmup");
  assert.equal(valuesOf(emaRelation.compute(ctxOf(series, 699))).ema200, 5000);
});

test("emaRelation rejects out-of-range params as bad-params", () => {
  const series = buildBarSeries("MES", continuousBars(800, () => 5000));
  assertSkip(emaRelation.compute(ctxOf(series, 799, { minutes: 3 })), "bad-params");
  assertSkip(emaRelation.compute(ctxOf(series, 799, { farTicks: 3 })), "bad-params");
  assertSkip(emaRelation.compute(ctxOf(series, 799, { slopeBars: 31 })), "bad-params");
});

test("emaRelation on a flat market: at, neutral stack, zero slope", () => {
  const series = buildBarSeries("MES", continuousBars(800, () => 5000));
  const values = valuesOf(emaRelation.compute(ctxOf(series, 799)));
  assert.deepEqual(
    { ema200: values.ema200, ema20: values.ema20, dist200Ticks: values.dist200Ticks, side200: values.side200, side20: values.side20, stack: values.stack, slope200: values.slope200 },
    { ema200: 5000, ema20: 5000, dist200Ticks: 0, side200: "at", side20: "at", stack: "mixed", slope200: 0 },
  );
});

test("emaRelation: a 5-tick step up above the far band reads above-far and bull", () => {
  const series = buildBarSeries("MES", continuousBars(800, (k) => (k < 799 ? 5000 : 5005)));
  const values = valuesOf(emaRelation.compute(ctxOf(series, 799)));
  // The last bar moves each EMA by alpha × 5 points only; the seeds are flat at 5000.
  assertClose(values.ema200, 5000 + 5 * ALPHA_200);
  assertClose(values.ema20, 5000 + 5 * (2 / 21));
  assertClose(values.dist200Ticks, (5005 - (5000 + 5 * ALPHA_200)) / TICK);
  assert.equal(values.side200, "above-far");
  assert.equal(values.side20, "above");
  assert.equal(values.stack, "bull");
  // Slope: (EMA now − EMA five bars ago) / 5 bars; five bars ago the EMA was still flat at 5000.
  assertClose(values.slope200, ALPHA_200);
});

test("emaRelation: a 5-tick step down reads below-far and bear", () => {
  const series = buildBarSeries("MES", continuousBars(800, (k) => (k < 799 ? 5000 : 4995)));
  const values = valuesOf(emaRelation.compute(ctxOf(series, 799)));
  assert.equal(values.side200, "below-far");
  assert.equal(values.side20, "below");
  assert.equal(values.stack, "bear");
  assertClose(values.slope200, -ALPHA_200);
});

test("emaRelation: side200 'above' sits between the at band and the far band", () => {
  // A one-point move is four ticks: beyond the ±2-tick "at" band, inside the ±12-tick far band.
  const series = buildBarSeries("MES", continuousBars(800, (k) => (k < 799 ? 5000 : 5001)));
  const values = valuesOf(emaRelation.compute(ctxOf(series, 799)));
  assert.equal(values.side200, "above");
  assert.equal(values.stack, "bull");
});

test("emaRelation (5m) uses only completed ET buckets and never the forming one", () => {
  const source = continuousBars(4000, closeAt);
  const series = buildBarSeries("MES", source);
  const candles5: Candle[] = [];
  for (let b = 0; b * 5 < source.length; b += 1) {
    const slice = source.slice(b * 5, b * 5 + 5);
    candles5.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max(...slice.map((s) => s.high)),
      low: Math.min(...slice.map((s) => s.low)),
      close: slice[slice.length - 1].close,
      volume: 500,
    });
  }
  const points = new Map(computeEma200(candles5, "5m").points.map((p) => [p.time, p.value]));
  for (const i of [3499, 3502, 3503, 3504, 3999]) {
    const last = i % 5 === 4 ? Math.floor(i / 5) : Math.floor(i / 5) - 1;
    const expected = points.get(source[0].time + last * 5 * MIN);
    assert.notEqual(expected, undefined, `5m point for decision bar ${i}`);
    assertClose(valuesOf(emaRelation.compute(ctxOf(series, i, { minutes: 5 }))).ema200, expected as number);
  }
});

test("emaRelation (5m) warm-up counts completed buckets: 700 buckets = 3500 minutes", () => {
  const series = buildBarSeries("MES", continuousBars(4000, closeAt));
  assertSkip(emaRelation.compute(ctxOf(series, 3498, { minutes: 5 })), "warmup");
  assert.ok(valuesOf(emaRelation.compute(ctxOf(series, 3499, { minutes: 5 }))).ema200 !== null);
});

// ---------- profileRelation ----------

const RTH_VOLUME = (k: number) => 50 + ((k * 37) % 200);
const RTH_PRICE = (k: number) => 5000 + 4 * Math.sin(k / 9) + 0.5 * Math.sin(k / 2.3);

function rthBars(count = 390, volumeOf: (k: number) => number | null = RTH_VOLUME): SourceBar[] {
  return Array.from({ length: count }, (_, k) => bar(et("09:30") + k * MIN, RTH_PRICE(k), volumeOf(k)));
}

const lastOf = (series: BarSeries) => series.time.length - 1;

test("profileRelation (rth) matches computeSessionIndicators poc/vah/val to the tick", () => {
  const bars = rthBars();
  const series = buildBarSeries("MES", bars);
  const session = computeSessionIndicators(candlesOf(bars), {
    symbol: "MES", timeframe: "1m", asOf: et("16:00"), anchor: "rth",
  });
  assert.ok(session);
  const price = (key: string) => session.levels.find((level) => level.key === key)?.price;
  const values = valuesOf(profileRelation.compute(ctxOf(series, lastOf(series), { anchor: "rth" })));
  assert.equal(values.poc, price("poc"));
  assert.equal(values.vah, price("vah"));
  assert.equal(values.val, price("val"));
  assert.equal(values.vaWidthPoints, (price("vah") as number) - (price("val") as number));
});

test("profileRelation (globex) equals rth when the data is one RTH session", () => {
  const series = buildBarSeries("MES", rthBars());
  const i = lastOf(series);
  assert.deepEqual(
    valuesOf(profileRelation.compute(ctxOf(series, i, { anchor: "globex" }))),
    valuesOf(profileRelation.compute(ctxOf(series, i, { anchor: "rth" }))),
  );
});

test("profileRelation is degraded and carries the estimate warning", () => {
  assert.equal(profileRelation.meta.status, "degraded");
  assert.deepEqual(profileRelation.meta.warnings, [
    "Estimated from 1-minute OHLCV typical price; true futures volume profile requires tick data.",
  ]);
  assert.deepEqual(EMA_PROFILE_SKILLS.map((skill) => skill.meta.id), ["emaRelation", "profileRelation"]);
});

test("profileRelation skips zero and NaN volume bars without moving POC", () => {
  const artifactIndices = new Set([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  const clean = rthBars().filter((_, k) => !artifactIndices.has(k));
  const artifacts = (volume: number | null) => [...artifactIndices].map((k) => ({
    time: et("09:30") + k * MIN, open: 5100, high: 5100.5, low: 5099.5, close: 5100, volume,
  }));
  const reference = valuesOf(profileRelation.compute(ctxOf(buildBarSeries("MES", clean), clean.length - 1, { anchor: "rth" })));
  for (const volume of [0, null]) {
    const dirty = buildBarSeries("MES", [...clean, ...artifacts(volume)].sort((a, b) => a.time - b.time));
    assert.deepEqual(valuesOf(profileRelation.compute(ctxOf(dirty, lastOf(dirty), { anchor: "rth" }))), reference);
  }
});

test("profileRelation: exactly 20% missing volume passes, one more bar is volume-missing", () => {
  const withMissing = (n: number) => buildBarSeries("MES", rthBars(390, (k) => (k < n ? 0 : RTH_VOLUME(k))));
  assert.equal(profileRelation.compute(ctxOf(withMissing(78), 389, { anchor: "rth" })).ok, true);
  assertSkip(profileRelation.compute(ctxOf(withMissing(79), 389, { anchor: "rth" })), "volume-missing");
});

test("profileRelation: all-zero volume is volume-missing, and fewer than minBars is warmup", () => {
  assertSkip(profileRelation.compute(ctxOf(buildBarSeries("MES", rthBars(20, () => 0)), 19, { anchor: "rth" })), "volume-missing");
  const short = buildBarSeries("MES", rthBars(14));
  assertSkip(profileRelation.compute(ctxOf(short, 13, { anchor: "rth" })), "warmup");
  assert.equal(profileRelation.compute(ctxOf(buildBarSeries("MES", rthBars(15)), 14, { anchor: "rth" })).ok, true);
});

test("profileRelation (rth) is not known before the 09:30 bar has closed", () => {
  const bars = [0, 1, 2, 3, 4].map((k) => bar(et("09:25") + k * MIN, 5000));
  bars.push(bar(et("09:30"), 5000), bar(et("09:31"), 5000));
  const series = buildBarSeries("MES", bars);
  assertSkip(profileRelation.preflight(ctxOf(series, 4, { anchor: "rth" })), "not-known-yet");
  assertSkip(profileRelation.compute(ctxOf(series, 4, { anchor: "rth" })), "not-known-yet");
  assertSkip(profileRelation.compute(ctxOf(series, 5, { anchor: "rth" })), "warmup");
});

test("profileRelation location: at-poc, above-va, below-va and inside-va", () => {
  const series = buildBarSeries("MES", rthBars());
  const i = lastOf(series);
  const values = valuesOf(profileRelation.compute(ctxOf(series, i, { anchor: "rth" })));
  const close = series.close[i];
  const expected = Math.abs(close - (values.poc as number)) <= 2 * TICK ? "at-poc"
    : close > (values.vah as number) ? "above-va"
      : close < (values.val as number) ? "below-va"
        : "inside-va";
  assert.equal(values.location, expected);
  // A 10-tick tolerance is 2.5 points: the band, not the value area, decides "at-poc".
  const wide = valuesOf(profileRelation.compute(ctxOf(series, i, { anchor: "rth", toleranceTicks: 10 })));
  const withinWide = Math.abs(close - (wide.poc as number)) <= 10 * TICK;
  assert.equal(wide.location === "at-poc", withinWide);
});

// ---------- lookahead ----------

test("both skills pass the lookahead harness", () => {
  const minute = buildBarSeries("MES", continuousBars(1200, closeAt));
  assertNoLookahead(emaRelation, ctxOf(minute, 900));
  const fiveMinute = buildBarSeries("MES", continuousBars(4000, closeAt));
  assertNoLookahead(emaRelation, ctxOf(fiveMinute, 3600, { minutes: 5 }));
  const session = buildBarSeries("MES", rthBars());
  assertNoLookahead(profileRelation, ctxOf(session, 300, { anchor: "rth" }));
  assertNoLookahead(profileRelation, ctxOf(session, 300, { anchor: "globex" }));
});
