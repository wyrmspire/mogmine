import assert from "node:assert/strict";
import { test } from "node:test";
import { initialRiskUsd, isScratch, normalizeTrade, plannedR, rMultiple, riskStopPrice } from "../trades.ts";
import { rStripCaption, rStripInputFromTrade, rStripLayout, stripStop } from "../rstrip.ts";
import { stopHistoryText } from "../risk-text.ts";
import { describeTrade } from "../describe.ts";

// sim-trade-20261119-a: short 7405, 2 lots, initial stop 7444, trailed to 7350, out at 7360.
const thursday = normalizeTrade({
  id: "sim-19-a", symbol: "MES", direction: "SHORT", quantity: 2,
  entry_time: "2026-11-19T15:50:00Z", exit_time: "2026-11-19T17:10:00Z",
  entry_price: 7405, exit_price: 7360, stop_loss_price: 7350, initial_stop_price: 7444,
  initial_stop_set_at: "2026-11-19T15:50:00Z", planned_target_price: 7300,
});
const time = (iso: string) => iso.slice(11, 16);

test("a stop trailed past the entry never blanks R: R is measured on the initial stop", () => {
  assert.equal(riskStopPrice(thursday), 7444);
  assert.equal(rMultiple(thursday), 180 / 156); // 45 pts captured on 39 pts of first risk
  assert.equal(initialRiskUsd(thursday), 390); // 156 ticks × 2 lots × $1.25
  assert.equal(plannedR(thursday), 420 / 156);
});

test("the long mirror: stop trailed above the entry", () => {
  const long = { ...thursday, direction: "LONG" as const, entry_price: 7300, exit_price: 7340, stop_loss_price: 7320, initial_stop_price: 7280, planned_target_price: 7360 };
  assert.equal(riskStopPrice(long), 7280);
  assert.equal(rMultiple(long), 2);
  assert.equal(plannedR(long), 3);
});

test("without an initial stop, a risk-side current stop still sets R; a trailed one leaves R unknown", () => {
  assert.equal(rMultiple({ ...thursday, initial_stop_price: null, stop_loss_price: 7425 }), 180 / 80);
  const unknown = { ...thursday, initial_stop_price: null };
  assert.equal(rMultiple(unknown), null);
  assert.equal(stopHistoryText(unknown, time),
    "Stop 7350.00 is not on the risk side of the entry and no initial stop is recorded, so R is not known.");
  assert.match(describeTrade(unknown, "America/Chicago"), /stop not usable for R/);
});

test("an initial stop on the wrong side (a typo) falls back to the current risk-side stop", () => {
  assert.equal(riskStopPrice({ ...thursday, initial_stop_price: 7380, stop_loss_price: 7425 }), 7425);
});

test("a widened stop keeps R on the first risk, and the panel says it was widened", () => {
  const widened = { ...thursday, stop_loss_price: 7460, exit_price: 7460 };
  assert.equal(rMultiple(widened), -220 / 156);
  assert.equal(stopHistoryText(widened, time), "Initial stop 7444.00, set 15:50 · stop widened to 7460.00");
});

test("the panel shows the trailed stop beside R, with or without a set time", () => {
  assert.equal(stopHistoryText(thursday, time), "Initial stop 7444.00, set 15:50 · stop trailed to 7350.00");
  assert.equal(stopHistoryText({ ...thursday, initial_stop_set_at: null }, time), "Initial stop 7444.00 · stop trailed to 7350.00");
  assert.equal(stopHistoryText({ ...thursday, stop_loss_price: 7444 }, time), null);
});

test("scratch threshold uses the first risk too", () => {
  // 0.1R of 156 ticks = 15.6 ticks: an exit 3.5 pts (14 ticks) from entry is a scratch.
  assert.equal(isScratch({ ...thursday, exit_price: 7401.5 }), true);
});

test("the R strip's 1R axis is the initial stop, not the trailed one", () => {
  assert.equal(stripStop(thursday), 7444);
  const layout = rStripLayout(rStripInputFromTrade(thursday))!;
  assert.equal(rStripCaption(thursday, layout), "Cut early, exit 1.2R, plan 2.7R");
  assert.equal(stripStop({ ...thursday, initial_stop_price: null }), null);
});
