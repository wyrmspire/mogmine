import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateExitEfficiency } from "../exit-efficiency.ts";
import { normalizeTrade } from "../trades.ts";

test("calculateExitEfficiency: calculates R-based efficiency for winning trade", () => {
  // Long MES entry 6840, stop 6835 (5 pt risk = 1R).
  // Exit at 6844 (+4 pts = +0.8R).
  // MFE was +7 pts (+1.4R).
  const trade = normalizeTrade({
    id: "eff-1",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:30:00Z",
    exit_time: "2026-11-20T15:00:00Z",
    entry_price: 6840,
    exit_price: 6844,
    stop_loss_price: 6835,
    planned_target_price: 6850,
    quantity: 1,
  });

  const eff = calculateExitEfficiency(trade, 7);
  assert.ok(eff);
  assert.equal(eff.realizedR, 0.8);
  assert.equal(eff.mfeR, 1.4);
  assert.equal(eff.efficiencyPercent, 57);
  assert.equal(eff.summary, "captured +0.8R of +1.4R available (57%)");
  assert.equal(eff.concise, "+0.8R of +1.4R");
});

test("calculateExitEfficiency: falls back to points when no stop loss exists", () => {
  const trade = normalizeTrade({
    id: "eff-nostop",
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

  const eff = calculateExitEfficiency(trade, 10);
  assert.ok(eff);
  assert.equal(eff.realizedR, null);
  assert.equal(eff.mfeR, null);
  assert.equal(eff.efficiencyPercent, 50);
  assert.equal(eff.summary, "captured +5.00 pts of +10.00 pts available (50%)");
});

test("calculateExitEfficiency: returns null for open trades or zero MFE", () => {
  const openTrade = normalizeTrade({
    id: "eff-open",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:30:00Z",
    exit_time: null,
    status: "open",
    entry_price: 6840,
    exit_price: null,
    stop_loss_price: 6835,
    quantity: 1,
  });

  assert.equal(calculateExitEfficiency(openTrade, 5), null);

  const zeroMfe = normalizeTrade({
    id: "eff-zero",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:30:00Z",
    exit_time: "2026-11-20T14:35:00Z",
    entry_price: 6840,
    exit_price: 6838,
    stop_loss_price: 6835,
    quantity: 1,
  });

  assert.equal(calculateExitEfficiency(zeroMfe, 0), null);
  assert.equal(calculateExitEfficiency(zeroMfe, null), null);
});
