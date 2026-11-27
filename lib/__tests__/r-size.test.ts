import test from "node:test";
import assert from "node:assert/strict";
import { createJournalCommands } from "../commands/journal-commands.ts";
import type { CollectionRepository, JournalRepositories, Stored } from "../persistence/contract.ts";
import { makeAccount } from "../accounts.ts";
import type { TradingAccount } from "../accounts.ts";
import {
  DEFAULT_R_SIZE_CENTS, isValidRSizeCents, isValidStatedRiskR, resolveRSize, resultR, riskCents, riskComparison, riskR, sizeContractsAtLeast,
} from "../r-size.ts";
import { keepFrozenRSize, normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { addTrade, getTrade, replaceTrades, resetJournalForTests } from "../store.ts";
import { resetAccountsForTests } from "../accounts-store.ts";

// Golden table (docs/design-2026-11-24/04 §1): SIM Eval 50K at $300 per R, 1 MES ($5 per point).
const R_300 = 30_000;
const ENTRY = 7600;
const closed = (over: Record<string, unknown> = {}) => normalizeTrade({
  id: "t", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-20T15:00:00Z", exit_time: "2026-11-20T15:30:00Z",
  entry_price: ENTRY, exit_price: ENTRY, stop_loss_price: null, initial_stop_price: null,
  ...over,
} as Parameters<typeof normalizeTrade>[0]);

// A: 17.5 pt stop, +123 pt (+$615), stated 0.25R.
const TRADE_A = closed({ id: "A", stop_loss_price: 7582.5, initial_stop_price: 7582.5, initial_stop_set_at: "2026-11-20T14:59:00Z", exit_price: 7723, stated_risk_r: 0.25 });
// B: 15 pt stop, −15 pt (−$75), stated 0.25R.
const TRADE_B = closed({ id: "B", stop_loss_price: 7585, initial_stop_price: 7585, initial_stop_set_at: "2026-11-20T14:59:00Z", exit_price: 7585, stated_risk_r: 0.25 });
// C: 12 pt stop, −8 pt (−$40), stated 0.25R.
const TRADE_C = closed({ id: "C", stop_loss_price: 7588, initial_stop_price: 7588, initial_stop_set_at: "2026-11-20T14:59:00Z", exit_price: 7592, stated_risk_r: 0.25 });

test("golden A/B/C at $300 (04 §1): risk cents, risk R, result R and stated-vs-actual", () => {
  assert.equal(riskCents(TRADE_A), 8750);
  assert.equal(riskCents(TRADE_B), 7500);
  assert.equal(riskCents(TRADE_C), 6000);

  assert.ok(Math.abs((riskR(TRADE_A, R_300) ?? NaN) - 0.2917) < 0.0001, "A risk is 0.29R");
  assert.equal(riskR(TRADE_B, R_300), 0.25);
  assert.equal(riskR(TRADE_C, R_300), 0.2);

  assert.equal(resultR(TRADE_A, R_300), 2.05);
  assert.equal(resultR(TRADE_B, R_300), -0.25);
  assert.ok(Math.abs((resultR(TRADE_C, R_300) ?? NaN) + 0.1333) < 0.0001, "C result is -0.13R");

  // A is 1 MES at $87.50 vs $75 stated (0.25R): overshoot $12.50 < $87.50 (1 micro), valid under the at-least ceiling rule.
  assert.equal(riskComparison(TRADE_A, R_300).differs, false);
  assert.equal(riskComparison(TRADE_B, R_300).differs, false);
  // C is under-sized ($60 vs $75), and 2 micros on A ($175 vs $75) overshoots by >= 1 full micro — both differ.
  assert.equal(riskComparison(TRADE_C, R_300).differs, true);
  assert.equal(riskComparison({ ...TRADE_A, quantity: 2 }, R_300).differs, true);
  assert.equal(riskComparison(TRADE_B, R_300).stated_r, 0.25, "stated risk is kept as typed, never replaced by stop math");
  // Ceiling micro sizing: $300 at-least target with a 22-pt MES stop ($110/micro = 88 ticks): 2 micros = $220 -> add 1 micro -> 3 ($330).
  assert.deepEqual(sizeContractsAtLeast(30_000, 88, "MES"), { contracts: 3, actualRiskCents: 33_000, overshootCents: 3_000 });
  assert.deepEqual(sizeContractsAtLeast(30_000, 60, "MES"), { contracts: 4, actualRiskCents: 30_000, overshootCents: 0 });
});

test("the R size resolves trade → account → prefs, and a frozen trade ignores a later account change", () => {
  const accounts = [{ id: "acct", r_size_cents: 50_000 }];
  const onAccount = { account_id: "acct" };
  assert.deepEqual(resolveRSize({ ...onAccount, r_size_cents: 30_000 }, accounts, { riskBudgetUsd: 300 }), { cents: 30_000, source: "trade", account_id: "acct" });
  assert.deepEqual(resolveRSize({ ...onAccount, r_size_cents: null }, accounts, { riskBudgetUsd: 300 }), { cents: 50_000, source: "account", account_id: "acct" });
  // No R size on the account: the default budget, labelled with its source (Q-12).
  assert.deepEqual(resolveRSize({ account_id: "bare" }, [{ id: "bare", r_size_cents: null }], { riskBudgetUsd: 400 }), { cents: 40_000, source: "prefs", account_id: "bare" });
  // Unassigned trades and missing prefs fall back to the $300 default.
  assert.deepEqual(resolveRSize({ account_id: null }, accounts), { cents: DEFAULT_R_SIZE_CENTS, source: "prefs", account_id: null });
  assert.equal(resolveRSize({ account_id: null }, [], null).cents, 30_000);

  // A trade frozen at $300 keeps $300 when its account moves to $500.
  const frozen = closed({ id: "F", account_id: "acct", r_size_cents: 30_000, exit_price: 7602 });
  assert.equal(resolveRSize(frozen, accounts).cents, 30_000);
  assert.equal(resolveRSize(frozen, accounts).source, "trade");
});

test("no stop: result R is defined, risk R is null, never 0 (AGENTS §3b-4 as reworded by D-A)", () => {
  const noStop = closed({ id: "N", exit_price: 7602.25 }); // +$11.25
  assert.equal(riskCents(noStop), null);
  assert.equal(riskR(noStop, R_300), null);
  assert.equal(resultR(noStop, R_300), 0.0375);
  assert.notEqual(riskR(noStop, R_300), 0);
});

test("a stated risk stands in for risk R when there is no stop; the comparison has no actual side", () => {
  const stated = closed({ id: "S", stated_risk_r: 0.5 });
  assert.equal(riskR(stated, R_300), 0.5);
  assert.deepEqual(riskComparison(stated, R_300), { actual_r: null, stated_r: 0.5, differs: false });
});

test("an open trade has no result R, but its risk is still computed", () => {
  const open = normalizeTrade({
    id: "O", symbol: "MES", direction: "LONG", quantity: 1, status: "open",
    entry_time: "2026-11-20T15:00:00Z", exit_time: null, entry_price: ENTRY, exit_price: null,
    stop_loss_price: 7582.5, initial_stop_price: 7582.5, initial_stop_set_at: "2026-11-20T14:59:00Z",
  });
  assert.equal(resultR(open, R_300), null);
  assert.equal(riskCents(open), 8750);
});

test("normalizeTrade recomputes risk_cents whenever entry, initial stop or quantity changes", () => {
  assert.equal(TRADE_A.risk_cents, 8750);
  assert.equal(normalizeTrade({ ...TRADE_A, quantity: 2 }).risk_cents, 17_500);
  assert.equal(normalizeTrade({ ...TRADE_A, initial_stop_price: 7585, stop_loss_price: 7585 }).risk_cents, 7500);
  // Entry 7601 against the 7582.50 stop is 18.5 pt = 74 ticks × $1.25 = 9250 cents.
  assert.equal(normalizeTrade({ ...TRADE_A, entry_price: 7601 }).risk_cents, 9250);
  // A stored risk_cents that disagrees is overwritten, never trusted.
  assert.equal(normalizeTrade({ ...TRADE_A, risk_cents: 1 } as TradeRecord).risk_cents, 8750);
});

test("normalizeTrade keeps a valid stated risk to two decimals and drops invalid R sizes", () => {
  assert.equal(normalizeTrade({ ...TRADE_A, stated_risk_r: 0.254 } as TradeRecord).stated_risk_r, null);
  assert.equal(normalizeTrade({ ...TRADE_A, stated_risk_r: 0.25 } as TradeRecord).stated_risk_r, 0.25);
  assert.equal(normalizeTrade({ ...TRADE_A, r_size_cents: 12.5 } as TradeRecord).r_size_cents, null);
  assert.equal(normalizeTrade({ ...TRADE_A, r_size_cents: 30_000 } as TradeRecord).r_size_cents, 30_000);
});

test("validators: whole cents from $1 to $100,000; stated risk above 0, at most 10, two decimals", () => {
  assert.equal(isValidRSizeCents(100), true);
  assert.equal(isValidRSizeCents(10_000_000), true);
  for (const value of [0, 99, 10_000_001, 25_000.5, Number.NaN, "30000", null]) assert.equal(isValidRSizeCents(value), false, String(value));
  assert.equal(isValidStatedRiskR(0.01), true);
  assert.equal(isValidStatedRiskR(10), true);
  for (const value of [0, -0.25, 10.5, 0.125, Number.NaN, Number.POSITIVE_INFINITY, "0.25"]) assert.equal(isValidStatedRiskR(value), false, String(value));
});

// ---- Command layer (createJournalCommands) ----

let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 24, 12, 0, clock++)).toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const missing = { ok: false as const, error: { code: "not_found" as const, message: "Not found." } };

function memoryCollection<T extends { id: string }>(): CollectionRepository<T> {
  const rows = new Map<string, Stored<T>>();
  const keyOf = (owner: string, id: string) => `${owner}\u0000${id}`;
  return {
    async list(owner) {
      return { ok: true, value: [...rows.values()].filter((row) => row.meta.user_id === owner).map((row) => clone(row.record)) };
    },
    async get(owner, id) {
      const row = rows.get(keyOf(owner, id));
      return row ? { ok: true, value: clone(row) } : missing;
    },
    async put(owner, record, options) {
      const key = keyOf(owner, record.id);
      const existing = rows.get(key);
      if (options?.expectedUpdatedAt !== undefined && existing?.meta.updated_at !== options.expectedUpdatedAt) {
        return { ok: false, error: { code: "conflict", message: "Changed since you read it." } };
      }
      const at = stamp();
      const stored: Stored<T> = { record: clone(record), meta: { user_id: owner, created_at: existing?.meta.created_at ?? at, updated_at: at } };
      rows.set(key, stored);
      return { ok: true, value: clone(stored) };
    },
    async remove(owner, id) {
      return rows.delete(keyOf(owner, id)) ? { ok: true, value: undefined } : missing;
    },
    async replaceAll() {
      rows.clear();
      return { ok: true, value: undefined };
    },
  };
}

function memorySingleton<T>() {
  const rows = new Map<string, Stored<T>>();
  return {
    async get(owner: string) {
      const row = rows.get(owner);
      return { ok: true as const, value: row ? clone(row) : null };
    },
    async put(owner: string, value: T) {
      const existing = rows.get(owner);
      const at = stamp();
      const stored: Stored<T> = { record: clone(value), meta: { user_id: owner, created_at: existing?.meta.created_at ?? at, updated_at: at } };
      rows.set(owner, stored);
      return { ok: true as const, value: clone(stored) };
    },
  };
}

function memoryRepos() {
  const repos = {
    trades: memoryCollection(), mood_records: memoryCollection(), mood_candidates: memoryCollection(), accounts: memoryCollection(),
    balance_checks: memoryCollection(), challenges: memoryCollection(), playbooks: memoryCollection(), plans: memoryCollection(),
    drills: memoryCollection(), calls: memoryCollection(), prompt_dismissals: memoryCollection(),
    prefs: memorySingleton(), mood_registry: memorySingleton(), prompt_library: memorySingleton(),
    candles: { async get() { return { ok: true as const, value: null }; }, async put() { return { ok: true as const, value: undefined }; } },
  };
  return repos as unknown as JournalRepositories;
}

const trade = (over: Record<string, unknown> = {}) => ({
  id: "t-1", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-20T15:00:00Z", exit_time: "2026-11-20T15:30:00Z",
  entry_price: ENTRY, exit_price: 7602.25, stop_loss_price: 7598.25,
  ...over,
});

const account = (id: string, rSize: number | null): TradingAccount =>
  makeAccount({ id, name: id, starting_balance_cents: 5_000_000, now: "2026-11-01T00:00:00Z", r_size_cents: rSize });

async function assertRejected(promise: Promise<{ ok: boolean; error?: { code: string; message: string } }>, code: string, pattern: RegExp) {
  const result = await promise;
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(result.error.code, code);
  assert.match(result.error.message, pattern);
}

test("create refuses a client risk_cents that disagrees with the computed value, and accepts one that matches", async () => {
  const commands = createJournalCommands(memoryRepos());
  // The default trade's stop is 1.75 pt (7 ticks) from entry: 7 × $1.25 = 875 cents.
  await assertRejected(commands.create("trades", trade({ risk_cents: 9999 })), "invalid", /did not match/);
  await assertRejected(commands.create("trades", trade({ risk_cents: null })), "invalid", /did not match/);
  const ok = await commands.create("trades", trade({ risk_cents: 875 }));
  assert.equal(ok.ok && ok.value.record.risk_cents, 875);
});

test("create refuses an out-of-range stated risk R and a fractional or out-of-range R size", async () => {
  const commands = createJournalCommands(memoryRepos());
  for (const stated_risk_r of [0, -0.25, 10.5, 0.125]) {
    await assertRejected(commands.create("trades", trade({ stated_risk_r })), "invalid", /Stated risk R/);
  }
  for (const r_size_cents of [0, 99, 25_000.5, 10_000_001]) {
    await assertRejected(commands.create("trades", trade({ r_size_cents })), "invalid", /Trade R size/);
  }
  // makeAccount would drop a bad size to null, so the raw record goes straight to the command layer.
  await assertRejected(commands.create("accounts", { ...account("bad", null), r_size_cents: 12.5 }), "invalid", /Account R size/);
  const listed = await commands.list("trades");
  assert.equal(listed.ok && listed.value.length, 0, "nothing was written");
  const stated = await commands.create("trades", trade({ stated_risk_r: 0.25 }));
  assert.equal(stated.ok && stated.value.record.stated_risk_r, 0.25);
});

test("create freezes the R size from the trade's account, and an update re-freezes only when the account changes", async () => {
  const repos = memoryRepos();
  const commands = createJournalCommands(repos);
  await commands.create("accounts", account("acct-a", 30_000));
  await commands.create("accounts", account("acct-b", 50_000));

  const created = await commands.create("trades", trade({ account_id: "acct-a" }));
  assert.equal(created.ok && created.value.record.r_size_cents, 30_000);

  // The account's R size changes later: the trade keeps its frozen $300 (D-B).
  await commands.update("accounts", "acct-a", { r_size_cents: 40_000 });
  let accountReads = 0;
  const listAccounts = repos.accounts.list.bind(repos.accounts);
  repos.accounts.list = async (...args) => {
    accountReads += 1;
    return listAccounts(...args);
  };
  const note = await commands.update("trades", "t-1", { note: "still $300" });
  assert.equal(note.ok && note.value.record.r_size_cents, 30_000);
  assert.equal(accountReads, 0, "an unrelated edit does not depend on account or prefs reads");

  // Moving the trade to another account re-freezes from that account.
  const moved = await commands.update("trades", "t-1", { account_id: "acct-b" });
  assert.equal(moved.ok && moved.value.record.r_size_cents, 50_000);
  assert.equal(accountReads, 1);
});

test("an unassigned trade freezes the default R size from prefs", async () => {
  const commands = createJournalCommands(memoryRepos());
  await commands.writeSingleton("prefs", { riskBudgetUsd: 400 });
  const created = await commands.create("trades", trade({ account_id: null }));
  assert.equal(created.ok && created.value.record.r_size_cents, 40_000);
});

test("updating quantity recomputes risk_cents, and a stale risk_cents in the patch is refused", async () => {
  const commands = createJournalCommands(memoryRepos());
  await commands.create("trades", trade({ risk_cents: 875 }));
  const doubled = await commands.update("trades", "t-1", { quantity: 2 });
  assert.equal(doubled.ok && doubled.value.record.risk_cents, 1750);
  await assertRejected(commands.update("trades", "t-1", { quantity: 3, risk_cents: 875 }), "invalid", /did not match/);
});

test("replaceTrades keeps the R size this device froze when the backup row has none", () => {
  resetJournalForTests();
  addTrade(closed({ id: "store-1", r_size_cents: R_300 }));
  replaceTrades([closed({ id: "store-1", r_size_cents: null })]);
  assert.equal(getTrade("store-1")?.r_size_cents, R_300);
  assert.equal(keepFrozenRSize(closed({ id: "store-1", r_size_cents: null }), { id: "store-1", r_size_cents: R_300 }).r_size_cents, R_300);
  assert.equal(keepFrozenRSize(closed({ id: "store-1", r_size_cents: 45_000 }), { id: "store-1", r_size_cents: R_300 }).r_size_cents, 45_000);
  assert.equal(keepFrozenRSize(closed({ id: "other", r_size_cents: null }), { id: "store-1", r_size_cents: R_300 }).r_size_cents, null);
  resetJournalForTests();
});

test("addTrade freezes the R size from the account when the trade has none", () => {
  resetJournalForTests();
  resetAccountsForTests({ accounts: [account("acct-s", 35_000)] });
  addTrade(closed({ id: "store-2", account_id: "acct-s" }));
  assert.equal(getTrade("store-2")?.r_size_cents, 35_000);
  resetAccountsForTests();
  resetJournalForTests();
});
