// Accounts and running totals (docs/21). Drawdown cases are docs/17 §3's golden table, so the account card and
// Drawdown Defender agree by construction.
import assert from "node:assert/strict";
import { test } from "node:test";
import { accountSummary, dollarsToCents, defaultAccountId, makeAccount, pnlCents, sanitizeAccounts, sanitizeBalanceChecks } from "../accounts.ts";
import type { AccountRules, BalanceCheck, TradingAccount } from "../accounts.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const NOW = "2026-11-20T23:00:00.000Z"; // Friday evening, after the close

/** An MES long, 1 contract, closing for exactly `dollars` gross ($1.25 a tick). */
function tradeFor(id: string, dollars: number, exit: string, patch: Partial<TradeRecord> = {}): TradeRecord {
  const ticks = Math.round(dollars / 1.25);
  assert.equal(ticks * 1.25, dollars, `${dollars} is a whole number of MES ticks`);
  const exitMs = Date.parse(exit);
  return normalizeTrade({
    id,
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: new Date(exitMs - 5 * 60_000).toISOString(),
    exit_time: exit,
    entry_price: 6000,
    exit_price: 6000 + ticks * 0.25,
    account_id: "acct",
    ...patch,
  });
}

/** Trades one minute apart on Tuesday 2026-11-17, in the order given. */
function sequence(amounts: number[], start = "2026-11-17T15:00:00.000Z") {
  return amounts.map((amount, index) => tradeFor(`t${index + 1}`, amount, new Date(Date.parse(start) + index * 60_000).toISOString()));
}

function account(rules: Partial<AccountRules> = {}, start = 5_000_000): TradingAccount {
  return makeAccount({ id: "acct", name: "Topstep 50K", starting_balance_cents: start, now: "2026-11-16T00:00:00.000Z", rules });
}

const LIMIT_300 = { max_loss_cents: 30_000, drawdown: "trailing" as const };

test("an undated trade raises an issue and stays out of the account ledger (OD-47)", () => {
  const [dated, trade] = sequence([50, -300]);
  const undated = { ...trade, exit_time: "invalid-time" };
  const summary = accountSummary(account(LIMIT_300), [dated, undated], [], NOW);
  assert.equal(summary.closedTrades, 1);
  assert.equal(summary.realized_cents, 5_000);
  assert.equal(summary.limit?.breached_at, null);
  assert.deepEqual(summary.issues, [{ trade_id: trade.id, reason: "undated" }]);
});

test("pnlCents is exact integer cents, and null for an open trade", () => {
  assert.equal(pnlCents(tradeFor("a", 298.75, "2026-11-17T15:00:00.000Z")), 29_875);
  assert.equal(pnlCents(normalizeTrade({ id: "o", symbol: "MES", direction: "LONG", entry_time: NOW, exit_time: null, entry_price: 6000, exit_price: null, status: "open" })), null);
});

test("docs/17 golden 1: +200 +200 −100 −150 → balance +150, peak 400, $50 of room", () => {
  const summary = accountSummary(account(LIMIT_300), sequence([200, 200, -100, -150]), [], NOW);
  assert.equal(summary.balance_cents, 5_000_000 + 15_000);
  assert.equal(summary.peak_cents, 5_000_000 + 40_000);
  assert.equal(summary.drawdown_cents, 25_000);
  assert.equal(summary.max_drawdown_cents, 25_000);
  assert.equal(summary.limit?.room_cents, 5_000);
  assert.equal(summary.limit?.breached_at, null);
  assert.deepEqual(summary.curve.map((value) => value - 5_000_000), [0, 20_000, 40_000, 30_000, 15_000]);
});

test("docs/17 golden 2 and 6: touching the limit is a breach, and later gains never undo it", () => {
  const breached = accountSummary(account(LIMIT_300), sequence([200, 200, -100, -150, -50]), [], NOW);
  assert.deepEqual(breached.limit?.breached_at, { kind: "trade", id: "t5", at: "2026-11-17T15:04:00.000Z" });
  assert.equal(breached.limit?.room_cents, 0);
  const recovered = accountSummary(account(LIMIT_300), sequence([200, 200, -100, -150, -50, 1000]), [], NOW);
  assert.equal(recovered.limit?.breached_at?.id, "t5");
  assert.equal(recovered.max_drawdown_cents, 30_000);
});

test("docs/17 golden 3 and 4: the start counts as the peak", () => {
  const close = accountSummary(account(LIMIT_300), sequence([-100, -100, -98.75]), [], NOW);
  assert.equal(close.limit?.room_cents, 125);
  assert.equal(close.limit?.breached_at, null);
  const first = accountSummary(account(LIMIT_300), sequence([-300]), [], NOW);
  assert.equal(first.limit?.breached_at?.id, "t1");
});

test("docs/17 golden 5: a trailing floor moves up with the peak", () => {
  const summary = accountSummary(account(LIMIT_300), sequence([500, -298.75, 400, -298.75]), [], NOW);
  assert.equal(summary.peak_cents - 5_000_000, 60_125);
  assert.equal(summary.balance_cents - 5_000_000, 30_250);
  assert.equal(summary.limit?.room_cents, 125);
  assert.equal(summary.limit?.breached_at, null);
});

test("static limit: the floor stays at start − max loss", () => {
  const summary = accountSummary(account({ max_loss_cents: 30_000, drawdown: "static" }), sequence([500, -298.75, 400, -298.75]), [], NOW);
  assert.equal(summary.limit?.floor_cents, 5_000_000 - 30_000);
  assert.equal(summary.limit?.room_cents, 30_250 + 30_000);
});

test("end-of-session trailing: the high point moves only when a session ends", () => {
  // Tuesday: +500 then −400 (session ends at +100). Wednesday: −350.
  const trades = [
    tradeFor("a", 500, "2026-11-17T15:00:00.000Z"),
    tradeFor("b", -400, "2026-11-17T16:00:00.000Z"),
    tradeFor("c", -350, "2026-11-18T15:00:00.000Z"),
  ];
  const eod = accountSummary(account({ max_loss_cents: 30_000, drawdown: "trailing_eod" }), trades, [], NOW);
  // Intraday +500 never set the high: Tuesday closed at +100, so Wednesday's floor is 100 − 300 = −200.
  assert.equal(eod.peak_cents - 5_000_000, 10_000);
  assert.equal(eod.balance_cents - 5_000_000, -25_000);
  assert.equal(eod.limit?.breached_at?.id, "c");
  // The same trades with a per-trade trailing floor breach on Tuesday already (500 → 100 is a $400 drop).
  const intraday = accountSummary(account({ max_loss_cents: 30_000, drawdown: "trailing" }), trades, [], NOW);
  assert.equal(intraday.limit?.breached_at?.id, "b");
});

test("end-of-session trailing: the last session raises the high only once it is over", () => {
  const trades = [tradeFor("a", 500, "2026-11-20T15:00:00.000Z")];
  const rules = { max_loss_cents: 30_000, drawdown: "trailing_eod" as const };
  assert.equal(accountSummary(account(rules), trades, [], "2026-11-20T16:00:00.000Z").peak_cents, 5_000_000);
  assert.equal(accountSummary(account(rules), trades, [], NOW).peak_cents, 5_000_000 + 50_000);
});

test("a balance check records the difference as an adjustment and moves the total", () => {
  const trades = sequence([200, -100]);
  const check: BalanceCheck = { id: "k1", account_id: "acct", at: "2026-11-17T20:00:00.000Z", balance_cents: 5_000_000 + 9_380, note: "fees" };
  const later = tradeFor("t3", 50, "2026-11-18T15:00:00.000Z");
  const summary = accountSummary(account(), [...trades, later], [check], NOW);
  assert.equal(summary.realized_cents, 15_000);
  assert.equal(summary.adjustments_cents, -620);
  assert.equal(summary.balance_cents, 5_000_000 + 9_380 + 5_000);
  const row = summary.rows.find((item) => item.kind === "check");
  assert.equal(row?.delta_cents, -620);
});

test("a check at the same instant as a trade comes after it", () => {
  const trade = tradeFor("t1", 100, "2026-11-17T15:00:00.000Z");
  const check: BalanceCheck = { id: "k", account_id: "acct", at: "2026-11-17T15:00:00.000Z", balance_cents: 5_010_000, note: "" };
  const summary = accountSummary(account(), [trade], [check], NOW);
  assert.equal(summary.adjustments_cents, 0);
  assert.deepEqual(summary.rows.map((row) => row.kind), ["trade", "check"]);
});

test("only this account's real, closed, priced trades count; the rest are counted, never as $0", () => {
  const trades = [
    tradeFor("mine", 100, "2026-11-17T15:00:00.000Z"),
    tradeFor("other", 500, "2026-11-17T15:01:00.000Z", { account_id: "elsewhere" }),
    tradeFor("none", 500, "2026-11-17T15:02:00.000Z", { account_id: null }),
    tradeFor("sample", 500, "2026-11-17T15:03:00.000Z", { is_sample: true }),
    normalizeTrade({ id: "open", symbol: "MES", direction: "LONG", entry_time: "2026-11-17T15:04:00.000Z", exit_time: null, entry_price: 6000, exit_price: null, status: "open", account_id: "acct" }),
    tradeFor("odd", 100, "2026-11-17T15:05:00.000Z", { quantity: 1.5 }),
  ];
  const summary = accountSummary(account(), trades, [], NOW);
  assert.equal(summary.realized_cents, 10_000);
  assert.equal(summary.closedTrades, 1);
  assert.equal(summary.openTrades, 1);
  assert.deepEqual(summary.issues, [{ trade_id: "odd", reason: "unpriceable" }]);
});

test("order is by exit time then id, and trades land on the session they closed in", () => {
  const trades = [
    tradeFor("b", 100, "2026-11-17T15:00:00.000Z"),
    tradeFor("a", -50, "2026-11-17T15:00:00.000Z"),
    // 18:30 ET Tuesday belongs to Wednesday's session.
    tradeFor("c", 25, "2026-11-17T23:30:00.000Z"),
  ];
  const summary = accountSummary(account(), trades, [], NOW);
  assert.deepEqual(summary.rows.map((row) => (row.kind === "trade" ? row.trade_id : "")), ["a", "b", "c"]);
  assert.deepEqual(summary.rows.map((row) => row.session), ["2026-11-17", "2026-11-17", "2026-11-18"]);
  assert.equal(summary.sessions, 2);
});

test("daily loss limit and today's result", () => {
  const trades = [
    tradeFor("a", -150, "2026-11-17T15:00:00.000Z"),
    tradeFor("b", -100, "2026-11-17T16:00:00.000Z"),
    tradeFor("c", -100, "2026-11-20T15:00:00.000Z"),
    tradeFor("d", 25, "2026-11-20T16:00:00.000Z"),
  ];
  const summary = accountSummary(account({ daily_loss_cents: 25_000 }), trades, [], "2026-11-20T18:00:00.000Z");
  assert.deepEqual(summary.daily?.breached_sessions, ["2026-11-17"], "equal to the limit is a breach");
  assert.deepEqual(summary.today, { session: "2026-11-20", realized_cents: -7_500, trades: 2 });
  assert.equal(summary.daily?.today_room_cents, 17_500);
});

test("profit target: remaining amount and the first time it was reached", () => {
  const summary = accountSummary(account({ profit_target_cents: 30_000 }), sequence([200, 150, -100]), [], NOW);
  assert.equal(summary.target?.target_balance_cents, 5_030_000);
  assert.equal(summary.target?.reached_at, "2026-11-17T15:01:00.000Z");
  assert.equal(summary.target?.remaining_cents, 5_000);
});

test("no rules: no limit, no daily, no target", () => {
  const summary = accountSummary(account(), sequence([100]), [], NOW);
  assert.equal(summary.limit, null);
  assert.equal(summary.daily, null);
  assert.equal(summary.target, null);
});

test("dollarsToCents reads what a trader types", () => {
  assert.equal(dollarsToCents("50,000"), 5_000_000);
  assert.equal(dollarsToCents("$2,000.50"), 200_050);
  assert.equal(dollarsToCents("-12.5"), -1_250);
  assert.equal(dollarsToCents(""), null);
  assert.equal(dollarsToCents("abc"), null);
  assert.equal(dollarsToCents("1.234"), null);
});

test("defaultAccountId: the account used last, skipping archived ones", () => {
  const a = { ...account(), id: "a" };
  const b = { ...account(), id: "b" };
  const trades = [
    tradeFor("old", 100, "2026-11-16T15:00:00.000Z", { account_id: "a" }),
    tradeFor("new", 100, "2026-11-18T15:00:00.000Z", { account_id: "b" }),
  ];
  assert.equal(defaultAccountId([a, b], trades), "b");
  assert.equal(defaultAccountId([a, { ...b, archived: true }], trades), "a");
  assert.equal(defaultAccountId([], trades), null);
  assert.equal(defaultAccountId([a], []), "a");
});

test("normalizeTrade defaults account_id to null, so old records load unchanged", () => {
  const trade = normalizeTrade({ id: "x", symbol: "MES", direction: "LONG", entry_time: NOW, exit_time: NOW, entry_price: 6000, exit_price: 6001 });
  assert.equal(trade.account_id, null);
});

test("stored accounts and checks are sanitised; bad rows are dropped", () => {
  const good = account({ max_loss_cents: 200_000 });
  const accounts = sanitizeAccounts([good, { id: 1 }, null, { ...good, id: "b", rules: { drawdown: "weird", max_loss_cents: -5 } }]);
  assert.equal(accounts.length, 2);
  assert.equal(accounts[1].rules.drawdown, "trailing");
  assert.equal(accounts[1].rules.max_loss_cents, null);
  const checks = sanitizeBalanceChecks([{ id: "k", account_id: "acct", at: NOW, balance_cents: 1, note: 3 }, { id: "bad", account_id: "acct", at: "nope", balance_cents: 1 }]);
  assert.deepEqual(checks, [{ id: "k", account_id: "acct", at: NOW, balance_cents: 1, note: "" }]);
});

test("backups carry accounts and keep each trade's account", async () => {
  const { buildBackup, parseBackupFile } = await import("../store.ts");
  const trade = tradeFor("b1", 100, "2026-11-17T15:00:00.000Z");
  const check: BalanceCheck = { id: "k", account_id: "acct", at: NOW, balance_cents: 5_000_000, note: "" };
  const parsed = parseBackupFile(JSON.stringify(buildBackup([trade], undefined, undefined, { accounts: [account()], checks: [check] })));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.trades[0].account_id, "acct");
    assert.equal(parsed.accounts?.accounts[0].name, "Topstep 50K");
    assert.equal(parsed.accounts?.checks.length, 1);
  }
  const old = parseBackupFile(JSON.stringify(buildBackup([{ ...trade, account_id: null }])));
  assert.equal(old.ok && "accounts" in old, false);
  if (old.ok) assert.equal(old.trades[0].account_id, null);
});
