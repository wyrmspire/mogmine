import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateExitEfficiency } from "../exit-efficiency.ts";
import { derivePlanVsActual, stopOutcome } from "../plan-vs-actual.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

// 10-pt risk, 20-pt target (a 2R plan), both sides.
const trade = (direction: "LONG" | "SHORT", exit: number, over: Partial<TradeRecord> = {}) => {
  const s = direction === "LONG" ? 1 : -1;
  return normalizeTrade({
    id: `t-${direction}-${exit}`, symbol: "MES", direction, quantity: 1,
    entry_time: "2026-11-18T15:00:00Z", exit_time: "2026-11-18T15:30:00Z",
    entry_price: 7350, exit_price: exit, initial_stop_price: 7350 - 10 * s, stop_loss_price: 7350 - 10 * s,
    planned_target_price: 7350 + 20 * s, ...over,
  });
};

for (const direction of ["LONG", "SHORT"] as const) {
  const s = direction === "LONG" ? 1 : -1;

  test(`${direction}: a plain stop-out has no efficiency and is "Stopped Out", not "Premature Exit"`, () => {
    // sim 18-c: −1R at the stop after about +0.18R of MFE used to read −550 %.
    const stopped = trade(direction, 7350 - 10 * s);
    const eff = calculateExitEfficiency(stopped, 1.75)!;
    assert.equal(eff.efficiencyPercent, null);
    assert.equal(eff.efficiencyRatio, null);
    assert.equal(eff.summary, "closed at −1.0R; best was +0.2R");
    const pva = derivePlanVsActual(stopped);
    assert.equal(pva.fidelity, "Stopped Out");
    assert.equal(stopOutcome(stopped), "stop");
    // The exit is compared with the stop it hit, not the target it never reached (no "−3.0R" delta).
    const exitRow = pva.rows.find((row) => row.label === "Exit / Stop")!;
    assert.equal(exitRow.deltaDisplay, "—");
    assert.equal(pva.rows.some((row) => row.label === "Exit / Target"), false);
    const result = pva.rows.find((row) => row.label === "Result (R)")!;
    assert.equal(result.planned, "+2.0R at target");
    assert.equal(result.actual, "−1.0R");
  });

  test(`${direction}: slippage through the stop is shown on the stop row`, () => {
    const slipped = trade(direction, 7350 - 11 * s);
    const exitRow = derivePlanVsActual(slipped).rows.find((row) => row.label === "Exit / Stop")!;
    assert.equal(exitRow.tone, "negative");
    assert.equal(exitRow.deltaR, -0.1);
  });

  test(`${direction}: a winner's efficiency is the share of MFE kept, clamped to 100 %`, () => {
    const win = trade(direction, 7350 + 8 * s);
    const eff = calculateExitEfficiency(win, 14)!;
    assert.equal(eff.efficiencyPercent, 57);
    assert.equal(eff.summary, "captured +0.8R of +1.4R available (57%)");
    // MFE estimated a tick under the fill: never over 100 %.
    assert.equal(calculateExitEfficiency(win, 7.75)!.efficiencyPercent, 100);
    assert.equal(derivePlanVsActual(win).fidelity, "Premature Exit");
  });

  test(`${direction}: a scratch has no efficiency and says so`, () => {
    const scratch = trade(direction, 7350 + 0.25 * s);
    const eff = calculateExitEfficiency(scratch, 6)!;
    assert.equal(eff.efficiencyPercent, null);
    assert.match(eff.summary, /^scratched at/);
    assert.equal(derivePlanVsActual(scratch).fidelity, "Scratch");
  });

  test(`${direction}: an exit on a stop trailed past the entry is "Trailed Stop Hit" with R on the first risk`, () => {
    const trailed = trade(direction, 7350 + 6 * s, { stop_loss_price: 7350 + 6 * s });
    assert.equal(stopOutcome(trailed), "trail");
    const pva = derivePlanVsActual(trailed);
    assert.equal(pva.fidelity, "Trailed Stop Hit");
    assert.equal(pva.fidelityNote, `Exited on the moved stop at ${(7350 + 6 * s).toFixed(2)}, +0.6R.`);
    const eff = calculateExitEfficiency(trailed, 15)!;
    assert.equal(eff.efficiencyPercent, 40);
    assert.equal(eff.realizedR, 0.6);
  });

  test(`${direction}: an MFE under 2 ticks is noise, not an opportunity`, () => {
    assert.equal(calculateExitEfficiency(trade(direction, 7350 + 0.25 * s), 0.25)!.efficiencyPercent, null);
  });
}

test("the trader's exit reason wins over prices", () => {
  assert.equal(stopOutcome(trade("LONG", 7342, { exit_reason: "stop" })), "stop");
  assert.equal(stopOutcome(trade("LONG", 7340, { exit_reason: "manual" })), null);
});

test("a widened stop that was hit is still flagged as widened", () => {
  const widened = trade("SHORT", 7365, { stop_loss_price: 7365, stop_moves: undefined });
  assert.equal(derivePlanVsActual(widened).fidelity, "Widened Stop");
});
