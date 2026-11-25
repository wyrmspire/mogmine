// VOL-1: volume pane helpers, and proof that real Yahoo bar volume survives the data path unchanged.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSampleCandles } from "../candles.ts";
import { YahooFinanceProvider } from "../market-data/yahoo.ts";
import { hasRealVolume, volumeHistogramData, volumeScaleMargins, volumeShare } from "../volume.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;
const start = Date.parse("2026-11-09T14:30:00Z");

function bar(index: number, volume: number, open = 100, close = 100): Candle {
  return { time: start + index * minute, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume };
}

const theme = { volumeUp: "rgba(1, 2, 3, 0.35)", volumeDown: "rgba(4, 5, 6, 0.35)" };

test("hasRealVolume is false for empty, all-zero, all-placeholder and invalid volume", () => {
  assert.equal(hasRealVolume([]), false);
  assert.equal(hasRealVolume([bar(0, 0), bar(1, 0)]), false);
  assert.equal(hasRealVolume([bar(0, 1), bar(1, 1), bar(2, 1)]), false);
  assert.equal(hasRealVolume([bar(0, 5), bar(1, NaN)]), false);
  assert.equal(hasRealVolume([bar(0, 5), bar(1, -2)]), false);
});

test("hasRealVolume is true for real traded volume, including a window with some zero bars", () => {
  assert.equal(hasRealVolume([bar(0, 120), bar(1, 340), bar(2, 2500)]), true);
  assert.equal(hasRealVolume([bar(0, 0), bar(1, 340)]), true);
  assert.equal(hasRealVolume([bar(0, 1), bar(1, 2)]), true);
});

test("volumeHistogramData keeps times and values, and colours by candle direction", () => {
  const bars = [bar(0, 10, 100, 101), bar(1, 20, 101, 100), bar(2, 30, 100, 100)];
  assert.deepEqual(volumeHistogramData(bars, theme), [
    { time: start, value: 10, color: "rgba(1, 2, 3, 0.35)" },
    { time: start + minute, value: 20, color: "rgba(4, 5, 6, 0.35)" },
    // A flat bar (close = open) counts as up, matching the candle colour rule.
    { time: start + 2 * minute, value: 30, color: "rgba(1, 2, 3, 0.35)" },
  ]);
});

test("volumeHistogramData falls back to the 08 candle colours at alpha 0.35 when the theme omits them", () => {
  const [point] = volumeHistogramData([bar(0, 10, 100, 99)], {});
  assert.equal(point.color, "rgba(236, 86, 100, 0.35)");
});

test("empty input gives empty output", () => {
  assert.deepEqual(volumeHistogramData([], theme), []);
});

test("the pane is shorter on phone-height charts and pinned to the bottom", () => {
  assert.equal(volumeShare(390), 0.16);
  assert.equal(volumeShare(640), 0.2);
  assert.deepEqual(volumeScaleMargins(640), { top: 0.8, bottom: 0 });
});

test("sample bars carry no volume: a fixture row without a sixth column is not real volume", () => {
  const payload = {
    shared: { MES: [[start, 100, 101, 99, 100.5], [start + minute, 100.5, 101, 100, 100.25]] as [number, number, number, number, number][] },
    tradeSymbols: { "sample-a": "MES" },
  };
  const candles = getSampleCandles("sample-a", payload) ?? [];
  assert.equal(candles.length, 2);
  assert.deepEqual(candles.map((c) => c.volume), [0, 0]);
  assert.equal(hasRealVolume(candles), false);
});

test("a sample fixture row with a sixth column keeps its volume", () => {
  const payload = {
    shared: { MES: [[start, 100, 101, 99, 100.5, 812], [start + minute, 100.5, 101, 100, 100.25, 430]] as [number, number, number, number, number, number][] },
    tradeSymbols: { "sample-b": "MES" },
  };
  assert.deepEqual(getSampleCandles("sample-b", payload)?.map((c) => c.volume), [812, 430]);
});

test("a Yahoo payload's bar volume reaches the candles unchanged; a null volume becomes 0", async () => {
  const realFetch = globalThis.fetch;
  const payload = {
    chart: {
      error: null,
      result: [{
        timestamp: [start / 1000, start / 1000 + 60, start / 1000 + 120],
        indicators: { quote: [{
          open: [100, 100.5, 101],
          high: [101, 101, 101.5],
          low: [99.5, 100, 100.5],
          close: [100.5, 100.25, 101.25],
          volume: [812, null, 4137],
        }] },
      }],
    },
  };
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
  try {
    const candles = await new YahooFinanceProvider().getCandles({
      symbol: "MES", timeframe: "1m", from: new Date(start), to: new Date(start + 3 * minute),
    });
    assert.deepEqual(candles.map((c) => c.volume), [812, 0, 4137]);
    assert.equal(candles[0].time, start);
    assert.equal(candles[2].close, 101.25);
  } finally {
    globalThis.fetch = realFetch;
  }
});
