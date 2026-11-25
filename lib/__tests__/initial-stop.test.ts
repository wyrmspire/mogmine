// R-10 (docs/16): the stop at entry, frozen. The first stop a trade ever has is captured once as
// `initial_stop_price` with its set time; later edits move `stop_loss_price` only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { initialRiskMultiple, normalizeTrade, riskMultiple, stopPatch } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const entryTime = "2026-11-10T15:00:00.000Z";
const exitTime = "2026-11-10T15:30:00.000Z";
const setAt = "2026-11-10T14:42:00.000Z";
const laterAt = "2026-11-10T16:05:00.000Z";

function saved(patch: Partial<TradeRecord>): TradeRecord {
  return normalizeTrade({
    id: "r10-1", symbol: "MES", direction: "LONG", entry_time: entryTime,
    exit_time: exitTime, entry_price: 6850, exit_price: 6867.5, quantity: 1, ...patch,
  });
}

test("R-10: a stop saved at entry sets all three fields", () => {
  const trade = saved({ ...stopPatch({ initial_stop_price: null }, 6841.25, setAt) });
  assert.equal(trade.stop_loss_price, 6841.25);
  assert.equal(trade.initial_stop_price, 6841.25);
  assert.equal(trade.initial_stop_set_at, setAt);
});

test("R-10: the first stop on a stop-less trade is captured once", () => {
  const bare = saved({});
  assert.equal(bare.stop_loss_price, null);
  assert.equal(bare.initial_stop_price, null);
  const first = { ...bare, ...stopPatch(bare, 6841.25, setAt) };
  assert.equal(first.stop_loss_price, 6841.25);
  assert.equal(first.initial_stop_price, 6841.25);
  assert.equal(first.initial_stop_set_at, setAt);
  // A second set does not re-capture: the patch touches the working stop only.
  assert.deepEqual(stopPatch(first, 6845, laterAt), { stop_loss_price: 6845 });
});

test("R-10: a later edit moves only stop_loss_price", () => {
  const trade = saved({ ...stopPatch({ initial_stop_price: null }, 6841.25, setAt) });
  const edited = { ...trade, ...stopPatch(trade, 6845, laterAt) };
  assert.equal(edited.stop_loss_price, 6845);
  assert.equal(edited.initial_stop_price, 6841.25);
  assert.equal(edited.initial_stop_set_at, setAt);
});

test("R-10: a stored initial stop survives normalising (backup restore never overwrites it)", () => {
  const restored = saved({ stop_loss_price: 6845, initial_stop_price: 6841.25, initial_stop_set_at: setAt });
  assert.equal(restored.initial_stop_price, 6841.25);
  assert.equal(restored.initial_stop_set_at, setAt);
  assert.deepEqual(stopPatch(restored, 6848, laterAt), { stop_loss_price: 6848 });
});

test("R-10: initialRiskMultiple is null with no initial stop", () => {
  const noStop = saved({});
  assert.equal(initialRiskMultiple(noStop), null);
  // A working stop alone does not create an initial stop: R on it is riskMultiple's business only.
  const workingOnly = saved({ stop_loss_price: 6841.25 });
  assert.equal(initialRiskMultiple(workingOnly), null);
  assert.equal(riskMultiple(workingOnly), 2);
});

test("R-10: initialRiskMultiple keeps the frozen stop after the working stop moves", () => {
  const trade = saved({ ...stopPatch({ initial_stop_price: null }, 6841.25, setAt) });
  // +17.5 pts over the frozen 8.75-pt risk is +2R, whatever the working stop later became.
  assert.equal(initialRiskMultiple(trade), 2);
  const edited = { ...trade, ...stopPatch(trade, 6845, laterAt) };
  // R itself is measured on the first risk too (riskStopPrice): moving the stop never changes R.
  assert.equal(riskMultiple(edited), 2);
  assert.equal(initialRiskMultiple(edited), 2);
});

test("R-10: an old record normalises with both new fields null (never back-filled from the stop)", () => {
  const old = saved({ stop_loss_price: 6841.25 });
  assert.equal(old.stop_loss_price, 6841.25);
  assert.equal(old.initial_stop_price, null);
  assert.equal(old.initial_stop_set_at, null);
});
