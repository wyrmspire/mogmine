import assert from "node:assert/strict";
import { test } from "node:test";
import { formatResolutionUsage } from "../chart-indicators.ts";
import { dayCandlesUsable } from "../candles.ts";
import { fetchMixedResolution } from "../mixed-resolution.ts";
import { computeSessionIndicators } from "../session-indicators.ts";
import { equityIndexSessionBounds } from "../session.ts";
import type { MarketDataProvider, MarketDataQuery } from "../market-data/types.ts";
import type { Candle, Timeframe } from "../trades.ts";

const MIN = 60_000;
const session = equityIndexSessionBounds("2026-11-25");
const offset = (minutes: number) => session.open + minutes * MIN;
const holes = new Set([77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 169, 170, 171, 172, 173, 360, 361, 362, 363, 364, 365, 366, 367, 368]);

function candle(time: number, price = 100, volume = 10, high = price, low = price): Candle {
  return { time, open: price, high, low, close: price, volume };
}

class PatternProvider implements MarketDataProvider {
  readonly name = "golden";
  readonly calls: MarketDataQuery[] = [];
  resolveProviderSymbol() { return "MES=F"; }
  supportsTickData() { return false; }
  async getCandles(query: MarketDataQuery) {
    this.calls.push(query);
    const from = query.from.getTime();
    const to = query.to.getTime();
    const bars: Candle[] = [];
    const width = ({ "1m": 1, "5m": 5, "15m": 15, "1h": 60 } satisfies Record<Timeframe, number>)[query.timeframe];
    for (let time = Math.floor(from / (width * MIN)) * width * MIN; time < to; time += width * MIN) {
      const minute = (time - session.open) / MIN;
      if (!Number.isInteger(minute) || minute < 0 || minute >= 1380) continue;
      if (query.timeframe === "1m" && holes.has(minute)) continue;
      // Yahoo's 23:00 CT 5m bar is null; 15m is also absent in this golden, so 1h fills its first five minutes.
      if ((query.timeframe === "5m" && minute === 360) || query.timeframe === "15m") continue;
      bars.push(candle(time, 100, width * 10, query.timeframe === "1h" && minute === 360 ? 120 : 100,
        query.timeframe === "1h" && minute === 360 ? 80 : 100));
    }
    return bars;
  }
}

test("real Yahoo null-run pattern fills only its holes with 5m then 1h and keeps residual volume", async () => {
  const provider = new PatternProvider();
  const result = await fetchMixedResolution(provider, "MES", session.open, session.close);
  assert.equal(result.complete, true);
  assert.equal(result.missingMinutes, 0);
  assert.equal(result.baseTimeframe, "1m");
  assert.ok(result.candles.every((bar) => bar.minutes > 0 && bar.fillFrom));
  assert.ok(provider.calls.filter((call) => call.timeframe === "5m").every((call) =>
    call.to.getTime() - call.from.getTime() < session.close - session.open), "5m requests only aligned holes");
  assert.equal(result.candles.reduce((sum, bar) => sum + bar.volume, 0), 1380 * 10, "no volume is counted twice");
  assert.equal(result.candles.every((bar) => bar.volume >= 0), true);
  assert.equal(formatResolutionUsage(result.usage)?.includes("23:00–23:08 from 1h/5m"), true);

  const indicators = computeSessionIndicators(result.candles, {
    symbol: "MES", timeframe: "1m", asOf: session.close, anchor: "globex",
  });
  assert.ok(indicators?.vwap.length);
  assert.equal(indicators?.coverage.anchored.approximate, true);
  assert.equal(indicators?.coverage.anchored.missingBars, 0);
  assert.equal(indicators?.levels.find((level) => level.key === "onh")?.price, 120);
  assert.equal(indicators?.levels.find((level) => level.key === "onl")?.price, 80);
});

test("VWAP bands use cumulative volume-weighted population variance at default 1σ and 2σ", () => {
  const bars = [candle(session.rthOpen, 100), candle(session.rthOpen + MIN, 110)];
  const result = computeSessionIndicators(bars, { symbol: "MES", timeframe: "1m", asOf: session.rthOpen + 2 * MIN, anchor: "rth" });
  assert.ok(result);
  assert.equal(result.vwap.at(-1)?.value, 105);
  assert.deepEqual(result.vwapBands.map((series) => {
    const point = series.at(-1)!;
    return [point.multiple, point.lower, point.upper];
  }), [[1, 100, 110], [2, 95, 115]]);
});

test("weekly VWAP starts at the Sunday 18:00 ET Globex open and withholds when no resolution covers a hole", () => {
  const monday = equityIndexSessionBounds("2026-11-23");
  const complete = [candle(monday.open, 100), candle(monday.open + MIN, 110)];
  const result = computeSessionIndicators(complete, { symbol: "MES", timeframe: "1m", asOf: monday.open + 2 * MIN, anchor: "globex" });
  assert.deepEqual(result?.weeklyVwap, result?.vwap);
  assert.equal(result?.weeklyVwap[0]?.time, monday.open + MIN);

  const missing = computeSessionIndicators([complete[0]], { symbol: "MES", timeframe: "1m", asOf: monday.open + 2 * MIN, anchor: "globex" });
  assert.deepEqual(missing?.vwap, []);
  assert.deepEqual(missing?.weeklyVwap, []);
});

test("a cached fallback session gets one repair load, then stops retrying", () => {
  const coarse = [{ ...candle(session.open, 100, 600), minutes: 60, fillFrom: "1h" as const }];
  const ended = session.open + 60 * MIN;
  const cached = { candles: coarse, baseTimeframe: "1m" as const, fetchedAt: ended + 2 * 60 * MIN, gapRefetches: 0 };
  assert.equal(dayCandlesUsable(cached, ended, ended + 3 * 60 * MIN, "MES", session.open), false);
  assert.equal(dayCandlesUsable({ ...cached, gapRefetches: 1 }, ended, ended + 3 * 60 * MIN, "MES", session.open), true);
});
