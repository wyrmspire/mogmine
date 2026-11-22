import assert from "node:assert/strict";
import { test } from "node:test";
import markup from "../../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };
import { computeSessionIndicators, pricePosition, vwapDistance, vwapSlope } from "../session-indicators.ts";
import type { SessionIndicatorOptions } from "../session-indicators.ts";
import { equityIndexSessionBounds, offsetSessionDate, sessionWeekMonday } from "../session.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;
const hour = 60 * minute;
const rth = Date.parse("2026-11-09T14:30:00Z");
const globex = Date.parse("2026-11-08T23:00:00Z");

function bar(time: number, price: number, volume = 1): Candle {
  return { time, open: price, high: price, low: price, close: price, volume };
}

function barsFrom(time: number, count: number, interval: number): Candle[] {
  return Array.from({ length: count }, (_, i) => bar(time + i * interval, 100));
}

function calculate(candles: readonly Candle[], asOf: number, overrides: Partial<SessionIndicatorOptions> = {}) {
  const result = computeSessionIndicators(candles, { symbol: "MES", timeframe: "1m", asOf, anchor: "rth", ...overrides });
  assert.ok(result);
  return result;
}

function prices(result: ReturnType<typeof calculate>) {
  return Object.fromEntries(result.levels.map(({ key, price }) => [key, price]));
}

test("RTH VWAP weights HLC3 from the anchor through the last completed bar", () => {
  const candles = [
    bar(rth + 4 * minute, 999, 10), // In progress at the cutoff.
    bar(rth + 2 * minute, 104),
    bar(rth - minute, 500, 5),     // Before the selected anchor.
    bar(rth, 400, 0),              // No VWAP until the first positive volume.
    { ...bar(rth + minute, 100, 2), high: 103, low: 99, close: 101 },
    bar(rth + 3 * minute, 999, 0), // Zero volume leaves the curve unchanged.
  ];
  const asOf = rth + 4.5 * minute;
  const result = calculate(candles, asOf);
  // HLC3 = (103 + 99 + 101) / 3 = 101. Then (2 × 101 + 104) / 3 = 102.
  assert.deepEqual(result.vwap, [
    { time: rth + 2 * minute, value: 101 }, { time: rth + 3 * minute, value: 102 }, { time: rth + 4 * minute, value: 102 },
  ]);
  assert.deepEqual(result.coverage.anchored, { from: rth, to: asOf, expectedBars: 4, presentBars: 4, complete: true });
  assert.deepEqual(prices(result), { poc: 101, val: 101, vah: 104 }); // 2 / 3 alone falls short of 70%.
  assert.equal(candles[0].time, rth + 4 * minute, "input order is unchanged");
});

test("profile bins HLC3 to ticks, combines volumes and expands from POC with deterministic ties", () => {
  const candles = [
    bar(rth, 99.75, 2), bar(rth + minute, 100, 2), bar(rth + 2 * minute, 100, 3),
    { ...bar(rth + 3 * minute, 100, 2), high: 100.5 }, bar(rth + 4 * minute, 101),
  ];
  // HLC3 for the wide bar is 100 + 1/6, which rounds to 100.25. Bin volumes
  // are [2, 5, 2, 1]. The POC and lower neighbor reach exactly 7 of 10 contracts.
  const result = calculate(candles, rth + 5 * minute);
  assert.deepEqual(prices(result), { poc: 100, val: 99.75, vah: 100 });
  assert.equal(result.levels.find(({ key }) => key === "val")?.priceTicks, 399);
  const expectedVwap = (2 * 99.75 + 5 * 100 + 2 * (100 + 1 / 6) + 101) / 10;
  assert.ok(Math.abs(result.vwap.at(-1)!.value - expectedVwap) < 1e-10);

  const tied = calculate([bar(rth, 101), bar(rth + minute, 100)], rth + 2 * minute);
  assert.deepEqual(prices(tied), { poc: 100, val: 100, vah: 101 });
  const oneBin = calculate([bar(rth, 100, 7), bar(rth + minute, 101, 3)], rth + 2 * minute);
  assert.deepEqual(prices(oneBin), { poc: 100, val: 100, vah: 100 });
});

test("Globex resets on Sunday, selects last Friday and uses the dated settlement close", () => {
  const fridayOpen = Date.parse("2026-11-05T23:00:00Z");
  const fridayClose = Date.parse("2026-11-06T22:00:00Z");
  const friday = barsFrom(fridayOpen, 23, hour);
  friday[1].high = 110; // Overnight extreme belongs to PDH.
  friday[22].low = 90;
  const candles = [...friday, bar(fridayClose, 500), bar(globex, 102, 3), bar(globex + hour, 106), bar(globex + 2 * hour, 500)];
  const settlement = { sessionDate: "2026-11-06", availableAt: fridayClose, close: 98.25 };
  const result = calculate(candles, globex + 2 * hour, { timeframe: "1h", anchor: "globex", settlement });
  assert.equal(result.sessionDate, "2026-11-09");
  assert.equal(result.previousSessionDate, "2026-11-06");
  assert.deepEqual(prices(result), {
    pdh: 110, pdl: 90, onh: 106, onl: 102, week_high: 106, week_low: 102,
    pdc: 98.25, poc: 102, val: 102, vah: 102,
  });
  assert.deepEqual(result.vwap, [{ time: globex + hour, value: 102 }, { time: globex + 2 * hour, value: 103 }]);
  assert.deepEqual(result.levels.find(({ key }) => key === "pdh"), {
    key: "pdh", label: "PDH", price: 110, priceTicks: 440, formedAt: fridayOpen + hour, availableAt: fridayClose,
  });
});

test("week-to-date combines trading days and excludes maintenance and unfinished candles", () => {
  const monday = barsFrom(globex, 23, hour);
  monday[2].high = 110;
  const tueOpen = Date.parse("2026-11-09T23:00:00Z");
  const candles = [...monday, bar(tueOpen - hour, 1000), bar(tueOpen, 95), bar(tueOpen + hour, 999)];
  const result = calculate(candles, tueOpen + 1.5 * hour, { timeframe: "1h", anchor: "globex" });
  assert.equal(result.coverage.week.expectedBars, 24);
  assert.equal(result.coverage.week.presentBars, 24);
  assert.equal(prices(result).week_high, 110);
  assert.equal(prices(result).week_low, 95);
  assert.equal(prices(result).pdl, 100);

  const missingDay = calculate(candles.slice(23), tueOpen + 1.5 * hour, { timeframe: "1h", anchor: "globex" });
  assert.equal(missingDay.coverage.week.presentBars, 1);
  assert.equal(prices(missingDay).week_high, undefined);
  assert.equal(prices(missingDay).pdh, undefined);
  assert.equal(prices(missingDay).onl, 95);
});

test("overnight stops at the RTH open, and coarse bars cannot straddle that boundary", () => {
  const candles = barsFrom(globex, 62, 15 * minute); // 15h30 from 18:00 ET to 09:30 ET.
  candles[61].high = 109;
  candles.push(bar(rth, 500));
  const fine = calculate(candles, rth + 15 * minute, { timeframe: "15m" });
  assert.equal(prices(fine).onh, 109);
  assert.equal(prices(fine).onl, 100);
  assert.deepEqual(fine.vwap, [{ time: rth + 15 * minute, value: 500 }]);

  const coarse = calculate(barsFrom(globex, 17, hour), rth + 1.5 * hour, { timeframe: "1h" });
  assert.equal(coarse.coverage.overnight.presentBars, 15);
  assert.equal(coarse.coverage.overnight.complete, false);
  assert.equal(coarse.coverage.anchored.complete, false);
  assert.equal(prices(coarse).onh, undefined);
  assert.deepEqual(coarse.vwap, []);
});

test("RTH VWAP stops at 16:00 ET even when the Globex session is still open", () => {
  const rthClose = Date.parse("2026-11-09T21:00:00Z");
  const candles = [...barsFrom(rth, 26, 15 * minute), bar(rthClose, 999)];
  const result = calculate(candles, rthClose + 15 * minute, { timeframe: "15m" });
  assert.equal(result.vwap.length, 26);
  assert.deepEqual(result.vwap.at(-1), { time: rthClose, value: 100 });
  assert.equal(prices(result).poc, 100);
});

test("prior settlement must match the previous session and be available by the cutoff", () => {
  const settlement = { sessionDate: "2026-11-06", availableAt: rth, close: 100.25 };
  assert.equal(prices(calculate([], rth)).pdc, undefined);
  assert.equal(prices(calculate([], rth - 1, { settlement })).pdc, undefined);
  assert.equal(prices(calculate([], rth, { settlement })).pdc, 100.25);
  assert.equal(prices(calculate([], rth, { settlement: { ...settlement, sessionDate: "2026-11-09" } })).pdc, undefined);
  assert.equal(prices(calculate([], rth, { settlement: { ...settlement, close: NaN } })).pdc, undefined);
});

test("missing, duplicate and malformed candles cannot produce complete session values", () => {
  const wrongOhlc = { ...bar(rth + minute, 100), low: 101 };
  for (const candles of [
    [bar(rth + minute, 100)],
    [bar(rth, 99), bar(rth, 101), bar(rth + minute, 100)],
    [bar(rth, 100), wrongOhlc],
  ]) {
    const result = calculate(candles, rth + 2 * minute);
    assert.equal(result.coverage.anchored.presentBars, 1);
    assert.deepEqual(result.vwap, []);
    assert.deepEqual(result.levels, []);
  }
  for (const volume of [0, -1, NaN]) {
    const result = calculate([bar(rth, 100, volume)], rth + minute);
    assert.equal(result.coverage.anchored.complete, true, "price bar is present");
    assert.deepEqual(result.vwap, []);
    assert.deepEqual(result.levels, []);
  }
  assert.equal(computeSessionIndicators([], { symbol: "MES", timeframe: "1m", asOf: NaN, anchor: "rth" }), null);
});

test("session bounds follow New York through spring and fall DST weekends", () => {
  assert.equal(offsetSessionDate("2026-03-01", -1), "2026-02-28");
  assert.equal(sessionWeekMonday("2026-11-12"), "2026-11-09");
  for (const [date, open, regularOpen, regularClose, close] of [
    ["2026-03-09", "2026-03-08T22:00Z", "2026-03-09T13:30Z", "2026-03-09T20:00Z", "2026-03-09T21:00Z"],
    ["2026-11-02", "2026-11-01T23:00Z", "2026-11-02T14:30Z", "2026-11-02T21:00Z", "2026-11-02T22:00Z"],
  ]) {
    assert.deepEqual(equityIndexSessionBounds(date), {
      open: Date.parse(open), rthOpen: Date.parse(regularOpen), rthClose: Date.parse(regularClose), close: Date.parse(close),
    });
    const start = Date.parse(open);
    const result = calculate([bar(start - minute, 999), bar(start, 100)], start + minute, { anchor: "globex" });
    assert.equal(result.sessionDate, date);
    assert.equal(result.coverage.week.expectedBars, 1);
    assert.equal(prices(result).week_high, 100);
  }
});

test("VWAP distance gives signed points and percentage relative to VWAP", () => {
  assert.deepEqual(vwapDistance(105, 100), { points: 5, percent: 5 });
  assert.deepEqual(vwapDistance(190, 200), { points: -10, percent: -5 });
  assert.deepEqual(vwapDistance(200, 200), { points: 0, percent: 0 });
  assert.deepEqual(vwapDistance(1, 0), { points: 1, percent: null });
  assert.equal(vwapDistance(100, null), null);
  assert.equal(vwapDistance(Infinity, 100), null);
});

test("VWAP slope uses elapsed minutes over the requested lookback", () => {
  const points = [{ time: minute, value: 100 }, { time: 2 * minute, value: 105 }, { time: 5 * minute, value: 102 }];
  assert.deepEqual(vwapSlope(points, 2), { pointsPerMinute: 0.5, direction: "up" });
  assert.deepEqual(vwapSlope(points, 1), { pointsPerMinute: -1, direction: "down" });
  assert.deepEqual(vwapSlope([points[0], { time: 2 * minute, value: 100 }], 1), { pointsPerMinute: 0, direction: "flat" });
  assert.equal(vwapSlope(points, 3), null);
  assert.equal(vwapSlope(points, 0), null);
  assert.equal(vwapSlope([points[0], { ...points[1], time: minute }], 1), null);
});

test("price position handles point levels, fixture-shaped ranges and strict nearest neighbors", () => {
  assert.deepEqual(pricePosition(100, [
    { key: "pdh", price: 110 }, { key: "onl", price: 99.5 }, { key: "poc", price: 100 },
    { key: "above", price_low: 100.25, price_high: 102 }, { key: "tie", price: 100.25 },
    { key: "below", price_low: 96, price_high: 98 }, { key: "inside", price_low: 99, price_high: 100 },
    { key: "hidden", price: 100.125, hidden: true }, { key: "invalid", price_low: 101, price_high: 99 },
  ]), {
    nearestAbove: { key: "above", points: 0.25 },
    nearestBelow: { key: "onl", points: -0.5 },
    distances: [
      { key: "pdh", points: 10 }, { key: "onl", points: -0.5 }, { key: "poc", points: 0 },
      { key: "above", points: 0.25 }, { key: "tie", points: 0.25 }, { key: "below", points: -2 }, { key: "inside", points: 0 },
    ],
  });
  assert.deepEqual(pricePosition(100, []), { nearestAbove: null, nearestBelow: null, distances: [] });
  assert.equal(pricePosition(NaN, []), null);
});

test("the existing MES draft can supply point and range distances at its reference price", () => {
  const position = pricePosition(markup.reference_price.price, markup.levels);
  assert.ok(position);
  assert.equal(position.distances.length, 22); // 25 levels, three hidden.
  assert.deepEqual(position.nearestAbove, { key: "tue_high", points: 4.75 }); // 7598.75 − 7594.
  assert.deepEqual(position.nearestBelow, { key: "adr_inner_low", points: -1 }); // 7593 − 7594.
  assert.deepEqual(position.distances.find(({ key }) => key === "nov3_4h"), { key: "nov3_4h", points: 29.75 });
});
