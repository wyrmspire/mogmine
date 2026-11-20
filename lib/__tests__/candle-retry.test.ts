// R-02 end to end: ensureCandles with a stubbed fetch and clock. The pure schedule is in candle-cache.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureCandles, getCandleEntry, resetCandlesForTest } from "../candles.ts";
import { normalizeTrade } from "../trades.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;
const entryMs = Date.parse("2026-11-10T19:50:00.000Z"); // 14:50 America/New_York
const exitMs = Date.parse("2026-11-10T20:00:00.000Z"); // session closes 22:00Z

let now = exitMs + 3 * minute;
let requests = 0;
let respond: () => Response;

const realNow = Date.now;
Date.now = () => now;
Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { addEventListener() {} } });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: { getItem: () => null, setItem() {}, removeItem() {} },
});
globalThis.fetch = (async () => { requests += 1; return respond(); }) as typeof fetch;
process.on("exit", () => { Date.now = realNow; });

function bars(lastTime: number): Candle[] {
  const out: Candle[] = [];
  for (let time = entryMs - 30 * minute; time <= lastTime; time += minute) {
    out.push({ time, open: 6000, high: 6001, low: 5999, close: 6000, volume: 1 });
  }
  return out;
}

const found = (candles: Candle[]) => () => new Response(JSON.stringify({ candles, baseTimeframe: "1m" }), { status: 200 });
const missing = () => new Response(JSON.stringify({ error: "none" }), { status: 404 });
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function makeTrade(id: string, is_sample = false) {
  return normalizeTrade({
    id, symbol: "MES", direction: "LONG", quantity: 1,
    entry_time: new Date(entryMs).toISOString(), exit_time: new Date(exitMs).toISOString(),
    entry_price: 6000, exit_price: 6001, stop_loss_price: null, planned_target_price: null, key_level_price: null,
    note: "", is_sample,
  });
}

test("a ready in-session set refreshes after 5 minutes and stays on screen meanwhile", async () => {
  resetCandlesForTest();
  requests = 0;
  now = exitMs + 3 * minute;
  const trade = makeTrade("retry-ready");
  respond = found(bars(exitMs));
  ensureCandles(trade);
  await settle();
  assert.equal(getCandleEntry(trade.id)?.status, "ready");
  assert.equal(requests, 1);

  now += 4 * minute;
  ensureCandles(trade);
  await settle();
  assert.equal(requests, 1, "not due yet");

  now += minute + 1_000;
  respond = found(bars(exitMs + 8 * minute));
  ensureCandles(trade);
  assert.equal(getCandleEntry(trade.id)?.status, "ready", "the old bars stay visible while refreshing");
  assert.equal(getCandleEntry(trade.id)?.fetching, true);
  await settle();
  assert.equal(requests, 2);
  assert.equal(getCandleEntry(trade.id)?.candles.at(-1)?.time, exitMs + 8 * minute, "after-exit bars filled in");
});

test("a missing set retries after a minute without flashing a loading state", async () => {
  resetCandlesForTest();
  requests = 0;
  now = exitMs + 2 * minute;
  const trade = makeTrade("retry-missing");
  respond = missing;
  ensureCandles(trade);
  await settle();
  assert.equal(getCandleEntry(trade.id)?.status, "none");

  now += 30_000;
  ensureCandles(trade);
  await settle();
  assert.equal(requests, 1, "not due yet");

  now += 31_000;
  respond = found(bars(exitMs));
  ensureCandles(trade);
  assert.equal(getCandleEntry(trade.id)?.status, "none", "a scheduled retry keeps the no-chart state");
  assert.equal(getCandleEntry(trade.id)?.fetching, true);
  await settle();
  assert.equal(requests, 2);
  assert.equal(getCandleEntry(trade.id)?.status, "ready");
});

test("Retry forces a fetch at once and shows loading", async () => {
  resetCandlesForTest();
  requests = 0;
  now = exitMs + 2 * minute;
  const trade = makeTrade("retry-forced");
  respond = missing;
  ensureCandles(trade);
  await settle();
  ensureCandles(trade, true);
  assert.equal(getCandleEntry(trade.id)?.status, "loading");
  await settle();
  assert.equal(requests, 2);
});

test("a sample trade never fetches, however long it is open", async () => {
  resetCandlesForTest();
  requests = 0;
  now = exitMs + 2 * minute;
  const trade = makeTrade("retry-sample", true);
  ensureCandles(trade);
  await settle();
  now += 30 * minute;
  ensureCandles(trade);
  await settle();
  assert.equal(requests, 0);
});
