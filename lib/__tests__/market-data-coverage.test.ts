// Issue #90 (AC-07): a market-data payload is acceptable only when it covers the trade window,
// not when it merely has four bars.
import assert from "node:assert/strict";
import { test } from "node:test";
import { coversTradeWindow } from "../market-data/coverage.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;
const entry = Date.parse("2026-11-10T15:43:00.000Z");
const exit = Date.parse("2026-11-10T17:43:00.000Z"); // a two-hour trade

function bars(fromMs: number, toMs: number, stepMs: number): Candle[] {
  const out: Candle[] = [];
  for (let time = fromMs; time < toMs; time += stepMs) {
    out.push({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  }
  return out;
}

test("issue #90: a four-bar stub that misses the trade window is rejected", () => {
  // The old bypass accepted any set with four or more bars. These four sit an hour before the entry.
  const stub = bars(entry - 60 * minute, entry - 56 * minute, minute);
  assert.equal(stub.length, 4);
  assert.equal(coversTradeWindow(stub, entry, exit, "1m"), false);
});

test("issue #90: four bars inside a two-hour trade are rejected as partial", () => {
  const fourInside = bars(entry, entry + 4 * minute, minute);
  assert.equal(coversTradeWindow(fourInside, entry, exit, "1m"), false);
});

test("issue #90: a set with every expected bar, including the entry and exit bars, is accepted", () => {
  // Pad 15 h each side, the same window the route requests for 1m.
  const full = bars(entry - 15 * 60 * minute, exit + 15 * 60 * minute, minute);
  assert.equal(coversTradeWindow(full, entry, exit, "1m"), true);
});

test("issue #90: a single missing bar inside the hold fails coverage", () => {
  const full = bars(entry - 5 * minute, exit + 5 * minute, minute);
  const gap = full.filter((bar) => bar.time !== entry + 30 * minute);
  assert.equal(coversTradeWindow(gap, entry, exit, "1m"), false);
});

test("issue #90: a missing entry-bar or exit-bar fails coverage even when the inside bars are present", () => {
  const full = bars(entry - 5 * minute, exit + 5 * minute, minute);
  const noEntryBar = full.filter((bar) => bar.time !== Math.floor(entry / minute) * minute);
  const noExitBar = full.filter((bar) => bar.time !== Math.floor(exit / minute) * minute);
  assert.equal(coversTradeWindow(noEntryBar, entry, exit, "1m"), false);
  assert.equal(coversTradeWindow(noExitBar, entry, exit, "1m"), false);
});

test("issue #90: a trade shorter than one bar needs the single bar that holds it", () => {
  const hour = 60 * minute;
  const start = Math.floor(entry / hour) * hour;
  const shortEntry = start + 10 * minute;
  const shortExit = start + 20 * minute;
  assert.equal(coversTradeWindow([], shortEntry, shortExit, "1h"), false);
  assert.equal(coversTradeWindow(bars(start, start + hour, hour), shortEntry, shortExit, "1h"), true);
});

test("issue #90: coverage is judged at the timeframe of the payload", () => {
  // Hourly bars that cover a three-hour trade are complete at 1h, but four 1m bars are not complete at 1m.
  const hour = 60 * minute;
  const start = Math.floor(entry / hour) * hour;
  const end = start + 4 * hour;
  const hourly = bars(start, end, hour);
  assert.equal(coversTradeWindow(hourly, start + 10 * minute, start + 3 * hour + 10 * minute, "1h"), true);
  assert.equal(coversTradeWindow(hourly.slice(0, 4), start + 10 * minute, start + 3 * hour + 10 * minute, "1m"), false);
});

test("issue #90: invalid or empty trade times never count as covered", () => {
  const full = bars(entry - 5 * minute, exit + 5 * minute, minute);
  assert.equal(coversTradeWindow(full, Number.NaN, exit, "1m"), false);
  assert.equal(coversTradeWindow(full, exit, entry, "1m"), false);
  assert.equal(coversTradeWindow([], entry, exit, "1m"), false);
});
