import test from "node:test";
import assert from "node:assert/strict";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { fromLegacy, deriveTrade, isTradeDocument } from "../trade-document.ts";
import { FUTURES_SPECS, normalizeTrade, riskMultiple, tradePnl, tradePoints } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { resultR } from "../r-size.ts";
import { partialsTradeMetrics, sanitizePartialExits, sanitizePartialTargets, validateTradePartials } from "../partials-record.ts";
import { buildBackup, parseBackupFile } from "../journal-backup.ts";
import type { CollectionRepository, JournalRepositories, Stored } from "../persistence/contract.ts";

// Fixture 7 (`ex-partials`): 2 MES LONG at 7600, initial stop 7595, T1 7605 and T2 7612.5, stop to BE after T1.
const T1 = { key: "t1", price: 7605, qty: 1 };
const T2 = { key: "t2", price: 7612.5, qty: 1 };
const EXIT_T1 = { time: "2026-11-12T15:42:00Z", price: 7605, qty: 1, reason: "target" };
const EXIT_T2 = { time: "2026-11-12T16:05:00Z", price: 7612.5, qty: 1, reason: "target" };

function fixtureSeven(over: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id: "ex-partials", symbol: "MES", direction: "LONG", quantity: 2, status: "closed",
    entry_time: "2026-11-12T15:34:00Z", exit_time: "2026-11-12T16:05:00Z", entry_price: 7600, exit_price: 7612.5,
    initial_stop_price: 7595, initial_stop_set_at: "2026-11-12T15:34:00Z", stop_loss_price: 7600,
    stop_moves: [{ price: 7600, time: "2026-11-12T15:42:00Z" }],
    partial_targets: [T1, T2], partial_exits: [EXIT_T1, EXIT_T2], r_size_cents: 30_000,
    ...over,
  } as Parameters<typeof normalizeTrade>[0]);
}

const openScaleOut = (): TradeRecord => normalizeTrade({
  id: "open-scale", symbol: "MES", direction: "LONG", quantity: 2, status: "open",
  entry_time: "2026-11-12T15:34:00Z", exit_time: null, entry_price: 7600, exit_price: null,
  initial_stop_price: 7595, initial_stop_set_at: "2026-11-12T15:34:00Z", stop_loss_price: 7595,
  partial_targets: [T1, T2], partial_exits: [EXIT_T1], r_size_cents: 30_000,
} as Parameters<typeof normalizeTrade>[0]);

test("fixture 7: +$87.50, +1.75 stop-width R, and exact account R at $300", () => {
  const trade = fixtureSeven();
  assert.equal(tradePnl(trade), 87.5);
  assert.equal(riskMultiple(trade), 1.75);
  assert.equal(resultR(trade, 30_000), 8_750 / 30_000);
  assert.equal(tradePoints(trade), 8.75);
});

test("fixture 7: the document has two planned targets, two exit fills and the deriver's +1.75 R", () => {
  const derived = deriveTrade(fromLegacy(fixtureSeven()), FUTURES_SPECS.MES);
  assert.equal(derived.status, "closed");
  assert.equal(derived.outcome, "partial_targets");
  assert.deepEqual(derived.planned_targets.map((t) => t.key), ["t1", "t2"]);
  assert.equal(derived.closed_lots.length, 2);
  assert.equal(derived.pnl_cents, 8_750);
  assert.equal(derived.r_multiple, 1.75);
});

test("fixture 7: the stop move to breakeven sits after the T1 fill and before the T2 fill", () => {
  const doc = fromLegacy(fixtureSeven());
  const order = doc.events.map((e) => (e.type === "fill" && e.role === "exit" ? `exit@${e.price}` : e.type));
  assert.deepEqual(order.slice(-3), ["exit@7605", "modify", "exit@7612.5"]);
});

test("open scale-out: one lot closed and one still open after fromLegacy and deriveTrade", () => {
  const derived = deriveTrade(fromLegacy(openScaleOut()), FUTURES_SPECS.MES);
  assert.equal(derived.status, "open");
  assert.equal(derived.open_qty, 1);
  assert.equal(derived.closed_lots.length, 1);
  assert.equal(partialsTradeMetrics(openScaleOut()), null);
  assert.equal(tradePnl(openScaleOut()), null);
});

test("sanitizers keep valid items, sort exits by time, and return undefined when none are valid", () => {
  const exits = sanitizePartialExits([EXIT_T2, { time: "bad", price: 1, qty: 1 }, EXIT_T1, { ...EXIT_T1, qty: 1.5 }], "MES");
  assert.deepEqual(exits?.map((e) => e.price), [7605, 7612.5]);
  assert.equal(sanitizePartialExits([], "MES"), undefined);
  assert.equal(sanitizePartialExits(undefined, "MES"), undefined);
  assert.deepEqual(sanitizePartialTargets([T1, { key: "", price: 1, qty: 1 }], "MES"), [T1]);
  assert.equal(sanitizePartialTargets("nope", "MES"), undefined);
});

test("malformed optional partial-exit fields fail closed instead of disappearing", () => {
  const malformed = { ...EXIT_T1, reason: 42 };
  assert.equal(sanitizePartialExits([malformed], "MES"), undefined);
  assert.match(validateTradePartials({ partial_exits: [malformed] }, fixtureSeven()) ?? "", /partial exit/i);
});

test("the TradeDocument guard validates partial annotation shapes", () => {
  const doc = fromLegacy(fixtureSeven());
  assert.equal(isTradeDocument(doc), true);
  assert.equal(isTradeDocument({ ...doc, annotations: { ...doc.annotations, partial_exits: [{}] } }), false);
  assert.equal(isTradeDocument({ ...doc, annotations: { ...doc.annotations, partial_targets: [{}] } }), false);
});

test("validateTradePartials: a valid fixture 7 passes, and each broken rule names itself", () => {
  const trade = fixtureSeven();
  assert.equal(validateTradePartials({ partial_exits: [EXIT_T1, EXIT_T2], partial_targets: [T1, T2] }, trade), null);
  assert.match(validateTradePartials({ partial_exits: "x" }, trade) ?? "", /partial exit/i);
  assert.match(validateTradePartials({ partial_targets: [{ key: "t1", price: 7605, qty: 0 }] }, trade) ?? "", /partial target/i);
  const offTick = fixtureSeven({ partial_exits: [{ ...EXIT_T1, price: 7605.1 }, EXIT_T2] });
  assert.match(validateTradePartials({}, offTick) ?? "", /tick grid/);
  const wrongSide = fixtureSeven({ partial_targets: [{ key: "t1", price: 7595, qty: 1 }, T2] });
  assert.match(validateTradePartials({}, wrongSide) ?? "", /reward side/);
  const overQty = fixtureSeven({ partial_exits: [EXIT_T1, EXIT_T2, { ...EXIT_T2, qty: 1 }] });
  assert.match(validateTradePartials({}, overQty) ?? "", /more than the trade quantity/);
  const shortClose = fixtureSeven({ partial_exits: [EXIT_T1] });
  assert.match(validateTradePartials({}, shortClose) ?? "", /full quantity/);
});

// In-memory journal repositories (same contract shape as journal-commands.test.ts).
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 26, 12, 0, clock++)).toISOString();
const clone = <T,>(value: T): T => structuredClone(value);
const missing = { ok: false as const, error: { code: "not_found" as const, message: "Not found." } };
function memoryCollection<T extends { id: string }>(): CollectionRepository<T> {
  const rows = new Map<string, Stored<T>>();
  const keyOf = (owner: string, id: string) => `${owner}\u0000${id}`;
  return {
    async list(owner) {
      return { ok: true, value: [...rows.values()].filter((r) => r.meta.user_id === owner).map((r) => clone(r.record)) };
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
      const at = stamp();
      const stored: Stored<T> = { record: clone(value), meta: { user_id: owner, created_at: at, updated_at: at } };
      rows.set(owner, stored);
      return { ok: true as const, value: clone(stored) };
    },
  };
}
function memoryRepos() {
  const repos = {
    trades: memoryCollection(), mood_records: memoryCollection(), mood_candidates: memoryCollection(), accounts: memoryCollection(),
    balance_checks: memoryCollection(), challenges: memoryCollection(), playbooks: memoryCollection(), plans: memoryCollection(),
    drills: memoryCollection(), calls: memoryCollection(), prompt_dismissals: memoryCollection(), daily_reviews: memoryCollection(),
    prefs: memorySingleton(), mood_registry: memorySingleton(), tag_registry: memorySingleton(), prompt_library: memorySingleton(),
    candles: { async get() { return { ok: true as const, value: null }; }, async put() { return { ok: true as const, value: undefined }; } },
  };
  return repos as unknown as JournalRepositories;
}

const raw = (over: Record<string, unknown> = {}) => ({ ...fixtureSeven(), ...over });

test("journal-commands accepts valid partials on create and update", async () => {
  const commands = createJournalCommands(memoryRepos());
  const created = await commands.create("trades", raw());
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.deepEqual(created.value.record.partial_exits?.map((e) => e.price), [7605, 7612.5]);
  const updated = await commands.update("trades", "ex-partials", { partial_targets: [T1, T2] });
  assert.equal(updated.ok, true);
});

test("journal-commands refuses off-tick prices, wrong-side targets, excess quantity and malformed lists with invalid", async () => {
  const commands = createJournalCommands(memoryRepos());
  const cases: Array<[string, Record<string, unknown>]> = [
    ["off-tick exit", { partial_exits: [{ ...EXIT_T1, price: 7605.1 }, EXIT_T2] }],
    ["wrong-side target", { partial_targets: [{ key: "t1", price: 7595, qty: 1 }, T2] }],
    ["sum above quantity", { partial_exits: [EXIT_T1, EXIT_T2, EXIT_T2] }],
    ["non-array exits", { partial_exits: "nope" }],
  ];
  for (const [name, over] of cases) {
    const result = await commands.create("trades", raw(over));
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.error.code, "invalid", name);
  }
});

test("buildBackup and parseBackupFile round-trip partial_exits and partial_targets losslessly", () => {
  const trade = fixtureSeven();
  const parsed = parseBackupFile(JSON.stringify(buildBackup([trade])));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.trades[0].partial_exits, trade.partial_exits);
  assert.deepEqual(parsed.trades[0].partial_targets, trade.partial_targets);
});
