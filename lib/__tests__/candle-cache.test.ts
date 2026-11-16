// Issue #86 / AC-06: a matching cache is reusable, but it is not final until the hindsight window closes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCachedCandles } from "../candles.ts";
import type { CandleLoadDependencies, StoredCandles } from "../candles.ts";
import { sessionCloseUtc } from "../session.ts";
import { candleCacheKey, candleSignature } from "../trades.ts";
import type { Candle, TradeRecord } from "../trades.ts";

const minute = 60_000;
const exit = Date.parse("2026-11-10T20:00:00.000Z"); // 15:00 America/New_York
const close = Date.parse("2026-11-10T22:00:00.000Z"); // 17:00 America/New_York

const trade = {
  id: "cache-coverage",
  symbol: "MES",
  yahoo_ticker: "MES=F",
  entry_time: "2026-11-10T19:50:00.000Z",
  exit_time: "2026-11-10T20:00:00.000Z",
} as TradeRecord;

function bars(lastTime: number): Candle[] {
  // Include the entry bar through lastTime so the set covers the trade window (#90)
  // while lastTime still decides whether the hindsight window is covered (#86).
  const start = Math.floor(Date.parse(trade.entry_time) / minute) * minute;
  const out: Candle[] = [];
  for (let time = start; time <= lastTime; time += minute) {
    out.push({ time, open: 6000, high: 6001, low: 5999, close: 6000, volume: 1 });
  }
  return out;
}

function stored(candles: Candle[], signature = candleSignature(trade)): StoredCandles {
  return { signature, candles, source: "Yahoo Finance", baseTimeframe: "1m", fetchedAt: exit };
}

function fakeDependencies(initial: StoredCandles, now: number, fetched: Candle[]) {
  const cache = new Map([[candleCacheKey(trade), initial]]);
  let requests = 0;
  let writes = 0;
  const dependencies: CandleLoadDependencies = {
    read: async (key) => cache.get(key),
    write: async (key, value) => { writes += 1; cache.set(key, value); },
    request: async () => { requests += 1; return { candles: fetched, baseTimeframe: "1m" }; },
    now: () => now,
  };
  return { cache, dependencies, counts: () => ({ requests, writes }) };
}

test("a partial matching cache is not refetched while its hindsight window is open", async () => {
  const partial = stored(bars(exit + 3 * minute));
  const fake = fakeDependencies(partial, close - minute, bars(close - minute));

  const result = await loadCachedCandles(trade, partial.signature, fake.dependencies);

  assert.equal(result, partial);
  assert.deepEqual(fake.counts(), { requests: 0, writes: 0 });
});

test("a partial matching cache is refetched and replaced after its hindsight window closes", async () => {
  const partial = stored(bars(exit + 3 * minute));
  const complete = bars(close - minute);
  const fake = fakeDependencies(partial, close + minute, complete);

  const result = await loadCachedCandles(trade, partial.signature, fake.dependencies);

  assert.deepEqual(result?.candles, complete);
  assert.deepEqual(fake.cache.get(candleCacheKey(trade))?.candles, complete);
  assert.deepEqual(fake.counts(), { requests: 1, writes: 1 });
});

test("a matching cache that covers the hindsight window is not refetched after close", async () => {
  const complete = stored(bars(close - minute));
  const fake = fakeDependencies(complete, close + minute, bars(close + minute));

  const result = await loadCachedCandles(trade, complete.signature, fake.dependencies);

  assert.equal(result, complete);
  assert.deepEqual(fake.counts(), { requests: 0, writes: 0 });
});

test("the final coarse bar covers the close without another refetch", async () => {
  const complete = { ...stored(bars(close - 5 * minute)), baseTimeframe: "5m" as const };
  const fake = fakeDependencies(complete, close + minute, bars(close - minute));

  const result = await loadCachedCandles(trade, complete.signature, fake.dependencies);

  assert.equal(result, complete);
  assert.deepEqual(fake.counts(), { requests: 0, writes: 0 });
});

test("the signature still keys the cache even while the hindsight window is open", async () => {
  const stale = stored(bars(exit + 3 * minute), "MES|MES=F|older-entry|older-exit");
  const fetched = bars(close - minute);
  const fake = fakeDependencies(stale, close - minute, fetched);

  const result = await loadCachedCandles(trade, candleSignature(trade), fake.dependencies);

  assert.deepEqual(result?.candles, fetched);
  assert.equal(result?.signature, candleSignature(trade));
  assert.deepEqual(fake.counts(), { requests: 1, writes: 1 });
});

test("a fresh payload missing one inside bar is accepted while entry and exit bars are present", async () => {
  // AC-07 follow-up: one missing 1m bar must not drop the trade to a coarser timeframe or no chart.
  const gapped = bars(close - minute).filter((bar) => bar.time !== exit - 5 * minute);
  const fake = fakeDependencies(stored(bars(exit), "stale-signature"), close - minute, gapped);

  const result = await loadCachedCandles(trade, candleSignature(trade), fake.dependencies);

  assert.deepEqual(result?.candles, gapped);
  assert.equal(result?.signature, candleSignature(trade));
  assert.deepEqual(fake.cache.get(candleCacheKey(trade))?.candles, gapped);
  assert.deepEqual(fake.counts(), { requests: 1, writes: 1 });
});

test("a gapped matching cache still renders when the refetch fails", async () => {
  const gapped = stored(bars(close - minute).filter((bar) => bar.time !== exit - 5 * minute));
  const cache = new Map([[candleCacheKey(trade), gapped]]);
  const dependencies: CandleLoadDependencies = {
    read: async (key) => cache.get(key),
    write: async (key, value) => { cache.set(key, value); },
    request: async () => { throw new Error("offline"); },
    now: () => close - minute,
  };

  const result = await loadCachedCandles(trade, gapped.signature, dependencies);

  // The partial chart is better than no chart: the gap is reported on screen, not thrown away.
  assert.equal(result, gapped);
});

test("a fresh payload missing the exit bar is still rejected as incomplete", async () => {
  const noExitBar = bars(close - minute).filter((bar) => bar.time !== exit);
  const fake = fakeDependencies(stored(bars(exit), "stale-signature"), close - minute, noExitBar);

  await assert.rejects(() => loadCachedCandles(trade, candleSignature(trade), fake.dependencies), /unavailable/);
});

test("session close stays at 17:00 New York across DST and follows evening session assignment", () => {
  assert.equal(sessionCloseUtc("2026-03-10T19:00:00.000Z"), Date.parse("2026-03-10T21:00:00.000Z"));
  assert.equal(sessionCloseUtc("2026-11-10T20:00:00.000Z"), Date.parse("2026-11-10T22:00:00.000Z"));
  assert.equal(sessionCloseUtc("2026-11-10T22:30:00.000Z"), Date.parse("2026-11-11T22:00:00.000Z"));
  assert.equal(sessionCloseUtc("2026-11-13T23:30:00.000Z"), Date.parse("2026-11-16T22:00:00.000Z"));
});
