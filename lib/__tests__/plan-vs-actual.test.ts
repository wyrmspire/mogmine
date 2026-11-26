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
  // Account R at the default $250 (1 MES = $5/pt): +10 pts = +$50 = +0.20R. The plan's ratio reads as R:R, never as R.
  assert.equal(resultRow.planned, "R:R 2.0:1 at target");
  assert.equal(resultRow.actual, "+0.20R");
  assert.equal(resultRow.deltaDisplay, "+0.00R"); // realised +0.20R − planned +0.20R
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
  // −5 pts = −$25 = −0.10R at $250 (was −1.0R stop-width).
  assert.equal(targetRow.deltaDisplay, "−5.00 pts (−0.10R)");
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

test("derivePlanVsActual: live account R overrides the prefs fallback for a legacy trade", () => {
  const trade = normalizeTrade({
    id: "pva-live-account",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:30:00Z",
    exit_time: "2026-11-20T15:00:00Z",
    entry_price: 6000,
    exit_price: 6015,
    initial_stop_price: 5995,
    stop_loss_price: 5995,
    planned_target_price: 6020,
    quantity: 1,
    account_id: "acct-300",
    r_size_cents: null,
  });
  const comparison = derivePlanVsActual(trade, {
    accounts: [{ id: "acct-300", r_size_cents: 30_000 }],
    prefs: { riskBudgetUsd: 250 },
  });
  const result = comparison.rows.find((row) => row.label === "Result (R)");
  assert.equal(result?.actual, "+0.25R");
  assert.equal(result?.deltaDisplay, "−0.08R");
});
