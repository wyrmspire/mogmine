// R-03a (docs/16): a trade that is still open. Types and math only; OD-38: an open trade has no result.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dayStats } from "../selectors.ts";
import { parseBackupFile } from "../store.ts";
import {
  buildSparkline, candleSignature, classifyTrade, excursions, exitFlagReason, holdSeconds, initialRiskUsd,
  isClosed, isOpen, isScratch, normalizeTrade, plannedR, rMultiple, tradePnl, tradePoints, tradeTicks, validateTradeInput,
} from "../trades.ts";
import type { Candle } from "../trades.ts";

const entryTime = "2026-11-10T15:00:00.000Z";
const open = normalizeTrade({
  id: "open-1",
  status: "open",
  symbol: "MES",
  direction: "LONG",
  entry_time: entryTime,
  exit_time: null,
  entry_price: 6000,
  exit_price: null,
  stop_loss_price: 5995,
  planned_target_price: 6010,
  quantity: 2,
});
const closed = normalizeTrade({ ...open, id: "closed-1", status: "closed", exit_time: "2026-11-10T15:05:00.000Z", exit_price: 6005 });

test("R-03a: an open trade is open and not closed; a closed one is the reverse", () => {
  assert.equal(open.status, "open");
  assert.equal(isOpen(open), true);
  assert.equal(isClosed(open), false);
  assert.equal(isOpen(closed), false);
  assert.equal(isClosed(closed), true);
});

test("R-03a: every money function returns null for an open trade (no unrealised P&L, OD-38)", () => {
  assert.equal(tradeTicks(open), null);
  assert.equal(tradePoints(open), null);
  assert.equal(tradePnl(open), null);
  assert.equal(rMultiple(open), null);
  assert.equal(isScratch(open), false);
  assert.equal(exitFlagReason(open), null);
  const bars: Candle[] = [0, 1, 2, 3].map((i) => ({ time: Date.parse(entryTime) + i * 60_000, open: 6000, high: 6002, low: 5998, close: 6001, volume: 1 }));
  assert.equal(excursions(open, bars), null);
  assert.deepEqual(buildSparkline(open, bars), []);
  // Closed counterpart still prices: +5 points × 2 MES × $5.
  assert.equal(tradePnl(closed), 50);
});

test("R-03a: risk and planned R do not need the exit and keep working on an open trade", () => {
  assert.equal(initialRiskUsd(open), 50);
  assert.equal(plannedR(open), 2);
});

test("R-03a: hold and style of an open trade are measured up to now", () => {
  const now = Date.parse(entryTime) + 20 * 60_000;
  assert.equal(holdSeconds(open, now), 1200);
  assert.equal(classifyTrade(entryTime, null, now), "session_90m");
  assert.equal(classifyTrade(entryTime, null, Date.parse(entryTime) + 60_000), "scalp");
  // A closed trade ignores `now`.
  assert.equal(holdSeconds(closed, now), 300);
});

test("R-03a: the candle signature says open, so closing the trade changes it", () => {
  assert.match(candleSignature(open), /\|open$/);
  assert.notEqual(candleSignature(open), candleSignature(closed));
});

test("R-03a: a legacy record with no status normalises to closed", () => {
  const legacy = normalizeTrade({
    id: "legacy", symbol: "MES", direction: "SHORT",
    entry_time: entryTime, exit_time: "2026-11-10T15:01:00.000Z", entry_price: 6000, exit_price: 5999,
  });
  assert.equal(legacy.status, "closed");
});

test("R-03a: normalizeTrade rejects a status that disagrees with the exit fields", () => {
  assert.throws(() => normalizeTrade({ ...open, exit_price: 6001 }), /does not match/);
  assert.throws(() => normalizeTrade({ ...open, exit_time: "2026-11-10T15:05:00.000Z" }), /does not match/);
  assert.throws(() => normalizeTrade({ ...closed, exit_price: null }), /does not match/);
  assert.throws(() => normalizeTrade({ ...closed, status: undefined, exit_time: null, exit_price: null }), /does not match/);
});

test("R-03a: day stats leave open trades out of P&L, win rate and R, and count them apart", () => {
  const stats = dayStats([open, closed]);
  assert.equal(stats.openCount, 1);
  assert.equal(stats.pricedCount, 1);
  assert.equal(stats.unpriceableCount, 0);
  assert.equal(stats.incomplete, false);
  assert.equal(stats.gross, 50);
  assert.equal(stats.winRate, 1);
  assert.equal(stats.withR, 1);
  assert.equal(stats.count, 2);
});

test("R-03a: a backup with an open trade restores; a closed trade with a missing exit is still rejected", () => {
  const ok = parseBackupFile(JSON.stringify({ app: "mogmine", version: 1, trades: [open, closed] }));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    const restored = ok.trades.find((trade) => trade.id === "open-1");
    assert.equal(restored?.status, "open");
    assert.equal(restored?.exit_time, null);
    assert.equal(restored?.exit_price, null);
  }
  const bad = parseBackupFile(JSON.stringify({ app: "mogmine", version: 1, trades: [{ ...closed, exit_price: null }] }));
  assert.equal(bad.ok, false);
  const legacyMissing = parseBackupFile(JSON.stringify([{ ...closed, status: undefined, exit_time: undefined }]));
  assert.equal(legacyMissing.ok, false);
  const openWithExit = parseBackupFile(JSON.stringify([{ ...open, exit_price: 6001 }]));
  assert.equal(openWithExit.ok, false);
});

test("R-03a: validation skips the exit price only when it is null (open)", () => {
  const base = { symbol: "MES", direction: "LONG" as const, quantity: 1, entry_price: 6000, stop_loss_price: null, planned_target_price: null, key_level_price: null };
  assert.equal(validateTradeInput({ ...base, exit_price: null }).exit_price, undefined);
  assert.ok(validateTradeInput({ ...base, exit_price: Number.NaN }).exit_price);
});
