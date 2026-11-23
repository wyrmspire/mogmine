import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCachedCandles, nextCandleRetryAt } from "../candles.ts";
import { isYahooNoData, noCandlesMessage, noCandlesResponse, reasonFromResponse, windowInFuture } from "../market-data/outcome.ts";
import { YahooFinanceProvider } from "../market-data/yahoo.ts";
import type { TradeRecord } from "../trades.ts";

const now = Date.parse("2026-11-23T18:00:00Z");
// The QA trade from the field notes: MES 4866.25, dated Tue Nov 24 (tomorrow).
const future = {
  id: "qa-future", symbol: "MES", yahoo_ticker: "MES=F",
  entry_time: "2026-11-24T15:00:00Z", exit_time: "2026-11-24T15:20:00Z", entry_price: 4866.25,
} as TradeRecord;

test("a future window is answered calmly with no candles, never 502", () => {
  assert.equal(windowInFuture(Date.parse(future.entry_time), now), true);
  assert.equal(windowInFuture(now - 1, now), false);
  assert.deepEqual(noCandlesResponse("future"), { status: 200, body: { candles: [], reason: "future" } });
  assert.equal(noCandlesResponse("no-data").status, 404);
  assert.equal(noCandlesResponse("no-data").body.reason, "no-data");
  // Only a real upstream failure is a 502.
  assert.equal(noCandlesResponse("upstream").status, 502);
  assert.equal(noCandlesResponse("upstream").body.reason, "unavailable");
});

test("Yahoo's 'data doesn't exist' answers are empty, not failures", () => {
  assert.equal(isYahooNoData(400, '{"chart":{"result":null,"error":{"code":"Bad Request","description":"Data doesn\'t exist for startDate = 1795975200, endDate = 1796032800"}}}'), true);
  assert.equal(isYahooNoData(422, ""), true);
  assert.equal(isYahooNoData(404, ""), true);
  assert.equal(isYahooNoData(200, "No data found, symbol may be delisted"), true);
  assert.equal(isYahooNoData(400, "Invalid interval"), false);
  assert.equal(isYahooNoData(429, "Too Many Requests"), false);
  assert.equal(isYahooNoData(500, "data doesn't exist"), false);
});

test("the provider returns no candles for Yahoo's empty-range 400 and still throws on a real failure", async () => {
  const original = globalThis.fetch;
  const provider = new YahooFinanceProvider();
  const query = { symbol: "MES", timeframe: "1m" as const, from: new Date(now + 3_600_000), to: new Date(now + 7_200_000) };
  try {
    globalThis.fetch = (async () => new Response('{"chart":{"result":null,"error":{"code":"Bad Request","description":"Data doesn\'t exist for startDate = 1, endDate = 2"}}}', { status: 400 })) as typeof fetch;
    assert.deepEqual(await provider.getCandles(query), []);
    globalThis.fetch = (async () => new Response("Too Many Requests", { status: 429 })) as typeof fetch;
    await assert.rejects(provider.getCandles(query), /429/);
  } finally {
    globalThis.fetch = original;
  }
});

test("the client reads the reason from the route's answer", () => {
  assert.equal(reasonFromResponse({ ok: true, status: 200 }, { candles: [], reason: "future" }), "future");
  assert.equal(reasonFromResponse({ ok: false, status: 404 }, { error: "x" }), "no-data");
  assert.equal(reasonFromResponse({ ok: false, status: 502 }, null), "unavailable");
  assert.equal(reasonFromResponse({ ok: true, status: 200 }, { candles: [] }), null);
});

test("the page says why there is no chart, calmly", () => {
  assert.equal(noCandlesMessage("future", true), "No candles for this time: the trade is dated in the future");
  assert.equal(noCandlesMessage("no-data", false), "Yahoo has no candles for this time");
  assert.equal(noCandlesMessage("no-data", true), "Yahoo has not published these bars yet");
  assert.equal(noCandlesMessage("unavailable", false), "No candles loaded for this trade");
});

test("a future-dated trade is asked again at its entry, not every minute", () => {
  const none = { status: "none" as const, candles: [], baseTimeframe: "1m" as const };
  assert.equal(nextCandleRetryAt(future, { ...none, reason: "future" }, now, now), Date.parse(future.entry_time));
  // Without the reason it would poll each minute because the exit looks "fresh".
  assert.equal(nextCandleRetryAt(future, none, now, now), now + 60_000);
});

test("the cache loader keeps the route's reason so the page can show it", async () => {
  const deps = (message: string) => ({
    read: async () => undefined,
    write: async () => undefined,
    request: async () => { throw new Error(message); },
    now: () => now,
  });
  await assert.rejects(loadCachedCandles(future, "sig", deps("future")), /^Error: future$/);
  await assert.rejects(loadCachedCandles(future, "sig", deps("no-data")), /^Error: no-data$/);
  await assert.rejects(loadCachedCandles(future, "sig", deps("socket hang up")), /^Error: unavailable$/);
});
