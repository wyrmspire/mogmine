import test from "node:test";
import assert from "node:assert/strict";
import { getCandleFreshness } from "../freshness.ts";
import type { Candle } from "../trades.ts";

function bar(time: number): Candle {
  return { time, open: 5000, high: 5005, low: 4995, close: 5002, volume: 100 };
}

test("offline returns Offline status regardless of candles", () => {
  const result = getCandleFreshness({
    candles: [bar(Date.now() - 60_000)],
    online: false,
  });
  assert.equal(result.status, "offline");
  assert.equal(result.label, "Offline");
});

test("demo fixture returns Cached", () => {
  const result = getCandleFreshness({
    candles: [bar(Date.now() - 60_000)],
    source: "Demo fixture",
    online: true,
  });
  assert.equal(result.status, "cached");
  assert.equal(result.label, "Cached");
});

test("fresh Yahoo data reports Delayed · Xm", () => {
  const now = 1_700_000_000_000;
  // bar is 4 minutes old
  const barTime = now - 4 * 60_000;
  const result = getCandleFreshness({
    candles: [bar(barTime)],
    source: "Yahoo Finance",
    online: true,
    now,
  });
  assert.equal(result.status, "delayed");
  assert.equal(result.label, "Delayed · 4m");
  assert.equal(result.delayMinutes, 4);
});

test("fresh Yahoo data with 1 minute delay rounds to 1m minimum", () => {
  const now = 1_700_000_000_000;
  // bar is 20 seconds old
  const barTime = now - 20_000;
  const result = getCandleFreshness({
    candles: [bar(barTime)],
    source: "Yahoo Finance",
    online: true,
    now,
  });
  assert.equal(result.status, "delayed");
  assert.equal(result.label, "Delayed · 1m");
  assert.equal(result.delayMinutes, 1);
});

test("older historical data (> 60m) reports Cached", () => {
  const now = 1_700_000_000_000;
  // bar is 2 days old
  const barTime = now - 2 * 86_400_000;
  const result = getCandleFreshness({
    candles: [bar(barTime)],
    source: "Yahoo Finance",
    online: true,
    now,
  });
  assert.equal(result.status, "cached");
  assert.equal(result.label, "Cached");
});

test("loading state when fetching and no candles", () => {
  const result = getCandleFreshness({
    candles: [],
    online: true,
    fetching: true,
  });
  assert.equal(result.status, "loading");
  assert.equal(result.label, "Loading…");
});
