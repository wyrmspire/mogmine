import assert from "node:assert/strict";
import { test } from "node:test";
import { rStripCaption, rStripInputFromTrade, rStripLayout, rStripLabel } from "../rstrip.ts";

const long = { direction: "LONG" as const, entry: 100, exit: 103, stop: 99, target: 103 };

test("a long that tags the target reads as ran to plan, with stop on the left and target on the right", () => {
  const layout = rStripLayout(long);
  assert.ok(layout);
  assert.equal(layout.kind, "ran-to-plan");
  assert.ok(layout.stop != null && layout.target != null);
  assert.ok(layout.stop < layout.entry && layout.entry < layout.target);
  assert.ok(layout.exit != null);
  assert.ok(Math.abs(layout.exit - layout.target) < 1e-9);
});

test("a stop-out sits at the left; a short uses the same stop-left, target-right axis", () => {
  const stopped = rStripLayout({ direction: "LONG", entry: 100, exit: 99, stop: 99, target: 103 });
  assert.equal(stopped?.kind, "stopped-out");
  assert.ok(stopped && stopped.exit != null && stopped.stop != null);
  assert.ok(Math.abs(stopped.exit - stopped.stop) < 1e-9);

  const short = rStripLayout({ direction: "SHORT", entry: 100, exit: 97, stop: 101, target: 97 });
  assert.equal(short?.kind, "ran-to-plan");
  assert.ok(short && short.stop != null && short.target != null);
  assert.ok(short.stop < short.entry && short.entry < short.target);
});

test("cutting early sits between entry and target", () => {
  const layout = rStripLayout({ direction: "LONG", entry: 100, exit: 101, stop: 99, target: 103 });
  assert.equal(layout?.kind, "cut-early");
  assert.ok(layout && layout.exit != null);
  assert.ok(layout.entry < layout.exit && layout.exit < (layout.target ?? 1));
});

test("MAE past the stop extends the left; MFE past the target extends the right", () => {
  const layout = rStripLayout({ direction: "LONG", entry: 100, exit: 103, stop: 99, target: 103, maePrice: 98.5, mfePrice: 104 });
  assert.ok(layout && layout.mae != null && layout.mfe != null && layout.stop != null && layout.target != null);
  assert.ok(layout.mae < layout.stop);
  assert.ok(layout.mfe > layout.target);
  assert.equal(layout.kind, "ran-to-plan");
});

test("works without candles and without a plan; Shield does not need dollars", () => {
  const bare = rStripLayout({ direction: "LONG", entry: 100, exit: 102, stop: null, target: null });
  assert.equal(bare?.kind, "no-plan");
  assert.equal(bare?.stop, null);
  assert.equal(bare?.target, null);
  assert.ok(bare && bare.entry < (bare.exit ?? 0));
  assert.equal(rStripLabel("stopped-out", -1, 2), "Stopped out, exit \u22121.0R");
});

test("an unusable entry yields no strip", () => {
  assert.equal(rStripLayout({ direction: "LONG", entry: Number.NaN, exit: 1, stop: 0, target: 2 }), null);
});

test("the exit outcome follows the money, not the classification", () => {
  // The review case: long 100, stop 99, target 103, exit 99.50 is cut-early but lost 0.5R —
  // the marker must read adverse (red), never green.
  const cutLoss = rStripLayout({ direction: "LONG", entry: 100, exit: 99.5, stop: 99, target: 103 });
  assert.equal(cutLoss?.kind, "cut-early");
  assert.equal(cutLoss?.exitOutcome, "adverse");

  const cutWin = rStripLayout({ direction: "LONG", entry: 100, exit: 101, stop: 99, target: 103 });
  assert.equal(cutWin?.kind, "cut-early");
  assert.equal(cutWin?.exitOutcome, "favorable");

  const scratch = rStripLayout({ direction: "LONG", entry: 100, exit: 100, stop: 99, target: 103 });
  assert.equal(scratch?.exitOutcome, "breakeven");

  const shortWin = rStripLayout({ direction: "SHORT", entry: 100, exit: 99.5, stop: 101, target: 97 });
  assert.equal(shortWin?.kind, "cut-early");
  assert.equal(shortWin?.exitOutcome, "favorable");

  const shortLoss = rStripLayout({ direction: "SHORT", entry: 100, exit: 100.5, stop: 101, target: 97 });
  assert.equal(shortLoss?.exitOutcome, "adverse");

  // No exit price: no marker, no outcome.
  assert.equal(rStripLayout({ direction: "LONG", entry: 100, exit: null, stop: 99, target: 103 })?.exitOutcome, null);
});

test("the caption is in account R on a 0.25R trade; the strip geometry is unchanged", () => {
  // $300 R size; MES entry 6840, stop 6825 (15 pts = $75 = 0.25R), target 6870 (2:1), exit at the target.
  const trade = {
    symbol: "MES", direction: "LONG" as const, quantity: 1, account_id: null, r_size_cents: 30000,
    entry_price: 6840, exit_price: 6870, stop_loss_price: 6825, initial_stop_price: 6825, planned_target_price: 6870,
  };
  const layout = rStripLayout(rStripInputFromTrade(trade));
  assert.ok(layout);
  assert.equal(layout.stop, 0);
  assert.equal(layout.target, 1);
  assert.equal(layout.exit, 1);
  assert.equal(rStripCaption(trade, layout), "Ran to plan, exit +0.5R, plan +0.5R");
  // The R size only moves the labels: $150 makes the same exit +1R.
  assert.equal(rStripCaption(trade, layout, 15000), "Ran to plan, exit +1.0R, plan +1.0R");
});
