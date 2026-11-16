// Tests for Issue #89: sample trades render from fixtures/sample-bars.json at runtime
// with no Yahoo or /api/market-data fetch calls, and chart store receives fixture bars.
import assert from "node:assert/strict";
import test from "node:test";
import { demoTrades } from "../fixtures.ts";
import { ensureCandles, getCandleEntry, getSampleCandles, resetCandlesForTest } from "../candles.ts";
import { aggregateCandles, normalizeTrade } from "../trades.ts";
import type { Candle } from "../trades.ts";
import sampleBarsData from "../../fixtures/sample-bars.json" with { type: "json" };

interface SampleBarsPayload {
  shared: Record<string, [number, number, number, number, number][]>;
  tradeSymbols: Record<string, string>;
}

const fixtureData = sampleBarsData as unknown as SampleBarsPayload;

test("all ten sample trades load fixture bars from sample-bars.json with zero fetch calls", async () => {
  resetCandlesForTest();
  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCallCount += 1;
    throw new Error(`Unexpected fetch call in sample candle loading: ${String(input)}`);
  }) as typeof fetch;

  try {
    assert.equal(demoTrades.length, 10);
    for (const trade of demoTrades) {
      assert.equal(trade.is_sample, true, `${trade.id} must be marked as a sample`);
      await ensureCandles(trade);

      const entry = getCandleEntry(trade.id);
      assert.ok(entry, `${trade.id} should have a candle entry in the store`);
      assert.equal(entry.status, "ready", `${trade.id} should be ready`);
      assert.equal(entry.source, "Demo fixture", `${trade.id} must have source Demo fixture`);
      assert.equal(entry.baseTimeframe, "1m", `${trade.id} base timeframe must be 1m`);
      assert.equal(entry.fetching, false, `${trade.id} must not be in fetching state`);

      const symbol = fixtureData.tradeSymbols[trade.id];
      const expectedRawBars = (symbol ? fixtureData.shared[symbol] : undefined) ?? [];
      assert.ok(expectedRawBars.length > 0, `Missing shared fixture bars for ${trade.id} (${symbol})`);
      assert.equal(entry.candles.length, expectedRawBars.length, `${trade.id} candle count mismatch`);

      for (let i = 0; i < expectedRawBars.length; i += 1) {
        const time = expectedRawBars[i][0];
        const open = expectedRawBars[i][1];
        const high = expectedRawBars[i][2];
        const low = expectedRawBars[i][3];
        const close = expectedRawBars[i][4];
        const barCandle: Candle = entry.candles[i];
        assert.equal(barCandle.time, time, `${trade.id} bar[${i}] time mismatch`);
        assert.equal(barCandle.open, open, `${trade.id} bar[${i}] open mismatch`);
        assert.equal(barCandle.high, high, `${trade.id} bar[${i}] high mismatch`);
        assert.equal(barCandle.low, low, `${trade.id} bar[${i}] low mismatch`);
        assert.equal(barCandle.close, close, `${trade.id} bar[${i}] close mismatch`);
      }
    }

    assert.equal(fetchCallCount, 0, "No fetch or market-data calls should occur for sample trades");
  } finally {
    globalThis.fetch = originalFetch;
    resetCandlesForTest();
  }
});

test("shared Globex-week pad yields at least 45 bars on 1m, 5m, 15m, and 1h for every sample", () => {
  for (const trade of demoTrades) {
    const candles = getSampleCandles(trade.id, fixtureData);
    assert.ok(candles, `${trade.id} must have fixture candles`);
    assert.ok(candles.length >= 45, `${trade.id} 1m has ${candles.length} bars, need 45`);
    for (const timeframe of ["5m", "15m", "1h"] as const) {
      const aggregated = aggregateCandles(candles, timeframe);
      assert.ok(
        aggregated.length >= 45,
        `${trade.id} ${timeframe} has ${aggregated.length} bars, need 45`,
      );
    }
  }
});

test("a missing fixture set for a sample leaves details usable but no chart", async () => {
  resetCandlesForTest();
  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCallCount += 1;
    throw new Error(`Unexpected fetch call for missing sample fixture: ${String(input)}`);
  }) as typeof fetch;

  try {
    const unmappedSample = normalizeTrade({
      id: "mes-unknown-sample-without-bars",
      symbol: "MES",
      direction: "LONG",
      quantity: 1,
      entry_time: "2026-11-14T15:30:00.000Z",
      exit_time: "2026-11-14T15:45:00.000Z",
      entry_price: 6000,
      exit_price: 6010,
      stop_loss_price: 5990,
      planned_target_price: 6025,
      is_sample: true,
    });

    assert.equal(getSampleCandles(unmappedSample.id, fixtureData), null);

    await ensureCandles(unmappedSample);
    const entry = getCandleEntry(unmappedSample.id);
    assert.ok(entry, "Entry should exist in store");
    assert.equal(entry.status, "none", "Status must be none when fixture is missing");
    assert.equal(entry.candles.length, 0, "Candles must be empty");
    assert.equal(entry.source, null, "Source must be null");
    assert.equal(entry.fetching, false, "Fetching must be false");
    assert.equal(fetchCallCount, 0, "Missing sample fixture must not fall back to Yahoo");
  } finally {
    globalThis.fetch = originalFetch;
    resetCandlesForTest();
  }
});

test("normalizeTrade preserves Demo fixture source for samples but strips it for real trades", () => {
  const sampleWithFixture = normalizeTrade({
    id: "sample-trade",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-10T15:00:00Z",
    exit_time: "2026-11-10T15:10:00Z",
    entry_price: 6000,
    exit_price: 6010,
    is_sample: true,
    candle_source: "Demo fixture",
    sparkline: [6000, 6005, 6010],
  });
  assert.equal(sampleWithFixture.candle_source, "Demo fixture");
  assert.deepEqual(sampleWithFixture.sparkline, [6000, 6005, 6010]);

  const realWithFixture = normalizeTrade({
    id: "real-trade",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-10T15:00:00Z",
    exit_time: "2026-11-10T15:10:00Z",
    entry_price: 6000,
    exit_price: 6010,
    is_sample: false,
    candle_source: "Demo fixture",
    sparkline: [6000, 6005, 6010],
  });
  assert.equal(realWithFixture.candle_source, undefined, "Real trades must not accept Demo fixture source");
  assert.deepEqual(realWithFixture.sparkline, [], "Sparkline must be wiped for real trade with non-market candles");

  const realWithYahoo = normalizeTrade({
    id: "real-trade-yahoo",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-10T15:00:00Z",
    exit_time: "2026-11-10T15:10:00Z",
    entry_price: 6000,
    exit_price: 6010,
    is_sample: false,
    candle_source: "Yahoo Finance",
    sparkline: [6000, 6005, 6010],
  });
  assert.equal(realWithYahoo.candle_source, "Yahoo Finance");
  assert.deepEqual(realWithYahoo.sparkline, [6000, 6005, 6010]);
});

test("real trades trigger market-data fetch when window is defined", async () => {
  resetCandlesForTest();
  const fetchedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  // Must cover the trade window (#90), not merely four bars.
  const entryMs = Date.parse("2026-11-10T15:00:00.000Z");
  const exitMs = Date.parse("2026-11-10T15:30:00.000Z");
  const minute = 60_000;
  const mockCandles: Candle[] = [];
  for (let time = entryMs - 5 * minute; time < exitMs + 5 * minute; time += minute) {
    mockCandles.push({ time, open: 6000, high: 6005, low: 5995, close: 6002, volume: 10 });
  }

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    fetchedUrls.push(url);
    return {
      ok: true,
      json: async () => ({ candles: mockCandles, baseTimeframe: "1m" }),
    } as Response;
  }) as typeof fetch;

  const originalWindow = globalThis.window;
  globalThis.window = {} as unknown as Window & typeof globalThis;

  try {
    const realTrade = normalizeTrade({
      id: "real-trade-fetch-test",
      symbol: "MES",
      direction: "LONG",
      quantity: 1,
      entry_time: "2026-11-10T15:00:00.000Z",
      exit_time: "2026-11-10T15:30:00.000Z",
      entry_price: 6000,
      exit_price: 6010,
      is_sample: false,
    });

    ensureCandles(realTrade);
    // Allow the async load to complete
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(fetchedUrls.length, 1);
    assert.ok(fetchedUrls[0].includes("/api/market-data?symbol=MES"));

    const entry = getCandleEntry(realTrade.id);
    assert.ok(entry);
    assert.equal(entry.status, "ready");
    assert.equal(entry.source, "Yahoo Finance");
    assert.ok(entry.candles.length >= 4);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    resetCandlesForTest();
  }
});
