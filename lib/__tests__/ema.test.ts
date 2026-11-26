// IN-3: the 200 EMA (docs/design-2026-11-24/03 §6, D-G). Synthetic bars only: the candle source is a fake, so there is no
// live Yahoo traffic and no journal data is read.
import test from "node:test";
import assert from "node:assert/strict";
import { EMA_CALC_VERSION, computeEma, computeEma200, ema200Status, emaOnBars, emaUnavailable } from "../ema.ts";
import { buildAgentLevels } from "../agent/levels.ts";
import type { LevelsCandleSource } from "../agent/levels.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { equityIndexSessionBounds, previousRegularSessionDate, sessionDate } from "../session.ts";
import { aggregateCandles } from "../trades.ts";
import type { Candle } from "../trades.ts";

const MIN = 60_000;
const SESSION = "2026-11-25";
const PRIOR = previousRegularSessionDate(SESSION);
const today = equityIndexSessionBounds(SESSION);
const prior = equityIndexSessionBounds(PRIOR);
// 10:15 ET is 15:15 UTC (EST, after the 1 November change).
const TEN_FIFTEEN = Date.parse("2026-11-25T15:15:00.000Z");
const TEN_THIRTY = Date.parse("2026-11-25T15:30:00.000Z");
const TEN_THIRTY_ONE = Date.parse("2026-11-25T15:31:00.000Z");

/** Regular-session slots (Globex calendar) from `start`: one 1m bar per slot, `count` bars. Price from `priceAt(index)`. */
function slots(start: number, count: number, priceAt: (index: number) => number = () => 7000): Candle[] {
  const bars: Candle[] = [];
  for (let time = start; bars.length < count; time += MIN) {
    const sessionBounds = equityIndexSessionBounds(sessionDate(time));
    if (time < sessionBounds.open || time >= sessionBounds.close) continue;
    const price = priceAt(bars.length);
    bars.push({ time, open: price, high: price, low: price, close: price, volume: 100 });
  }
  return bars;
}

const START = Date.parse("2026-11-16T15:00:00.000Z"); // 10:00 ET, a regular session.

/** Plain EMA over closes, written out longhand so the test does not share code with lib/ema.ts. */
function manualLastEma(closes: readonly number[]): number {
  const alpha = 2 / 201;
  let ema = closes.slice(0, 200).reduce((sum, close) => sum + close, 0) / 200;
  for (let i = 200; i < closes.length; i += 1) ema = closes[i] * alpha + ema * (1 - alpha);
  return ema;
}

test("constant closes: 51 points from the 700th bar, all equal to the price, not approximate", () => {
  const bars = slots(START, 750, () => 7000);
  const result = computeEma200(bars, "1m");
  assert.equal(result.calcVersion, EMA_CALC_VERSION);
  assert.equal(result.points.length, 51);
  assert.deepEqual(result.points.map((point) => point.time), bars.slice(699).map((bar) => bar.time));
  for (const point of result.points) assert.ok(Math.abs(point.value - 7000) < 1e-9, `value ${point.value}`);
  assert.equal(result.approximate, false);
  assert.equal(result.unavailableReason, null);
});

test("step function: the 7000 seed has decayed to (199/201)^500 ≈ 0.6738% at bar 700", () => {
  const bars = slots(START, 700, (index) => (index < 200 ? 7000 : 7100));
  const result = computeEma200(bars, "1m");
  assert.equal(result.points.length, 1);
  const weight = Math.pow(199 / 201, 500);
  assert.ok(Math.abs(weight - 0.006738) < 1e-6, `weight ${weight}`);
  assert.ok(Math.abs(result.points[0].value - (7100 - 100 * weight)) < 1e-9);
  assert.ok(Math.abs(result.points[0].value - 7099.326) < 0.001);
  assert.equal(result.points[0].time, bars[699].time);
});

test("699 bars: no points, with the reason and the count", () => {
  const result = computeEma200(slots(START, 699), "1m");
  assert.deepEqual(result.points, []);
  assert.equal(result.unavailableReason, "Needs 700 1m bars for warm-up (699 available)");
  assert.equal(result.approximate, false);
});

test("warm-up gaps: above 3% of expected in-session bars is approximate, at or below 3% is not", () => {
  // 760 in-session slots with `drop` of them removed inside the warm-up. The first 700 bars then span 700 + drop slots.
  const withGaps = (drop: number) => {
    const all = slots(START, 760);
    return all.filter((_, index) => index < 100 || index >= 100 + drop);
  };
  const wide = computeEma200(withGaps(30), "1m"); // 30 / 730 = 4.1%
  assert.equal(wide.approximate, true);
  assert.ok(Math.abs(wide.missingRatio - 30 / 730) < 1e-12);
  assert.ok(wide.points.length > 0);

  const narrow = computeEma200(withGaps(20), "1m"); // 20 / 720 = 2.8%
  assert.equal(narrow.approximate, false);
  assert.ok(Math.abs(narrow.missingRatio - 20 / 720) < 1e-12);
});

test("displayed timeframe basis: a 5m EMA is the EMA of 5m closes, not of 1m closes", () => {
  // Trending closes, one per in-session minute, enough for 700 five-minute bars.
  const bars = slots(START, 4_000, (index) => 7000 + index * 0.1);
  const fiveMinute = aggregateCandles(bars, "5m");
  const fromFive = computeEma200(bars, "5m");
  const fromOne = computeEma200(bars, "1m");
  assert.equal(fromFive.timeframe, "5m");
  assert.equal(fromFive.points.at(-1)?.time, fiveMinute.at(-1)?.time);
  assert.ok(Math.abs((fromFive.points.at(-1)?.value ?? NaN) - manualLastEma(fiveMinute.map((bar) => bar.close))) < 1e-9);
  assert.ok(Math.abs((fromFive.points.at(-1)?.value ?? 0) - (fromOne.points.at(-1)?.value ?? 0)) > 0.01);
  // Already-aggregated 5m bars give the same answer as 1m bars that aggregate into them.
  assert.deepEqual(computeEma200(fiveMinute, "5m").points, fromFive.points);
});

test("1m bars too coarse for the displayed timeframe are reported, not drawn", () => {
  const fiveMinute = aggregateCandles(slots(START, 4_000), "5m");
  const result = computeEma200(fiveMinute, "1m");
  assert.deepEqual(result.points, []);
  assert.match(result.unavailableReason ?? "", /5-minute bars are loaded/);
});

test("the View note: the reason when missing, ≈ when approximate, nothing when complete", () => {
  assert.equal(ema200Status(null), "");
  assert.equal(ema200Status(emaUnavailable("1m", "1m bars older than 30 days are unavailable from Yahoo")), " · 1m bars older than 30 days are unavailable from Yahoo");
  assert.equal(ema200Status(computeEma200(slots(START, 750), "1m")), "");
  const approximate = { ...computeEma200(slots(START, 750), "1m"), approximate: true };
  assert.equal(ema200Status(approximate), " · ≈ gaps in warm-up");
});

test("emaOnBars keeps only the points on displayed bars", () => {
  const bars = slots(START, 750, () => 7000);
  const result = computeEma200(bars, "1m");
  const onBars = emaOnBars(result.points, bars.slice(600));
  assert.equal(onBars.length, 51);
  assert.equal(emaOnBars(result.points, bars.slice(0, 100)).length, 0);
});

test("IK-2 EMA instances own their length and source", () => {
  const bars = slots(START, 540).map((bar) => ({ ...bar, open: 7100, high: 7200, low: 6900, close: 7000 }));
  const close20 = computeEma(bars, "1m", 20, "close");
  const open20 = computeEma(bars, "1m", 20, "open");
  assert.equal(close20.length, 20);
  assert.equal(close20.source, "close");
  assert.equal(close20.points.length, 21);
  assert.ok(close20.points.every(({ value }) => value === 7000));
  assert.ok(open20.points.every(({ value }) => value === 7100));
});

// ---- GET /api/v1/levels: ema200 cut strictly at as_of ---------------------------------------------------------------------

/** Prior session and today, flat at 7400, with a 9000-close spike at 10:30 ET that any read before 10:31 must not see. */
function levelsBars(): Candle[] {
  const flatBar = (time: number, close: number): Candle => ({ time, open: 7400, high: close, low: Math.min(7400, close), close, volume: 100 });
  const bars: Candle[] = [];
  for (let time = prior.open; time < prior.close; time += MIN) bars.push(flatBar(time, 7400));
  for (let time = today.open; time < today.close; time += MIN) {
    bars.push(flatBar(time, time === TEN_THIRTY ? 9000 : 7400));
  }
  return bars;
}

async function levelsAt(asOfIso: string, bars: Candle[]) {
  const source: LevelsCandleSource = async (_symbol, from, to) => ({
    bars: bars.filter((bar) => bar.time >= from && bar.time < to),
    provider: "yahoo_finance",
  });
  const commands = { listFiltered: async () => ({ ok: true, value: [] }) } as unknown as JournalCommands;
  const result = await buildAgentLevels({ symbol: "MES", sessionDate: SESSION, asOfIso }, commands, source);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("levels failed");
  return result.value;
}

test("/api/v1/levels: ema200 at as_of excludes the bar that closes after the cutoff", async () => {
  const bars = levelsBars();
  const before = await levelsAt(new Date(TEN_FIFTEEN).toISOString(), bars);
  assert.equal(before.ema200.calc_version, EMA_CALC_VERSION);
  assert.equal(before.ema200.timeframe, "1m");
  assert.equal(before.ema200.unavailable_reason, null);
  // Every bar before the cutoff is flat at 7400, so the EMA is exactly 7400 whatever the spike does later.
  assert.ok(before.ema200.value !== null && Math.abs(before.ema200.value - 7400) < 1e-9);

  // The spike bar (10:30 ET, closes 10:31) is inside the window only once as_of reaches 10:31.
  const after = await levelsAt(new Date(TEN_THIRTY_ONE).toISOString(), bars);
  assert.ok(after.ema200.value !== null && after.ema200.value > 7400.01, `value ${after.ema200.value}`);

  // And the value matches the EMA over exactly the bars that closed by as_of.
  const closed = bars.filter((bar) => bar.time + MIN <= TEN_THIRTY_ONE);
  const expected = computeEma200(closed, "1m").points.at(-1)?.value;
  assert.equal(after.ema200.value, expected);
});
