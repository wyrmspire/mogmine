import test from "node:test";
import assert from "node:assert/strict";
import { formatRiskLine } from "../risk-line.ts";
import type { ResolvedRSize } from "../r-size.ts";
import { addAccount, getAccountsState, resetAccountsForTests, updateAccount } from "../accounts-store.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

// 04 §1 golden trades on MES ($1.25 per tick, 0.25 tick). Entry 7137 for all three.
const tradeA = normalizeTrade({
  id: "trade-a", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-23T13:35:00Z", exit_time: "2026-11-23T14:10:00Z",
  entry_price: 7137, exit_price: 7160, stop_loss_price: 7119.5, stated_risk_r: 0.25,
});
// Trade B: 15 pt stop = $75 = 0.25R of $300, stated 0.25R (no redundant "you said").
const tradeB = normalizeTrade({
  id: "trade-b", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-23T15:00:00Z", exit_time: "2026-11-23T15:20:00Z",
  entry_price: 7137, exit_price: 7130, stop_loss_price: 7122, stated_risk_r: 0.25,
});
const tradeNoStop = normalizeTrade({
  id: "trade-x", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-23T16:00:00Z", exit_time: "2026-11-23T16:10:00Z",
  entry_price: 7137, exit_price: 7140, stop_loss_price: null,
});
const tradeNoStopStated = normalizeTrade({
  id: "trade-y", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-23T16:00:00Z", exit_time: "2026-11-23T16:10:00Z",
  entry_price: 7137, exit_price: 7140, stop_loss_price: null, stated_risk_r: 0.5,
});

const account300: ResolvedRSize = { cents: 30_000, source: "account", account_id: "acct-1" };
const prefs300: ResolvedRSize = { cents: 30_000, source: "prefs", account_id: null };
// Trade C: 12 pt stop = $60 = 0.20R of $300, stated 0.25R ($75) — under-sized, so stated truly differs.
const tradeC = normalizeTrade({
  id: "trade-c", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-23T15:30:00Z", exit_time: "2026-11-23T15:45:00Z",
  entry_price: 7137, exit_price: 7129, stop_loss_price: 7125, stated_risk_r: 0.25,
});

test("formatRiskLine: Trade A (<1 micro ceiling overshoot) omits mismatch; Trade C (under-sized) shows stated R", () => {
  const a = formatRiskLine(tradeA as TradeRecord, account300, "SIM Eval 50K", false);
  assert.equal(a.primary, "Risk $87.50 · 0.29R of $300");
  assert.equal(a.sourceHint, "R size from SIM Eval 50K");
  const c = formatRiskLine(tradeC as TradeRecord, account300, "SIM Eval 50K", false);
  assert.equal(c.primary, "Risk $60 · 0.20R of $300 · you said 0.25R ($75)");
});

test("formatRiskLine: Trade B at $300 omits the redundant 'you said' suffix when stated matches actual", () => {
  const { primary } = formatRiskLine(tradeB as TradeRecord, account300, "SIM Eval 50K", false);
  assert.equal(primary, "Risk $75 · 0.25R of $300");
});

test("formatRiskLine: Shield strips every dollar amount and keeps the R values", () => {
  const { primary, sourceHint } = formatRiskLine(tradeC as TradeRecord, account300, "SIM Eval 50K", true);
  assert.equal(primary, "Risk 0.20R · you said 0.25R");
  assert.ok(!/\$/.test(primary));
  assert.ok(!/300|250|60|75/.test(primary));
  assert.ok(!/\$/.test(sourceHint ?? ""));
});

test("formatRiskLine: an account without its own R size names the default and its amount", () => {
  const { primary, sourceHint } = formatRiskLine(tradeC as TradeRecord, prefs300, null, false);
  // Stated R is priced in the trade's own R size: 0.25 × $300 = $75.
  assert.equal(primary, "Risk $60 · 0.20R of default $300 · you said 0.25R ($75)");
  assert.equal(sourceHint, "No account on this trade · using your default");
});

test("formatRiskLine: Shield with the default R size has no dollar sign in either string", () => {
  const { primary, sourceHint } = formatRiskLine(tradeA as TradeRecord, prefs300, "Proton", true);
  assert.ok(!/\$/.test(primary));
  assert.ok(!/\$/.test(sourceHint ?? ""));
  assert.equal(sourceHint, "Proton has no R size yet");
});

test("formatRiskLine: a trade with no stop and no stated risk says so", () => {
  const { primary } = formatRiskLine(tradeNoStop as TradeRecord, account300, null, false);
  assert.equal(primary, "No stop recorded");
});

test("formatRiskLine: a trade with no stop but a stated risk shows the stated risk, never a stop-width risk", () => {
  const { primary } = formatRiskLine(tradeNoStopStated as TradeRecord, account300, null, false);
  assert.equal(primary, "No stop · you said 0.5R ($150)");
  const shielded = formatRiskLine(tradeNoStopStated as TradeRecord, account300, null, true);
  assert.equal(shielded.primary, "No stop · you said 0.5R");
});

test("accounts-store: addAccount and updateAccount persist r_size_cents, and null clears it", () => {
  resetAccountsForTests({ hydrated: true });
  const account = addAccount({ name: "SIM Eval 50K", starting_balance_cents: 5_000_000, r_size_cents: 30_000 }, "2026-11-24T12:00:00.000Z");
  assert.equal(account.r_size_cents, 30_000);
  assert.equal(getAccountsState().accounts[0].r_size_cents, 30_000);

  updateAccount(account.id, { r_size_cents: null });
  assert.equal(getAccountsState().accounts[0].r_size_cents, null);

  updateAccount(account.id, { r_size_cents: 45_000 });
  assert.equal(getAccountsState().accounts[0].r_size_cents, 45_000);

  // A value outside $1 to $100,000 is not stored.
  updateAccount(account.id, { r_size_cents: 50 });
  assert.equal(getAccountsState().accounts[0].r_size_cents, null);
  resetAccountsForTests();
});
