import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeTrade } from "../trades.ts";
import type { StopMove, TradeRecord } from "../trades.ts";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
const jiti = createJiti(fileURLToPath(import.meta.url), { jsx: true });

const {
  CONTRACT_SPECS,
  StopMovesEditor,
  addStopMoveItem,
  classifyStopMove,
  computeStopMoveDelta,
  computeStopMoveDeltas,
  detectMovesWidening,
  getTickSize,
  removeStopMoveItem,
  stepPrice,
  updateStopMoveItem,
} = jiti("../../components/StopMovesEditor.tsx");

const T_ENTRY = "2026-11-20T14:30:00.000Z";
const T_MOVE1 = "2026-11-20T14:35:00.000Z";
const T_MOVE2 = "2026-11-20T14:40:00.000Z";
const T_MOVE3 = "2026-11-20T14:45:00.000Z";
const T_EXIT = "2026-11-20T14:50:00.000Z";

function makeTestTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id: "editor-test-trade-1",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    status: "closed",
    entry_time: T_ENTRY,
    exit_time: T_EXIT,
    entry_price: 6000,
    exit_price: 6010,
    stop_loss_price: 5990,
    initial_stop_price: 5990,
    initial_stop_set_at: T_ENTRY,
    planned_target_price: 6020,
    quick_tags: [],
    ...overrides,
  });
}

test("StopMovesEditor component: exported and defines callable React component", () => {
  assert.equal(typeof StopMovesEditor, "function");
});

test("StopMovesEditor helpers: getTickSize and CONTRACT_SPECS provide valid futures specs", () => {
  assert.equal(getTickSize("MES"), 0.25);
  assert.equal(getTickSize("ES"), 0.25);
  assert.equal(getTickSize("MNQ"), 0.25);
  assert.equal(getTickSize("NQ"), 0.25);
  assert.equal(getTickSize("MYM"), 1.0);
  assert.equal(getTickSize("M2K"), 0.1);
  assert.equal(getTickSize("MCL"), 0.01);
  // Unknown fallback
  assert.equal(getTickSize("UNKNOWN"), 0.25);

  assert.equal(CONTRACT_SPECS.MES.tickSize, 0.25);
  assert.equal(CONTRACT_SPECS.MES.pointValueUsd, 5);
});

test("StopMovesEditor helpers: stepPrice nudges and snaps prices cleanly onto tick grid", () => {
  // MES: 0.25 tick
  assert.equal(stepPrice(6000, 1, "MES"), 6000.25);
  assert.equal(stepPrice(6000, -1, "MES"), 5999.75);
  assert.equal(stepPrice(6000, 4, "MES"), 6001.0);
  assert.equal(stepPrice(6000, -4, "MES"), 5999.0);

  // Snapping off-grid base price
  assert.equal(stepPrice(6000.1, 1, "MES"), 6000.25);

  // MYM: 1.0 tick
  assert.equal(stepPrice(44000, 2, "MYM"), 44002);
  assert.equal(stepPrice(44000, -1, "MYM"), 43999);

  // MCL: 0.01 tick
  assert.equal(stepPrice(70.15, 1, "MCL"), 70.16);
  assert.equal(stepPrice(70.15, -5, "MCL"), 70.1);
});

test("StopMovesEditor helpers: classifyStopMove identifies tightened, breakeven, widened, and unchanged for LONG", () => {
  const entry = 6000;
  const prior = 5990;

  // Unchanged
  assert.equal(classifyStopMove(5990, 5990, entry, "LONG", "MES"), "unchanged");

  // Tightened (moved up closer to entry)
  assert.equal(classifyStopMove(prior, 5995, entry, "LONG", "MES"), "tightened");

  // Breakeven (moved exactly to entry)
  assert.equal(classifyStopMove(prior, 6000, entry, "LONG", "MES"), "breakeven");

  // Tightened into profit
  assert.equal(classifyStopMove(6000, 6005, entry, "LONG", "MES"), "tightened");

  // Widened (moved down away from entry)
  assert.equal(classifyStopMove(prior, 5985, entry, "LONG", "MES"), "widened");
});

test("StopMovesEditor helpers: classifyStopMove identifies tightened, breakeven, widened, and unchanged for SHORT", () => {
  const entry = 6000;
  const prior = 6010;

  // Unchanged
  assert.equal(classifyStopMove(6010, 6010, entry, "SHORT", "MES"), "unchanged");

  // Tightened (moved down closer to entry)
  assert.equal(classifyStopMove(prior, 6005, entry, "SHORT", "MES"), "tightened");

  // Breakeven (moved exactly to entry)
  assert.equal(classifyStopMove(prior, 6000, entry, "SHORT", "MES"), "breakeven");

  // Tightened into profit (moved below entry)
  assert.equal(classifyStopMove(6000, 5995, entry, "SHORT", "MES"), "tightened");

  // Widened (moved higher away from entry)
  assert.equal(classifyStopMove(prior, 6015, entry, "SHORT", "MES"), "widened");
});

test("StopMovesEditor helpers: computeStopMoveDelta computes accurate metrics and flags", () => {
  // LONG: 5990 -> 5995
  const delta1 = computeStopMoveDelta(5990, 5995, 6000, "LONG", "MES");
  assert.equal(delta1.deltaPoints, 5.0);
  assert.equal(delta1.deltaTicks, 20);
  assert.equal(delta1.riskDeltaPoints, 5.0);
  assert.equal(delta1.kind, "tightened");
  assert.equal(delta1.isWidened, false);
  assert.equal(delta1.isLockedProfit, false);

  // LONG: 5995 -> 6000 (breakeven)
  const delta2 = computeStopMoveDelta(5995, 6000, 6000, "LONG", "MES");
  assert.equal(delta2.deltaPoints, 5.0);
  assert.equal(delta2.deltaTicks, 20);
  assert.equal(delta2.kind, "breakeven");
  assert.equal(delta2.isWidened, false);
  assert.equal(delta2.isLockedProfit, true);

  // LONG: 6000 -> 6005 (profit locked)
  const delta3 = computeStopMoveDelta(6000, 6005, 6000, "LONG", "MES");
  assert.equal(delta3.deltaPoints, 5.0);
  assert.equal(delta3.deltaTicks, 20);
  assert.equal(delta3.kind, "tightened");
  assert.equal(delta3.isWidened, false);
  assert.equal(delta3.isLockedProfit, true);

  // LONG: 6005 -> 5995 (widened giveback)
  const delta4 = computeStopMoveDelta(6005, 5995, 6000, "LONG", "MES");
  assert.equal(delta4.deltaPoints, -10.0);
  assert.equal(delta4.deltaTicks, -40);
  assert.equal(delta4.riskDeltaPoints, -10.0);
  assert.equal(delta4.kind, "widened");
  assert.equal(delta4.isWidened, true);
  assert.equal(delta4.isLockedProfit, false);

  // SHORT: 6010 -> 6005
  const shortDelta = computeStopMoveDelta(6010, 6005, 6000, "SHORT", "MES");
  assert.equal(shortDelta.deltaPoints, -5.0);
  assert.equal(shortDelta.deltaTicks, -20);
  assert.equal(shortDelta.riskDeltaPoints, 5.0); // positive risk reduction
  assert.equal(shortDelta.kind, "tightened");
  assert.equal(shortDelta.isWidened, false);
  assert.equal(shortDelta.isLockedProfit, false);
});

test("StopMovesEditor helpers: computeStopMoveDeltas evaluates multi-step sequence", () => {
  const trade = makeTestTrade({
    entry_price: 6000,
    initial_stop_price: 5990,
  });

  const moves: StopMove[] = [
    { price: 5995, time: T_MOVE1 },
    { price: 6000, time: T_MOVE2 },
    { price: 6005, time: T_MOVE3 },
  ];

  const deltas = computeStopMoveDeltas(trade, moves);
  assert.equal(deltas.length, 3);

  // Row 0 vs initial stop 5990
  assert.equal(deltas[0].priorPrice, 5990);
  assert.equal(deltas[0].price, 5995);
  assert.equal(deltas[0].kind, "tightened");
  assert.equal(deltas[0].isLockedProfit, false);
  assert.equal(deltas[0].time, T_MOVE1);

  // Row 1 vs Row 0 (5995)
  assert.equal(deltas[1].priorPrice, 5995);
  assert.equal(deltas[1].price, 6000);
  assert.equal(deltas[1].kind, "breakeven");
  assert.equal(deltas[1].isLockedProfit, true);
  assert.equal(deltas[1].time, T_MOVE2);

  // Row 2 vs Row 1 (6000)
  assert.equal(deltas[2].priorPrice, 6000);
  assert.equal(deltas[2].price, 6005);
  assert.equal(deltas[2].kind, "tightened");
  assert.equal(deltas[2].isLockedProfit, true);
  assert.equal(deltas[2].time, T_MOVE3);
});

test("StopMovesEditor helpers: detectMovesWidening detects risk widening in sequence", () => {
  const longTrade = makeTestTrade({
    entry_price: 6000,
    initial_stop_price: 5990,
    direction: "LONG",
  });

  // No moves -> not widened
  assert.equal(detectMovesWidening(longTrade, []), false);

  // Tightening only -> not widened
  const cleanMoves: StopMove[] = [
    { price: 5995, time: T_MOVE1 },
    { price: 6005, time: T_MOVE2 },
  ];
  assert.equal(detectMovesWidening(longTrade, cleanMoves), false);

  // First move widens (5990 -> 5980)
  const widenedMove1: StopMove[] = [{ price: 5980, time: T_MOVE1 }];
  assert.equal(detectMovesWidening(longTrade, widenedMove1), true);

  // Second move widens (5990 -> 5995 -> 5985)
  const widenedMove2: StopMove[] = [
    { price: 5995, time: T_MOVE1 },
    { price: 5985, time: T_MOVE2 },
  ];
  assert.equal(detectMovesWidening(longTrade, widenedMove2), true);

  // SHORT trade widening test (6010 -> 6005 -> 6015)
  const shortTrade = makeTestTrade({
    entry_price: 6000,
    initial_stop_price: 6010,
    direction: "SHORT",
  });
  const shortWidened: StopMove[] = [
    { price: 6005, time: T_MOVE1 },
    { price: 6015, time: T_MOVE2 },
  ];
  assert.equal(detectMovesWidening(shortTrade, shortWidened), true);
});

test("StopMovesEditor helpers: addStopMoveItem, removeStopMoveItem, and updateStopMoveItem mutate arrays cleanly and sort", () => {
  const initialMoves: StopMove[] = [
    { price: 5995, time: T_MOVE1 },
    { price: 6005, time: T_MOVE3 },
  ];

  // Add move between MOVE1 and MOVE3 -> automatically sorted chronologically
  const added = addStopMoveItem(initialMoves, { price: 6000, time: T_MOVE2 });
  assert.equal(added.length, 3);
  assert.equal(added[0].time, T_MOVE1);
  assert.equal(added[1].time, T_MOVE2);
  assert.equal(added[2].time, T_MOVE3);
  assert.equal(added[1].price, 6000);

  // Update item at index 1
  const updated = updateStopMoveItem(added, 1, { price: 6001 });
  assert.equal(updated.length, 3);
  assert.equal(updated[1].price, 6001);

  // Remove item at index 0
  const removed = removeStopMoveItem(updated, 0);
  assert.equal(removed.length, 2);
  assert.equal(removed[0].price, 6001);
  assert.equal(removed[1].price, 6005);

  // Out of bounds index does not alter list
  const noopRemove = removeStopMoveItem(removed, 99);
  assert.equal(noopRemove.length, 2);
});
