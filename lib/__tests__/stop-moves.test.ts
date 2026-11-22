// docs/15 §3, issue #36 (G2): "I moved my stop" model & stepped stop path
// R-10: initial_stop_price frozen; UX-33: WIDENED suggests, never auto-applies, "Moved Stop" tag.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveTrade, fromLegacy, isTradeDocument, isStopWidened, isStopLockingProfit } from "../trade-document.ts";
import {
  acceptSuggestedTagPatch,
  addStopMovePatch,
  hasWidenedStop,
  initialRMultiple,
  isStopMove,
  isStopMoveLockingProfit,
  isStopMoveWidening,
  MOVED_STOP_TAG,
  normalizeTrade,
  recordStopMovesPatch,
  removeStopMovePatch,
  rMultiple,
  sanitizeStopMoves,
  suggestedQuickTags,
  updateStopMovePatch,
} from "../trades.ts";
import type { StopMove, TradeRecord } from "../trades.ts";

const ENTRY_T = "2026-11-20T14:30:00.000Z";
const MOVE1_T = "2026-11-20T14:35:00.000Z";
const MOVE2_T = "2026-11-20T14:40:00.000Z";
const EXIT_T = "2026-11-20T14:50:00.000Z";

function makeTrade(patch: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id: "g2-trade-1",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    status: "closed",
    entry_time: ENTRY_T,
    exit_time: EXIT_T,
    entry_price: 6000,
    exit_price: 6010,
    stop_loss_price: 5990,
    initial_stop_price: 5990,
    initial_stop_set_at: ENTRY_T,
    planned_target_price: 6020,
    ...patch,
  });
}

test("G2 model: isStopMove and sanitizeStopMoves validate and sort rows chronologically", () => {
  assert.equal(isStopMove({ price: 5995, time: MOVE1_T }), true);
  assert.equal(isStopMove({ price: 5995 }), false);
  assert.equal(isStopMove({ price: "bad", time: MOVE1_T }), false);
  assert.equal(isStopMove({ price: Number.NaN, time: MOVE1_T }), false);
  assert.equal(isStopMove({ price: 5995, time: "not-a-date" }), false);
  assert.equal(isStopMove(null), false);

  const unsorted: StopMove[] = [
    { price: 6005, time: MOVE2_T },
    { price: 5995, time: MOVE1_T },
  ];
  const sorted = sanitizeStopMoves(unsorted);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].price, 5995);
  assert.equal(sorted[0].time, MOVE1_T);
  assert.equal(sorted[1].price, 6005);
  assert.equal(sorted[1].time, MOVE2_T);

  // Filters out malformed rows
  const mixed = [
    { price: 5995, time: MOVE1_T },
    { price: Number.NaN, time: MOVE1_T },
    null,
    "garbage",
  ];
  assert.equal(sanitizeStopMoves(mixed).length, 1);
});

test("G2 model: normalizeTrade preserves optional stop_moves and leaves legacy fixtures unaffected", () => {
  // Legacy record without stop_moves remains undefined
  const legacy = makeTrade({});
  assert.equal(legacy.stop_moves, undefined);

  // Record with empty stop_moves preserved
  const empty = makeTrade({ stop_moves: [] });
  assert.deepEqual(empty.stop_moves, []);

  // Record with valid stop_moves preserved and sanitized
  const withMoves = makeTrade({
    stop_moves: [
      { price: 6005, time: MOVE2_T },
      { price: 5995, time: MOVE1_T },
    ],
  });
  assert.ok(withMoves.stop_moves);
  assert.equal(withMoves.stop_moves.length, 2);
  assert.equal(withMoves.stop_moves[0].price, 5995);
  assert.equal(withMoves.stop_moves[1].price, 6005);
});

test("G2 / R-10: adding stop moves keeps initial_stop_price frozen", () => {
  const initial = makeTrade({
    initial_stop_price: 5990,
    stop_loss_price: 5990,
  });

  // Add move 1 (tightened to 5995)
  const patch1 = addStopMovePatch(initial, 5995, MOVE1_T);
  const trade1 = makeTrade({ ...initial, ...patch1 });
  assert.equal(trade1.initial_stop_price, 5990, "initial stop must remain frozen");
  assert.equal(trade1.stop_loss_price, 5995, "stop_loss_price updates to newest move");
  assert.equal(trade1.stop_moves?.length, 1);
  assert.equal(trade1.stop_moves?.[0].price, 5995);

  // Add move 2 (trailed to 6005, locking profit)
  const patch2 = addStopMovePatch(trade1, 6005, MOVE2_T);
  const trade2 = makeTrade({ ...trade1, ...patch2 });
  assert.equal(trade2.initial_stop_price, 5990, "initial stop still frozen at 5990");
  assert.equal(trade2.stop_loss_price, 6005);
  assert.equal(trade2.stop_moves?.length, 2);

  // initialRMultiple remains measured against frozen 5990 risk (10 pts = $50)
  // Realized gain: 6010 - 6000 = +10 pts = +1.0R against initial stop
  assert.equal(initialRMultiple(trade2), 1);
  // rMultiple is null because trailing stop 6005 sits above entry 6000 (locked profit / risk <= 0)
  assert.equal(rMultiple(trade2), null);
});

test("G2 / R-10: first stop set on a stop-less trade initializes initial_stop_price", () => {
  const bare = normalizeTrade({
    id: "bare",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    status: "closed",
    entry_time: ENTRY_T,
    exit_time: EXIT_T,
    entry_price: 6000,
    exit_price: 6010,
    stop_loss_price: null,
    initial_stop_price: null,
    initial_stop_set_at: null,
  });

  const patch = addStopMovePatch(bare, 5990, MOVE1_T);
  assert.equal(patch.initial_stop_price, 5990);
  assert.equal(patch.initial_stop_set_at, MOVE1_T);
  assert.equal(patch.stop_loss_price, 5990);
  assert.equal(patch.stop_moves?.length, 1);
});

test("G2 patches: removeStopMovePatch and updateStopMovePatch keep initial_stop_price frozen", () => {
  const trade = makeTrade({
    initial_stop_price: 5990,
    stop_loss_price: 6005,
    stop_moves: [
      { price: 5995, time: MOVE1_T },
      { price: 6005, time: MOVE2_T },
    ],
  });

  // Remove the second move -> stop_loss_price falls back to move 1 (5995)
  const remPatch = removeStopMovePatch(trade, 1);
  assert.equal(remPatch.stop_loss_price, 5995);
  assert.equal(remPatch.stop_moves?.length, 1);

  // Remove all moves -> stop_loss_price falls back to initial_stop_price (5990)
  const remAll = removeStopMovePatch(makeTrade({ ...trade, ...remPatch }), 0);
  assert.equal(remAll.stop_loss_price, 5990);
  assert.equal(remAll.stop_moves?.length, 0);

  // Update move 1 price to 5996
  const updatePatch = updateStopMovePatch(trade, 0, { price: 5996, time: MOVE1_T });
  assert.equal(updatePatch.stop_moves?.[0].price, 5996);
  assert.equal(updatePatch.stop_loss_price, 6005, "last move 6005 still active");

  // Record whole batch
  const batchPatch = recordStopMovesPatch(trade, [{ price: 5998, time: MOVE1_T }]);
  assert.equal(batchPatch.stop_loss_price, 5998);
  assert.equal(batchPatch.stop_moves?.length, 1);
});

test("G2 stepped stop path: fromLegacy and deriveTrade build multi-segment stop path with stated basis", () => {
  const trade = makeTrade({
    entry_price: 6000,
    initial_stop_price: 5990,
    stop_loss_price: 6005,
    stop_moves: [
      { price: 5995, time: MOVE1_T },
      { price: 6005, time: MOVE2_T },
    ],
  });

  const doc = fromLegacy(trade);
  assert.equal(isTradeDocument(doc), true);

  // Stated basis on modify events
  const modEvents = doc.events.filter((e) => e.type === "modify");
  assert.equal(modEvents.length, 2);
  assert.equal(modEvents[0].basis, "stated");
  assert.equal(modEvents[0].t, MOVE1_T);
  assert.equal(modEvents[1].basis, "stated");
  assert.equal(modEvents[1].t, MOVE2_T);

  // Document annotations preserve stop_moves
  assert.deepEqual(doc.annotations?.stop_moves, trade.stop_moves);

  const derived = deriveTrade(doc);
  assert.equal(derived.stop_move_count, 2);
  assert.equal(derived.stop_path.length, 3);

  // Segment 0: 5990 from ENTRY_T to MOVE1_T
  assert.equal(derived.stop_path[0].price, 5990);
  assert.equal(derived.stop_path[0].from, ENTRY_T);
  assert.equal(derived.stop_path[0].to, MOVE1_T);
  assert.equal(derived.stop_path[0].widened, false);
  assert.equal(derived.stop_path[0].locked_profit, false);

  // Segment 1: 5995 from MOVE1_T to MOVE2_T (tightened)
  assert.equal(derived.stop_path[1].price, 5995);
  assert.equal(derived.stop_path[1].from, MOVE1_T);
  assert.equal(derived.stop_path[1].to, MOVE2_T);
  assert.equal(derived.stop_path[1].widened, false);
  assert.equal(derived.stop_path[1].locked_profit, false);

  // Segment 2: 6005 from MOVE2_T to EXIT_T (locked profit >= entry 6000)
  assert.equal(derived.stop_path[2].price, 6005);
  assert.equal(derived.stop_path[2].from, MOVE2_T);
  assert.equal(derived.stop_path[2].to, EXIT_T);
  assert.equal(derived.stop_path[2].widened, false);
  assert.equal(derived.stop_path[2].locked_profit, true);

  assert.equal(derived.stop_widened, false);
});

test("G2 stepped stop path: open trade leaves final segment open (to === null)", () => {
  const openTrade = normalizeTrade({
    id: "g2-open",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    status: "open",
    entry_time: ENTRY_T,
    exit_time: null,
    entry_price: 6000,
    exit_price: null,
    initial_stop_price: 5990,
    stop_loss_price: 5995,
    stop_moves: [{ price: 5995, time: MOVE1_T }],
  });

  const doc = fromLegacy(openTrade);
  const derived = deriveTrade(doc);
  assert.equal(derived.status, "open");
  assert.equal(derived.stop_path.length, 2);
  assert.equal(derived.stop_path[0].to, MOVE1_T);
  assert.equal(derived.stop_path[1].to, null, "active stop has null to-time");
});

test("G2 WIDENED detection: moving stop away from entry flags stop_widened (LONG & SHORT)", () => {
  // LONG: 5990 -> 5985 is moving further below entry (widening risk)
  assert.equal(isStopMoveWidening(5990, 5985, "LONG", "MES"), true);
  assert.equal(isStopMoveWidening(5990, 5995, "LONG", "MES"), false);

  // SHORT: 6010 -> 6015 is moving further above entry (widening risk)
  assert.equal(isStopMoveWidening(6010, 6015, "SHORT", "MES"), true);
  assert.equal(isStopMoveWidening(6010, 6005, "SHORT", "MES"), false);

  // Check exported trade-document functions
  assert.equal(isStopWidened(5990, 5985, 1, null), true);
  assert.equal(isStopWidened(5990, 5995, 1, null), false);
  assert.equal(isStopLockingProfit(6000, 6005, 1, null), true);
  assert.equal(isStopMoveLockingProfit(6000, 6005, "LONG", "MES"), true);
  assert.equal(isStopMoveLockingProfit(6000, 5995, "LONG", "MES"), false);
  assert.equal(isStopMoveLockingProfit(6000, 5995, "SHORT", "MES"), true);

  // DerivedTrade reflects widened stop and fact
  const widenedTrade = makeTrade({
    entry_price: 6000,
    initial_stop_price: 5990,
    stop_loss_price: 5980,
    stop_moves: [
      { price: 5980, time: MOVE1_T }, // Widened from 5990 to 5980
    ],
  });

  assert.equal(hasWidenedStop(widenedTrade), true);

  const doc = fromLegacy(widenedTrade);
  const derived = deriveTrade(doc);
  assert.equal(derived.stop_widened, true);
  assert.equal(derived.stop_path[1].widened, true);
  assert.ok(derived.facts.some((f) => f.code === "stop_widened"));
});

test("G2 / UX-33: WIDENED suggests, NEVER auto-applies, 'Moved Stop' tag", () => {
  const widenedTrade = makeTrade({
    entry_price: 6000,
    initial_stop_price: 5990,
    stop_loss_price: 5980,
    stop_moves: [{ price: 5980, time: MOVE1_T }],
    quick_tags: ["Opening Drive"],
  });

  // 1. Tag is NOT auto-applied to trade.quick_tags
  assert.deepEqual(widenedTrade.quick_tags, ["Opening Drive"]);
  assert.equal(widenedTrade.quick_tags.includes(MOVED_STOP_TAG), false);

  // 2. Selector suggests "Moved Stop"
  const suggestions = suggestedQuickTags(widenedTrade);
  assert.deepEqual(suggestions, [MOVED_STOP_TAG]);

  // 3. Trade quick_tags remains completely untouched after suggestion lookup
  assert.deepEqual(widenedTrade.quick_tags, ["Opening Drive"]);

  // 4. If trade already has "Moved Stop", suggestion list is empty (no duplicate prompt)
  const alreadyTagged = makeTrade({
    ...widenedTrade,
    quick_tags: ["Opening Drive", MOVED_STOP_TAG],
  });
  assert.deepEqual(suggestedQuickTags(alreadyTagged), []);

  // 5. Trader explicitly accepts suggestion via acceptSuggestedTagPatch
  const acceptedPatch = acceptSuggestedTagPatch(widenedTrade, MOVED_STOP_TAG);
  assert.deepEqual(acceptedPatch.quick_tags, ["Opening Drive", MOVED_STOP_TAG]);

  // 6. Non-widened trade (e.g. trailed stop) never suggests "Moved Stop"
  const trailedTrade = makeTrade({
    entry_price: 6000,
    initial_stop_price: 5990,
    stop_loss_price: 6005,
    stop_moves: [{ price: 6005, time: MOVE1_T }],
    quick_tags: [],
  });
  assert.equal(hasWidenedStop(trailedTrade), false);
  assert.deepEqual(suggestedQuickTags(trailedTrade), []);
});
