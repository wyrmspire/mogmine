// Tests for higher-timeframe aggregation completeness (docs/16 §4.3, MOGMINE-BLUEPRINT §3.7 "Volume 0 means missing").
// Synthetic bars only: no market data is fetched.
import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCandles, aggregateCandlesWithMeta } from "../candle-aggregation.ts";
import type { Candle } from "../trades.ts";

const MINUTE = 60_000;
// 2026-01-14 is a Wednesday in standard time (ET = UTC-5), so 14:30Z is 09:30 ET.
const START = Date.parse("2026-01-14T14:30:00.000Z");

function bar(time: number, open: number, high: number, low: number, close: number, volume: number): Candle {
  return { time, open, high, low, close, volume };
}

test("a complete 5m bucket sums volume and takes OHLC from its five 1m bars", () => {
  const volumes = [120, 80, 100, 90, 110];
  const bars = volumes.map((volume, i) => bar(START + i * MINUTE, 100 + i, 105 + i * 2, 95 - i, 101 + i, volume));
  const [meta] = aggregateCandlesWithMeta(bars, "5m");
  assert.equal(meta.candle.time, START);
  assert.equal(meta.candle.open, 100);
  assert.equal(meta.candle.high, 113);
  assert.equal(meta.candle.low, 91);
  assert.equal(meta.candle.close, 105);
  assert.equal(meta.candle.volume, 500);
  assert.equal(meta.presentBars, 5);
  assert.equal(meta.expectedBars, 5);
  assert.equal(meta.complete, true);
  assert.equal(meta.volumeComplete, true);
});

test("a zero-volume first bar (Yahoo quirk) makes the 5m volume missing, never a partial sum", () => {
  const bars = [0, 50, 60, 70, 80].map((volume, i) => bar(START + i * MINUTE, 10, 11, 9, 10, volume));
  const [meta] = aggregateCandlesWithMeta(bars, "5m");
  assert.equal(meta.complete, true);
  assert.equal(meta.volumeComplete, false);
  assert.equal(meta.candle.volume, 0);
  assert.equal(aggregateCandles(bars, "5m")[0].volume, 0);
});

test("an incomplete 5m bucket with 3 of 5 bars has no volume even when every present bar has volume", () => {
  // Contiguous 1m bars, so the inferred source spacing is 1 minute and five bars are expected.
  const bars = [0, 1, 2].map((i) => bar(START + i * MINUTE, 10, 11, 9, 10, 100));
  const [meta] = aggregateCandlesWithMeta(bars, "5m");
  assert.equal(meta.presentBars, 3);
  assert.equal(meta.expectedBars, 5);
  assert.equal(meta.complete, false);
  assert.equal(meta.volumeComplete, false);
  assert.equal(meta.candle.volume, 0);
});

test("MES session halt: a 1h bucket inside the 17:00 ET closure expects one bar, not sixty", () => {
  // 22:00Z is 17:00 ET: the regular halt. 21:00Z is 16:00 ET, a regular hour.
  const halted = bar(Date.parse("2026-01-14T22:00:00.000Z"), 20, 21, 19, 20, 40);
  const haltedMeta = aggregateCandlesWithMeta([halted], "1h", { symbol: "MES", sourceMinutes: 1 })[0];
  assert.equal(haltedMeta.expectedBars, 1);
  assert.equal(haltedMeta.complete, true);
  assert.equal(haltedMeta.volumeComplete, true);
  assert.equal(haltedMeta.candle.volume, 40);

  const unscoped = aggregateCandlesWithMeta([halted], "1h", { sourceMinutes: 1 })[0];
  assert.equal(unscoped.expectedBars, 60);
  assert.equal(unscoped.complete, false);

  const regularHour = Date.parse("2026-01-14T21:00:00.000Z");
  const minutes = Array.from({ length: 30 }, (_, i) => bar(regularHour + i * MINUTE, 20, 21, 19, 20, 10));
  const regularMeta = aggregateCandlesWithMeta(minutes, "1h", { symbol: "MES" })[0];
  assert.equal(regularMeta.expectedBars, 60);
  assert.equal(regularMeta.complete, false);
  assert.equal(regularMeta.candle.volume, 0);
});

test("already-aggregated 5m bars pass through unchanged and stay complete", () => {
  const fiveMinute = [0, 1, 2].map((i) => bar(START + i * 5 * MINUTE, 100 + i, 110 + i, 90 + i, 105 + i, 300 + i));
  const result = aggregateCandles(fiveMinute, "5m");
  assert.deepEqual(result, fiveMinute);
  const metas = aggregateCandlesWithMeta(fiveMinute, "5m");
  assert.ok(metas.every((meta) => meta.complete && meta.volumeComplete && meta.expectedBars === 1));
});

test("1m with no options returns the input untouched; with options it reports single-bar completeness", () => {
  const bars = [bar(START, 1, 2, 0.5, 1.5, 7)];
  assert.equal(aggregateCandles(bars, "1m"), bars);
  const [meta] = aggregateCandlesWithMeta(bars, "1m");
  assert.deepEqual(
    { presentBars: meta.presentBars, expectedBars: meta.expectedBars, complete: meta.complete, volumeComplete: meta.volumeComplete },
    { presentBars: 1, expectedBars: 1, complete: true, volumeComplete: true },
  );
});
