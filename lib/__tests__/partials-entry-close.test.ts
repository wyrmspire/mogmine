// Issue #38: split targets and partial exits in manual entry (resolveDraftPartials) and scale-out close (scaleOutTradePatch).
import assert from "node:assert/strict";
import { test } from "node:test";
import { remainingOpenQty, resolveDraftPartials, scaleOutTradePatch, upgradeDraft, freshEntryDraft } from "../entry-form.ts";
import type { EntryDraft } from "../entry-form.ts";
import { validateTradePartials } from "../partials-record.ts";
import { normalizeTrade, tradePnl, toTicks, validateTradeInput } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { resultR } from "../r-size.ts";

const ZONE = "UTC";
const ENTRY_MS = Date.parse("2026-11-12T15:34:00Z");

// Fixture 7 as entered by hand: 2 MES LONG at 7600, stop 7595, T1 7605 × 1, T2 7612.50 × 1, exits 15:42 and 16:05.
function fixtureSevenDraft(over: Partial<EntryDraft> = {}): EntryDraft {
  return {
    ...freshEntryDraft(new Date("2026-11-12T16:10:00Z"), ZONE),
    status: "closed", symbol: "MES", direction: "LONG", quantity: "2", entryPrice: "7600", stopPrice: "7595",
    date: "2026-11-12", entryClock: "15:34", exitClock: "16:05",
    partialTargets: [{ price: "7605", qty: "1" }, { price: "7612.50", qty: "1" }],
    partialExits: [{ price: "7605", clock: "15:42", qty: "1" }, { price: "7612.50", clock: "16:05", qty: "1", reason: "target" }],
    ...over,
  };
}

function resolveFixtureSeven(over: Partial<EntryDraft> = {}, quantity = 2) {
  return resolveDraftPartials({ draft: fixtureSevenDraft(over), entryPrice: 7600, quantity, isOpenDraft: fixtureSevenDraft(over).status === "open", entryMs: ENTRY_MS, zone: ZONE });
}

const openTrade = (): TradeRecord => normalizeTrade({
  id: "open-two", symbol: "MES", direction: "LONG", quantity: 2, status: "open",
  entry_time: "2026-11-12T15:34:00Z", exit_time: null, entry_price: 7600, exit_price: null,
  initial_stop_price: 7595, initial_stop_set_at: "2026-11-12T15:34:00Z", stop_loss_price: 7595, r_size_cents: 30_000,
});

test("fixture 7 entered by hand: tick-valid exit, exact partial_targets and partial_exits, +$87.50 and $300 R", () => {
  const resolved = resolveFixtureSeven();
  assert.equal(resolved.error, null);
  assert.equal(resolved.legged, true);
  assert.deepEqual(resolved.targets, [{ key: "t1", price: 7605, qty: 1 }, { key: "t2", price: 7612.5, qty: 1 }]);
  assert.equal(resolved.exits.length, 2);
  assert.equal(resolved.exitPrice, 7608.75);
  assert.equal(toTicks(resolved.exitPrice as number, "MES") !== null, true);
  assert.equal(resolved.exitTime, "2026-11-12T16:05:00.000Z");

  const trade = normalizeTrade({
    id: "entered-fixture-seven", symbol: "MES", direction: "LONG", quantity: 2, status: "closed",
    entry_time: new Date(ENTRY_MS).toISOString(), entry_price: 7600, exit_time: resolved.exitTime, exit_price: resolved.exitPrice,
    initial_stop_price: 7595, stop_loss_price: 7595, partial_targets: resolved.targets, partial_exits: resolved.exits, r_size_cents: 30_000,
  });
  assert.equal(tradePnl(trade), 87.5);
  assert.equal(resultR(trade, 30_000), 87.5 / 300);
  assert.equal(validateTradePartials({ partial_exits: resolved.exits, partial_targets: resolved.targets }, trade), null);
  assert.deepEqual(validateTradeInput({ symbol: "MES", direction: "LONG", quantity: 2, entry_price: 7600, exit_price: resolved.exitPrice as number, stop_loss_price: 7595, planned_target_price: null, key_level_price: null }), {});
  assert.equal(resolved.metrics?.pnlUsd, 87.5);
});

test("closed trade: exits that do not add up to Contracts are refused with the clear message", () => {
  const resolved = resolveFixtureSeven({ partialExits: [{ price: "7605", clock: "15:42", qty: "1" }] });
  assert.equal(resolved.error, "Partial exit quantities (1) must equal Contracts (2), or switch status to Still open");
  assert.equal(resolved.exitPrice, null);
});

test("an open draft may scale out with fewer exit contracts than Contracts", () => {
  const resolved = resolveFixtureSeven({ status: "open", entryClock: "15:34", partialExits: [{ price: "7605", clock: "15:42", qty: "1" }] }, 2);
  assert.equal(resolved.error, null);
  assert.equal(resolved.exits.length, 1);
  assert.equal(resolved.exitPrice, null);
  assert.equal(resolved.metrics, null);
});

test("off-tick target and exit prices, and wrong-side targets, are refused", () => {
  const offTickTarget = resolveFixtureSeven({ partialTargets: [{ price: "7605.1", qty: "1" }] });
  assert.match(offTickTarget.error ?? "", /tick grid/);
  const offTickExit = resolveFixtureSeven({ partialExits: [{ price: "7605.1", clock: "15:42", qty: "2" }] });
  assert.match(offTickExit.error ?? "", /tick grid/);
  const wrongSide = resolveFixtureSeven({ partialTargets: [{ price: "7595", qty: "1" }] });
  assert.match(wrongSide.error ?? "", /reward side of entry/);
  const shortWrongSide = resolveFixtureSeven({ direction: "SHORT", partialTargets: [{ price: "7605", qty: "1" }] });
  assert.match(shortWrongSide.error ?? "", /reward side of entry/);
});

test("quantities above Contracts and whole-quantity rules are refused", () => {
  assert.match(resolveFixtureSeven({ partialTargets: [{ price: "7605", qty: "3" }] }).error ?? "", /cannot exceed Contracts/);
  assert.match(resolveFixtureSeven({ partialTargets: [{ price: "7605", qty: "1.5" }] }).error ?? "", /whole quantity/);
  assert.match(resolveFixtureSeven({ partialExits: [{ price: "7605", clock: "15:42", qty: "0" }] }).error ?? "", /whole quantity/);
});

test("blank rows are ignored and an empty draft has no error", () => {
  const resolved = resolveFixtureSeven({ partialTargets: [{ price: "", qty: "" }], partialExits: [] });
  assert.equal(resolved.error, null);
  assert.deepEqual(resolved.targets, []);
  assert.equal(resolved.legged, false);
});

test("an exit clock earlier than the entry clock rolls to the next day", () => {
  const resolved = resolveFixtureSeven({ partialExits: [{ price: "7605", clock: "01:10", qty: "2" }] }, 2);
  assert.equal(resolved.error, null);
  assert.equal(resolved.exits[0].time, "2026-11-13T01:10:00.000Z");
});

test("upgradeDraft keeps split targets and partial exits", () => {
  const draft = fixtureSevenDraft();
  const kept = upgradeDraft(JSON.parse(JSON.stringify(draft)), new Date("2026-11-12T16:10:00Z"), ZONE);
  assert.deepEqual(kept.partialTargets, draft.partialTargets);
  assert.deepEqual(kept.partialExits?.map((row) => [row.price, row.clock, row.qty]), [["7605", "15:42", "1"], ["7612.50", "16:05", "1"]]);
});

test("scale-out: closing 1 of 2 keeps the trade open with one leg", () => {
  const patch = scaleOutTradePatch(openTrade(), "2026-11-12T15:42:00.000Z", 7605, 1, "target");
  assert.ok(patch);
  assert.equal(patch.status, "open");
  assert.equal(patch.exit_time, null);
  assert.equal(patch.exit_price, null);
  const after = normalizeTrade({ ...openTrade(), ...patch });
  assert.equal(after.status, "open");
  assert.equal(after.partial_exits?.length, 1);
  assert.equal(remainingOpenQty(after), 1);
});

test("scale-out: closing the remaining contract closes the trade with two legs and exact multi-lot P&L", () => {
  const first = normalizeTrade({ ...openTrade(), ...scaleOutTradePatch(openTrade(), "2026-11-12T15:42:00.000Z", 7605, 1, "target") });
  const patch = scaleOutTradePatch(first, "2026-11-12T16:05:00.000Z", 7612.5, 1, "target");
  assert.ok(patch);
  const closed = normalizeTrade({ ...first, ...patch });
  assert.equal(closed.status, "closed");
  assert.equal(closed.partial_exits?.length, 2);
  assert.equal(closed.exit_time, "2026-11-12T16:05:00.000Z");
  assert.equal(closed.exit_price, 7608.75);
  assert.equal(tradePnl(closed), 87.5);
});

test("scale-out: closing every contract at once on a fresh open trade is the ordinary close (no partial_exits)", () => {
  const patch = scaleOutTradePatch(openTrade(), "2026-11-12T16:05:00.000Z", 7612.5, 2, "target");
  assert.ok(patch);
  assert.equal(patch.status, "closed");
  assert.equal(patch.partial_exits, undefined);
  assert.equal(patch.exit_price, 7612.5);
});

test("scale-out refuses a quantity outside 1..contracts still open", () => {
  assert.equal(scaleOutTradePatch(openTrade(), "2026-11-12T16:05:00.000Z", 7612.5, 0, null), null);
  assert.equal(scaleOutTradePatch(openTrade(), "2026-11-12T16:05:00.000Z", 7612.5, 3, null), null);
});
