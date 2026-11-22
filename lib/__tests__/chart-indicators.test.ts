import test from "node:test";
import assert from "node:assert/strict";
import { tradeSessionVwap, vwapOnBars } from "../chart-indicators.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;
const rth = Date.parse("2026-11-12T14:30:00Z"); // 09:30 ET
const rthClose = Date.parse("2026-11-12T21:00:00Z");
const bar = (time: number, high: number, low: number, close: number, volume: number): Candle =>
  ({ time, open: close, high, low, close, volume });
// Hand-checked: HLC3 100 × 10, 103 × 30, 99 × 20. VWAP 100, then 4090/40 = 102.25, then 6070/60 = 101.1666…
const session = (): Candle[] => [
  bar(rth, 101, 99, 100, 10),
  bar(rth + minute, 104, 102, 103, 30),
  bar(rth + 2 * minute, 100, 98, 99, 20),
  ...Array.from({ length: 387 }, (_, i) => bar(rth + (3 + i) * minute, 99, 99, 99, 0)),
];
const trade = { symbol: "MES", entry_time: "2026-11-12T14:31:30Z" };

test("IND-1: RTH VWAP matches a hand-checked session", () => {
  const points = tradeSessionVwap(trade, session(), "1m", "rth")!;
  assert.deepEqual(points.slice(0, 2), [{ time: rth + minute, value: 100 }, { time: rth + 2 * minute, value: 102.25 }]);
  assert.ok(Math.abs(points[2].value - 6070 / 60) < 1e-9);
  assert.equal(points.length, 390);
  assert.equal(points.at(-1)!.time, rthClose);
});

test("IND-1: bars loaded past the session close never move the cutoff into the next session", () => {
  const nextSession = Array.from({ length: 60 }, (_, i) => bar(Date.parse("2026-11-12T23:00:00Z") + i * minute, 200, 200, 200, 99));
  const points = tradeSessionVwap(trade, [...session(), ...nextSession], "1m", "rth")!;
  assert.equal(points.length, 390);
  assert.ok(points.every((point) => point.value < 104));
});

test("IND-1: a gap in the anchored window withholds VWAP instead of drawing a wrong line", () => {
  const gapped = session().filter((candle) => candle.time !== rth + 200 * minute);
  assert.equal(tradeSessionVwap(trade, gapped, "1m", "rth"), null);
  // Globex anchor needs the 18:00 ET open onward, which this set does not hold.
  assert.equal(tradeSessionVwap(trade, session(), "1m", "globex"), null);
  assert.equal(tradeSessionVwap({ ...trade, symbol: "ES" }, session(), "1m", "rth"), null);
});

test("IND-1: a 5m chart takes the value known at each bar's close, never earlier", () => {
  const points = tradeSessionVwap(trade, session(), "1m", "rth")!;
  const line = vwapOnBars(points, [{ time: rth - 5 * minute }, { time: rth }, { time: rth + 5 * minute }], "5m");
  // The pre-open bar has no value. The 09:30 bar shows the VWAP at 09:35, after five 1m bars.
  assert.equal(line.length, 2);
  assert.deepEqual(line[0], { time: rth, value: points[4].value });
  assert.equal(line[1].time, rth + 5 * minute);
  // 1m bars map one to one.
  assert.deepEqual(vwapOnBars(points, [{ time: rth }, { time: rth + minute }], "1m"), [
    { time: rth, value: 100 }, { time: rth + minute, value: 102.25 },
  ]);
});
