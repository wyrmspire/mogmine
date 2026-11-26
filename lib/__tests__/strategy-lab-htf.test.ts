import test from "node:test";
import assert from "node:assert/strict";
import {
  closeAgainstPriorLow, closedHtfCandles, engulfingAgainst, insideBarBreakAgainst,
  lastClosedWick, lastNClosedHigh, lastNClosedLow,
} from "../strategy-lab/htf.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import type { ClosedHtfCandle } from "../strategy-lab/htf.ts";
import type { SourceBar } from "../strategy-lab/types.ts";

const MINUTE = 60_000;
const et = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00-05:00`);

function bars(start: number, rows: readonly (readonly [number, number, number, number])[]): SourceBar[] {
  return rows.map(([open, high, low, close], index) => ({ time: start + index * MINUTE, open, high, low, close, volume: 100 }));
}

function candle(open: number, high: number, low: number, close: number, complete = true): ClosedHtfCandle {
  return {
    minutes: 5, startTime: 0, endTime: 5 * MINUTE, knownAt: 5 * MINUTE,
    open, high, low, close, volume: 500, expected: 5,
    present: complete ? 5 : 4, missingMinutes: complete ? 0 : 1, complete,
  };
}

test("a 15m engulfing is known at close and usable only by the following 1m bar", () => {
  const first = Array.from({ length: 15 }, (_, i) => [100 + i / 15, 102, 99, 100 + (i + 1) / 15] as const);
  const second = Array.from({ length: 15 }, (_, i) => [102 - i * 0.2, 103, 98, 102 - (i + 1) * 0.2] as const);
  const source = bars(et("2026-11-24", "09:30"), [...first, ...second, [99, 100, 98, 99]]);
  const series = buildBarSeries("MES", source);

  const atClose = closedHtfCandles(series, 29, 15);
  assert.equal(atClose.length, 1);
  assert.equal(engulfingAgainst(atClose, "long"), false);

  const nextBar = closedHtfCandles(series, 30, 15);
  assert.equal(nextBar.length, 2);
  assert.equal(nextBar[1].knownAt, et("2026-11-24", "10:00"));
  assert.equal(engulfingAgainst(nextBar, "long"), true);
});

test("pattern and wick helpers are symmetric for long and short", () => {
  const bullish = candle(100, 103, 99, 102);
  const bearishEngulf = candle(103, 104, 98, 99);
  assert.equal(engulfingAgainst([bullish, bearishEngulf], "long"), true);
  assert.equal(closeAgainstPriorLow([bullish, bearishEngulf], "long"), false);
  assert.deepEqual(lastClosedWick([bearishEngulf], "long"), { tip: 98, midpoint: 98.5 });

  const bearish = candle(102, 103, 99, 100);
  const bullishEngulf = candle(99, 104, 98, 103);
  assert.equal(engulfingAgainst([bearish, bullishEngulf], "short"), true);
  assert.equal(closeAgainstPriorLow([bearish, bullishEngulf], "short"), false);
  assert.deepEqual(lastClosedWick([bullishEngulf], "short"), { tip: 104, midpoint: 103.5 });

  const mother = candle(100, 110, 90, 101);
  const inside = candle(101, 108, 92, 102);
  assert.equal(insideBarBreakAgainst([mother, inside, candle(102, 103, 90, 91)], "long"), true);
  assert.equal(insideBarBreakAgainst([mother, inside, candle(102, 110, 101, 109)], "short"), true);
});

test("a gap flags the 15m candle and dependent helpers decline it", () => {
  const source = bars(et("2026-11-24", "09:30"), Array.from({ length: 16 }, () => [100, 102, 98, 101] as const))
    .filter((_, index) => index !== 14); // Even a missing final minute must leave a flagged, closed bucket.
  const series = buildBarSeries("MES", source);
  const candles = closedHtfCandles(series, series.time.length - 1, 15);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].complete, false);
  assert.equal(candles[0].missingMinutes, 1);
  assert.equal(lastNClosedLow(candles, 1), null);
  assert.equal(lastNClosedHigh(candles, 1), null);
  assert.equal(lastClosedWick(candles, "long"), null);
});

test("closed candles do not bridge the 17:00 ET session boundary", () => {
  const before = bars(et("2026-11-24", "16:45"), Array.from({ length: 15 }, () => [100, 101, 99, 100] as const));
  const after = bars(et("2026-11-24", "18:00"), Array.from({ length: 16 }, () => [200, 201, 199, 200] as const));
  const series = buildBarSeries("MES", [...before, ...after]);
  const candles = closedHtfCandles(series, series.time.length - 1, 15);
  assert.equal(candles.length, 2);
  assert.deepEqual(candles.map((item) => [item.open, item.present, item.complete]), [[100, 15, true], [200, 15, true]]);
  assert.equal(candles[0].endTime, et("2026-11-24", "17:00"));
  assert.equal(candles[1].startTime, et("2026-11-24", "18:00"));
});
