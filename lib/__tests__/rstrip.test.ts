import assert from "node:assert/strict";
import { test } from "node:test";
import { rStripLayout, rStripLabel } from "../rstrip.ts";

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
  assert.equal(rStripLabel("stopped-out", -1, 2), "Stopped out, exit -1.0R");
});

test("an unusable entry yields no strip", () => {
  assert.equal(rStripLayout({ direction: "LONG", entry: Number.NaN, exit: 1, stop: 0, target: 2 }), null);
});
