// UX-e (#15): Shield quantity data integrity and position economics
import assert from "node:assert/strict";
import { test } from "node:test";
import { initialRiskUsd, normalizeTrade, tradePnl, tradeTicks, validateTradeInput } from "../trades.ts";

test("UX-e: multi-contract entry under Shield preserves validated size and true dollar P&L", () => {
  // 3-lot MES trade: entry 6840.00, exit 6850.00 (10 points gain), stop 6835.00 (5 points risk)
  // MES is $5 / point ($1.25 / tick). For 3 contracts:
  // Risk = 5 pts * $5 * 3 = $75.
  // PnL = 10 pts * $5 * 3 = $150.
  const rawTrade = {
    symbol: "MES",
    direction: "LONG" as const,
    quantity: 3,
    entry_price: 6840.00,
    exit_price: 6850.00,
    stop_loss_price: 6835.00,
    planned_target_price: 6860.00,
    key_level_price: null,
  };

  const validation = validateTradeInput(rawTrade);
  assert.equal(validation.quantity, undefined, "quantity 3 is valid");

  const trade = normalizeTrade({
    id: "shield-trade-3lot",
    entry_time: "2026-11-20T14:30:00.000Z",
    exit_time: "2026-11-20T15:00:00.000Z",
    ...rawTrade,
  });

  assert.equal(trade.quantity, 3, "true quantity must be stored as 3");
  assert.equal(tradeTicks(trade), 40, "10 points is 40 ticks");
  assert.equal(tradePnl(trade), 150, "P&L must be $150 for 3 contracts, not $50");
  assert.equal(initialRiskUsd(trade), 75, "Risk must be $75 for 3 contracts, not $25");
});

test("UX-e: fractional or zero quantities fail validation under Shield", () => {
  const invalidZero = validateTradeInput({
    symbol: "MES",
    direction: "LONG" as const,
    quantity: 0,
    entry_price: 6840.00,
    exit_price: 6850.00,
    stop_loss_price: null,
    planned_target_price: null,
    key_level_price: null,
  });
  assert.equal(invalidZero.quantity, "Enter a whole number of contracts, 1 or more");

  const invalidFraction = validateTradeInput({
    symbol: "MES",
    direction: "LONG" as const,
    quantity: 1.5,
    entry_price: 6840.00,
    exit_price: 6850.00,
    stop_loss_price: null,
    planned_target_price: null,
    key_level_price: null,
  });
  assert.equal(invalidFraction.quantity, "Enter a whole number of contracts, 1 or more");
});
