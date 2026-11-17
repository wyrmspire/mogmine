// Issue #86 / AC-06: a matching cache is reusable, but it is not final until the hindsight window closes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { exitIsFresh, loadCachedCandles, nextCandleRetryAt } from "../candles.ts";
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

// R-02 (docs/16): fresh-trade candles retry and refresh.
const noneEntry = { status: "none" as const, candles: [] as Candle[], baseTimeframe: "1m" as const };
const readyEntry = (candles: Candle[]) => ({ status: "ready" as const, candles, baseTimeframe: "1m" as const });

test("R-02: a finished, complete ready set never retries", () => {
  assert.equal(nextCandleRetryAt(trade, readyEntry(bars(close - minute)), close + minute, close + 2 * minute), null);
  assert.equal(nextCandleRetryAt(trade, readyEntry(bars(close - minute)), close + minute, close + 24 * 60 * minute), null);
});

test("R-02: a none entry with an exit under 60 minutes ago retries each minute", () => {
  const attempt = exit + 2 * minute;
  assert.equal(nextCandleRetryAt(trade, noneEntry, attempt, attempt + 10_000), attempt + minute);
  assert.equal(exitIsFresh(trade, exit + 59 * minute), true);
});

test("R-02: a none entry with an older exit retries every 15 minutes", () => {
  const attempt = exit + 90 * minute;
  assert.equal(nextCandleRetryAt(trade, noneEntry, attempt, attempt + minute), attempt + 15 * minute);
  assert.equal(exitIsFresh(trade, exit + 60 * minute), false);
  // Days later the backoff stays at 15 minutes, never faster.
  const later = close + 3 * 24 * 60 * minute;
  assert.equal(nextCandleRetryAt(trade, noneEntry, later, later), later + 15 * minute);
});

test("R-02: a ready entry refreshes every 5 minutes while the session is open", () => {
  const attempt = exit + 10 * minute;
  assert.equal(nextCandleRetryAt(trade, readyEntry(bars(exit + 8 * minute)), attempt, attempt + minute), attempt + 5 * minute);
});

test("R-02: a ready set that misses the close after it falls back to the once-per-load refetch", () => {
  assert.equal(nextCandleRetryAt(trade, readyEntry(bars(exit + 3 * minute)), close + minute, close + 2 * minute), null);
});

test("R-02: a loading entry is never retried on top of itself", () => {
  const loading = { status: "loading" as const, candles: [] as Candle[], baseTimeframe: "1m" as const };
  assert.equal(nextCandleRetryAt(trade, loading, exit, exit + 30 * minute), null);
});

test("R-03c: an open trade is never exit-fresh, and its candles are never final", () => {
  const open = { exit_time: null, entry_time: new Date(exit).toISOString() };
  assert.equal(exitIsFresh(open, exit), false);
  // Missing: each minute for the first hour after the entry, then every 15 minutes.
  assert.equal(nextCandleRetryAt(open, noneEntry, exit + 2 * minute, exit + 2 * minute), exit + 3 * minute);
  assert.equal(nextCandleRetryAt(open, noneEntry, exit + 90 * minute, exit + 90 * minute), exit + 105 * minute);
  // Loaded: refresh every five minutes, even after the session close.
  assert.equal(nextCandleRetryAt(open, readyEntry(bars(exit)), exit + 10 * minute, exit + 11 * minute), exit + 15 * minute);
  assert.equal(nextCandleRetryAt(open, readyEntry(bars(close - minute)), close + minute, close + 2 * minute), close + 6 * minute);
  const loading = { status: "loading" as const, candles: [] as Candle[], baseTimeframe: "1m" as const };
  assert.equal(nextCandleRetryAt(open, loading, exit, exit + 30 * minute), null);
});

test("R-02: a due refresh asks the network even when the matching cache covers the trade", async () => {
  const partial = stored(bars(exit + 3 * minute));
  const more = bars(exit + 20 * minute);
  const fake = fakeDependencies(partial, exit + 21 * minute, more);

  const result = await loadCachedCandles(trade, partial.signature, { ...fake.dependencies, refresh: true });

  assert.deepEqual(result?.candles, more);
  assert.deepEqual(fake.counts(), { requests: 1, writes: 1 });
});

test("R-02: a refetch with fewer bars keeps the cache", async () => {
  const cached = stored(bars(exit + 20 * minute));
  const fewer = bars(exit + 5 * minute);
  const fake = fakeDependencies(cached, exit + 21 * minute, fewer);

  const result = await loadCachedCandles(trade, cached.signature, { ...fake.dependencies, refresh: true });

  assert.equal(result, cached);
  assert.deepEqual(fake.counts(), { requests: 1, writes: 0 });
});

const openTrade = { ...trade, id: "cache-open", status: "open", exit_time: null, exit_price: null } as TradeRecord;

test("R-03c: an open trade's matching cache is shown but never final: the network is always asked", async () => {
  const cached = stored(bars(exit), candleSignature(openTrade));
  const more = bars(exit + 10 * minute);
  const cache = new Map([[candleCacheKey(openTrade), cached]]);
  let requests = 0;
  const result = await loadCachedCandles(openTrade, cached.signature, {
    read: async (key) => cache.get(key),
    write: async (key, value) => { cache.set(key, value); },
    request: async () => { requests += 1; return { candles: more, baseTimeframe: "1m" }; },
    now: () => exit + 11 * minute,
  });
  assert.equal(requests, 1);
  assert.deepEqual(result?.candles, more);
});

test("R-03c: an open trade needs only its entry bar; a payload without it keeps the cache", async () => {
  const cached = stored(bars(exit), candleSignature(openTrade));
  const noEntry = bars(exit).filter((bar) => bar.time > Date.parse(trade.entry_time));
  const result = await loadCachedCandles(openTrade, cached.signature, {
    read: async () => cached,
    write: async () => undefined,
    request: async () => ({ candles: noEntry, baseTimeframe: "1m" }),
    now: () => exit,
  });
  assert.equal(result, cached);
  await assert.rejects(loadCachedCandles(openTrade, cached.signature, {
    read: async () => undefined,
    write: async () => undefined,
    request: async () => ({ candles: noEntry, baseTimeframe: "1m" }),
    now: () => exit,
  }));
});
