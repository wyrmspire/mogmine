import assert from "node:assert/strict";
import { test } from "node:test";
import { derivePlanVsActual } from "../plan-vs-actual.ts";
import { normalizeTrade } from "../trades.ts";

test("derivePlanVsActual: full plan executed to target", () => {
  // Long MES entry 6840, initial stop 6835 (5 pt risk = 1R), target 6850 (+10 pts = +2.0R)
  // Actual exit at 6850 (+10 pts = +2.0R)
  const trade = normalizeTrade({
    id: "pva-1",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:30:00Z",
    exit_time: "2026-11-20T15:00:00Z",
    entry_price: 6840,
    exit_price: 6850,
    initial_stop_price: 6835,
    stop_loss_price: 6835,
    planned_target_price: 6850,
    quantity: 1,
  });

  const comparison = derivePlanVsActual(trade);
  assert.equal(comparison.hasPlan, true);
  assert.equal(comparison.fidelity, "Executed to Plan");
  assert.equal(comparison.rows.length, 3); // Stop, Exit/Target, Result (R)

  const stopRow = comparison.rows.find((r) => r.label === "Stop")!;
  assert.equal(stopRow.planned, "6835.00");
  assert.equal(stopRow.actual, "6835.00");
  assert.equal(stopRow.deltaDisplay, "—");

  const targetRow = comparison.rows.find((r) => r.label === "Exit / Target")!;
  assert.equal(targetRow.planned, "6850.00");
  assert.equal(targetRow.actual, "6850.00");
  assert.equal(targetRow.deltaDisplay, "—");

  const resultRow = comparison.rows.find((r) => r.label === "Result (R)")!;
  assert.equal(resultRow.planned, "+2.0R at target");
  assert.equal(resultRow.actual, "+2.0R");
  assert.equal(resultRow.deltaDisplay, "+0.0R");
});

test("derivePlanVsActual: detects premature exit", () => {
  // Long MES entry 6840, initial stop 6835 (5 pt risk = 1R), target 6850 (+10 pts = +2.0R)
  // Actual exit at 6845 (+5 pts = +1.0R, cut 5 pts early)
  const trade = normalizeTrade({
    id: "pva-premature",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:30:00Z",
    exit_time: "2026-11-20T15:00:00Z",
    entry_price: 6840,
    exit_price: 6845,
    initial_stop_price: 6835,
    stop_loss_price: 6835,
    planned_target_price: 6850,
    quantity: 1,
  });

  const comparison = derivePlanVsActual(trade);
  assert.equal(comparison.fidelity, "Premature Exit");
  const targetRow = comparison.rows.find((r) => r.label === "Exit / Target")!;
  assert.equal(targetRow.tone, "negative");
  assert.equal(targetRow.deltaDisplay, "−5.00 pts (−1.0R)");
});

test("derivePlanVsActual: handles missing plan cleanly", () => {
  const trade = normalizeTrade({
    id: "pva-noplan",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:30:00Z",
    exit_time: "2026-11-20T15:00:00Z",
    entry_price: 6840,
    exit_price: 6845,
    stop_loss_price: null,
    planned_target_price: null,
    quantity: 1,
  });

  const comparison = derivePlanVsActual(trade);
  assert.equal(comparison.hasPlan, false);
  assert.equal(comparison.fidelity, "No Plan Recorded");
  assert.equal(comparison.rows.length, 0);
});
