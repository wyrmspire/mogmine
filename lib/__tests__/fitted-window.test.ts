// Issue #14: deterministic chart-window golden cases. Browser screenshots remain a separate acceptance step.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitWindow, MIN_FITTED_BARS, TIMEFRAME_MINUTES, visibleLogicalBars } from "../trades.ts";

const entry = "2026-11-10T15:00:00.000Z";
const durations = [
  { name: "40-second scalp", seconds: 40 },
  { name: "5-minute scalp", seconds: 5 * 60 },
  { name: "16-minute hold", seconds: 16 * 60 },
  { name: "90-minute hold", seconds: 90 * 60 },
  { name: "4-hour hold", seconds: 4 * 60 * 60 },
];

for (const { name, seconds } of durations) {
  test(`fitted chart window: ${name}`, () => {
    const exit = new Date(Date.parse(entry) + seconds * 1000).toISOString();
    for (const timeframe of ["1m", "5m", "15m"] as const) {
      const window = fitWindow(entry, exit, timeframe);
      const expectedHoldBars = seconds / (TIMEFRAME_MINUTES[timeframe] * 60);
      assert.ok(Math.abs(window.holdBars - expectedHoldBars) < 1e-9);
      assert.ok(window.visibleBars >= MIN_FITTED_BARS);
      assert.ok(Math.abs(window.visibleBars - Math.max(expectedHoldBars * 2, MIN_FITTED_BARS)) < 1e-9);
      assert.ok(Math.abs(window.beforeBars + window.holdBars + window.afterBars - window.visibleBars) < 1e-9);
      assert.ok(window.start < Date.parse(entry));
      assert.ok(window.end > Date.parse(exit));
      const share = window.holdBars / window.visibleBars;
      assert.ok(share > 0 && share <= 0.5, "hold must occupy no more than half the logical window");
      assert.equal(visibleLogicalBars({ from: 10, to: 10 + window.visibleBars }), window.visibleBars);
    }
  });
}

test("coarser timeframe widens clock-time context for a short hold", () => {
  const exit = new Date(Date.parse(entry) + 5 * 60 * 1000).toISOString();
  const oneMinute = fitWindow(entry, exit, "1m");
  const fifteenMinute = fitWindow(entry, exit, "15m");
  assert.ok(fifteenMinute.end - fifteenMinute.start > oneMinute.end - oneMinute.start);
});
