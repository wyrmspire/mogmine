// FB-2: the "Use HH:MM" fill-time patch with Undo, and the "Add time" stop-move prefill (docs/design-2026-11-24/05 §4.3, SM-UT-3).
// Times are UTC. Trade C: logged 14:14 CT (20:14Z), printed in the 14:13 CT bar (20:13Z).
import assert from "node:assert/strict";
import test from "node:test";
import { buildMatchedFillPatch, requestStopMovePrefill, subscribeStopMovePrefill } from "../fill-match.ts";
import type { StopMovePrefill } from "../fill-match.ts";
import { classifyTrade, normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const ENTRY_LOGGED = "2026-11-23T20:14:00.000Z";
const ENTRY_MATCHED_MS = Date.parse("2026-11-23T20:13:00.000Z");
const EXIT = "2026-11-23T20:30:00.000Z";

function tradeC(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id: "trade-c",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    status: "closed",
    entry_time: ENTRY_LOGGED,
    exit_time: EXIT,
    entry_price: 7263,
    exit_price: 7270,
    stop_loss_price: 7255,
    initial_stop_price: 7255,
    initial_stop_set_at: ENTRY_LOGGED,
    quick_tags: [],
    ...overrides,
  });
}

test("Use 14:13 on Trade C: patch writes the matched bar, undo restores the logged time exactly", () => {
  const trade = tradeC();
  assert.equal(trade.entry_time, "2026-11-23T20:14:00.000Z");

  const built = buildMatchedFillPatch(trade, "entry", ENTRY_MATCHED_MS);
  assert.ok(built);
  assert.equal(built.patch.entry_time, "2026-11-23T20:13:00.000Z");
  assert.equal(built.undoPatch.entry_time, "2026-11-23T20:14:00.000Z");
  assert.equal(built.patch.trade_style, classifyTrade("2026-11-23T20:13:00.000Z", EXIT));

  const applied = { ...trade, ...built.patch };
  assert.equal(applied.entry_time, "2026-11-23T20:13:00.000Z");
  const restored = { ...applied, ...built.undoPatch };
  assert.deepEqual(restored, trade);
});

test("Use on an exit moves exit_time and recomputes style; undo restores the original exit", () => {
  const trade = tradeC();
  const matchedExit = Date.parse("2026-11-23T20:31:00.000Z");
  const built = buildMatchedFillPatch(trade, "exit", matchedExit);
  assert.ok(built);
  assert.equal(built.patch.exit_time, "2026-11-23T20:31:00.000Z");
  assert.equal(built.undoPatch.exit_time, EXIT);
  assert.deepEqual({ ...{ ...trade, ...built.patch }, ...built.undoPatch }, trade);
});

test("Ordering guard: a matched entry at or after the exit is rejected", () => {
  const trade = tradeC();
  assert.equal(buildMatchedFillPatch(trade, "entry", Date.parse(EXIT)), null);
  assert.equal(buildMatchedFillPatch(trade, "entry", Date.parse("2026-11-23T20:45:00.000Z")), null);
});

test("Ordering guard: a matched exit at or before the entry is rejected, and an open trade has no exit to move", () => {
  const trade = tradeC();
  assert.equal(buildMatchedFillPatch(trade, "exit", Date.parse(ENTRY_LOGGED)), null);
  assert.equal(buildMatchedFillPatch(trade, "exit", Date.parse("2026-11-23T20:00:00.000Z")), null);
  const open = tradeC({ status: "open", exit_time: null, exit_price: null });
  assert.equal(buildMatchedFillPatch(open, "exit", Date.parse(EXIT)), null);
});

test("Non-finite matched time is rejected", () => {
  assert.equal(buildMatchedFillPatch(tradeC(), "entry", Number.NaN), null);
});

test("requestStopMovePrefill delivers { tradeId, price } to subscribers and stops after unsubscribe", () => {
  const received: StopMovePrefill[] = [];
  const otherTrade: StopMovePrefill[] = [];
  const unsubscribe = subscribeStopMovePrefill((request) => received.push(request));
  const unsubscribeOther = subscribeStopMovePrefill((request) => otherTrade.push(request));

  requestStopMovePrefill("trade-c", 7260);
  assert.deepEqual(received, [{ tradeId: "trade-c", price: 7260 }]);
  assert.equal(otherTrade.length, 1);

  unsubscribe();
  requestStopMovePrefill("trade-c", 7261);
  assert.equal(received.length, 1, "an unsubscribed listener gets nothing");
  assert.equal(otherTrade.length, 2);

  unsubscribeOther();
  requestStopMovePrefill("trade-c", 7262);
  assert.equal(otherTrade.length, 2, "no listeners left, nothing delivered");
});
