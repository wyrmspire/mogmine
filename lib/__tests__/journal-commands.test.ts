import test from "node:test";
import assert from "node:assert/strict";
import { createJournalCommands } from "../commands/journal-commands.ts";
import type { CollectionRepository, JournalRepositories, Stored } from "../persistence/contract.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";

// An in-memory stand-in for the contract (#175 owns the real local adapter). Rows are keyed by owner and id;
// `parentId` matches the `trade_id` column, which is the only parent link the cascade test needs.
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 23, 12, 0, clock++)).toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const missing = { ok: false as const, error: { code: "not_found" as const, message: "Not found." } };

function memoryCollection<T extends { id: string }>(): CollectionRepository<T> {
  const rows = new Map<string, Stored<T>>();
  const keyOf = (owner: string, id: string) => `${owner}\u0000${id}`;
  return {
    async list(owner, query = {}) {
      const values = [...rows.values()]
        .filter((row) => row.meta.user_id === owner)
        .filter((row) => query.parentId === undefined || (row.record as { trade_id?: unknown }).trade_id === query.parentId)
        .map((row) => clone(row.record));
      return { ok: true, value: values };
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
    drills: memoryCollection(), calls: memoryCollection(), prompt_dismissals: memoryCollection(), daily_reviews: memoryCollection(),
    prefs: memorySingleton(), mood_registry: memorySingleton(), prompt_library: memorySingleton(),
    candles: { async get() { return { ok: true as const, value: null }; }, async put() { return { ok: true as const, value: undefined }; } },
  };
  return repos as unknown as JournalRepositories;
}

const trade = (over: Record<string, unknown> = {}) => ({
  id: "t-1", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-20T15:00:00Z", exit_time: "2026-11-20T15:30:00Z",
  entry_price: 7600.25, exit_price: 7602.25, stop_loss_price: 7598.25,
  ...over,
});

test("creates a trade, reads it back with its stop moves, and lists it", async () => {
  const commands = createJournalCommands(memoryRepos());
  const stopMoves = [{ price: 7600.25, time: "2026-11-20T15:10:00Z" }];
  const created = await commands.create("trades", trade({ stop_moves: stopMoves, stop_loss_price: 7600.25 }));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.record.user_id, DEFAULT_OWNER_USER_ID);
  assert.deepEqual(created.value.record.stop_moves, stopMoves);

  const read = await commands.read("trades", "t-1");
  assert.equal(read.ok && read.value.record.entry_price, 7600.25);
  const listed = await commands.list("trades");
  assert.equal(listed.ok && listed.value.length, 1);
});

test("a trade with a malformed stop move is rejected and nothing is written", async () => {
  const commands = createJournalCommands(memoryRepos());
  const result = await commands.create("trades", trade({ stop_moves: [{ price: "7600", time: "2026-11-20T15:10:00Z" }] }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid");
  assert.match(result.error.message, /stop move/);
  const listed = await commands.list("trades");
  assert.equal(listed.ok && listed.value.length, 0);
});

test("money rules fail closed: a long stop above entry and an off-tick entry are invalid", async () => {
  const commands = createJournalCommands(memoryRepos());
  const aboveEntry = await commands.create("trades", trade({ stop_loss_price: 7601 }));
  assert.equal(aboveEntry.ok, false);
  assert.match(aboveEntry.ok ? "" : aboveEntry.error.message, /stop sits below the entry/);

  const offTick = await commands.create("trades", trade({ entry_price: 7600.3 }));
  assert.equal(offTick.ok, false);
  assert.match(offTick.ok ? "" : offTick.error.message, /tick/);

  const badDirection = await commands.create("trades", trade({ direction: "SIDEWAYS" }));
  assert.equal(!badDirection.ok && badDirection.error.code, "invalid");
});

test("a working stop may lock profit, but initial and moved stops stay tick-valid", async () => {
  const commands = createJournalCommands(memoryRepos());
  const locked = await commands.create("trades", trade({
    initial_stop_price: 7598.25,
    initial_stop_set_at: "2026-11-20T15:00:00Z",
    stop_loss_price: 7601.25,
    stop_moves: [{ price: 7601.25, time: "2026-11-20T15:10:00Z" }],
  }));
  assert.equal(locked.ok, true);

  const offTickMove = await commands.create("trades", trade({
    id: "t-2",
    stop_moves: [{ price: 7601.3, time: "2026-11-20T15:10:00Z" }],
  }));
  assert.equal(!offTickMove.ok && offTickMove.error.code, "invalid");
});

test("derived fields are forbidden on create and update", async () => {
  const commands = createJournalCommands(memoryRepos());
  const created = await commands.create("trades", trade({ net_pnl: 40 }));
  assert.equal(!created.ok && created.error.code, "forbidden");
  const afterCreate = await commands.list("trades");
  assert.equal(afterCreate.ok && afterCreate.value.length, 0);

  await commands.create("trades", trade());
  const updated = await commands.update("trades", "t-1", { r_multiple: 2 });
  assert.equal(!updated.ok && updated.error.code, "forbidden");
});

test("update re-validates the whole record and keeps the stored one when the patch is bad", async () => {
  const commands = createJournalCommands(memoryRepos());
  await commands.create("trades", trade());
  const ok = await commands.update("trades", "t-1", { note: "Took it early" });
  assert.equal(ok.ok && ok.value.record.note, "Took it early");

  const bad = await commands.update("trades", "t-1", { stop_moves: [{ price: Number.NaN, time: "nope" }] });
  assert.equal(bad.ok, false);
  const stored = await commands.read("trades", "t-1");
  assert.equal(stored.ok && stored.value.record.note, "Took it early");
  assert.deepEqual(stored.ok && stored.value.record.stop_moves, undefined);
});

test("creating an id that already exists conflicts; reading a missing id is not_found", async () => {
  const commands = createJournalCommands(memoryRepos());
  await commands.create("trades", trade());
  const again = await commands.create("trades", trade());
  assert.equal(!again.ok && again.error.code, "conflict");
  const missingRead = await commands.read("trades", "nope");
  assert.equal(!missingRead.ok && missingRead.error.code, "not_found");
});

test("a record carrying another owner's user_id is forbidden", async () => {
  const commands = createJournalCommands(memoryRepos(), "auth-user-1");
  const result = await commands.create("trades", trade({ user_id: "someone-else" }));
  assert.equal(!result.ok && result.error.code, "forbidden");
  const device = await commands.create("trades", trade({ user_id: DEFAULT_OWNER_USER_ID }));
  assert.equal(device.ok && device.value.record.user_id, "auth-user-1");
});

test("accounts take whole cents only, archive instead of delete", async () => {
  const commands = createJournalCommands(memoryRepos());
  const account = { id: "acc-1", name: "Eval 50K", starting_balance_cents: 5_000_000, rules: {}, created_at: "2026-11-20T00:00:00Z", archived: false };
  const fractional = await commands.create("accounts", { ...account, starting_balance_cents: 25000.5 });
  assert.equal(!fractional.ok && fractional.error.code, "invalid");

  const created = await commands.create("accounts", account);
  assert.equal(created.ok, true);
  assert.equal((await commands.remove("accounts", "acc-1")).ok, false);
  const archived = await commands.archive("accounts", "acc-1");
  assert.equal(archived.ok && archived.value.record.archived, true);
});

test("playbooks need a name, and the impulse bucket cannot be archived", async () => {
  const commands = createJournalCommands(memoryRepos());
  const nameless = await commands.create("playbooks", { id: "orb", name: "   ", default_style: "scalp", checklist_rules: [], archived: false });
  assert.equal(!nameless.ok && nameless.error.code, "invalid");

  await commands.create("playbooks", { id: "no-setup", name: "No setup", default_style: "scalp", checklist_rules: [], archived: false });
  const before = await commands.read("playbooks", "no-setup");
  const archived = await commands.archive("playbooks", "no-setup");
  assert.equal(!archived.ok && archived.error.code, "invalid");
  const after = await commands.read("playbooks", "no-setup");
  assert.equal(before.ok && after.ok && after.value.meta.updated_at, before.ok ? before.value.meta.updated_at : "");
  assert.equal(after.ok && after.value.record.archived, false);
});

test("calls must match their kind: a flip without a signal direction is invalid", async () => {
  const commands = createJournalCommands(memoryRepos());
  const flip = await commands.create("calls", { id: "c-1", kind: "flip", made_at: "2026-11-20T15:00:00Z", recorded_at: "2026-11-20T15:01:00Z", trade_id: "t-1" });
  assert.equal(!flip.ok && flip.error.code, "invalid");
  const cut = await commands.create("calls", { id: "c-2", kind: "cut", made_at: "2026-11-20T15:00:00Z", recorded_at: "2026-11-20T15:01:00Z", trade_id: "t-1" });
  assert.equal(cut.ok, true);

  const halfPrice = await commands.create("calls", { id: "c-3", kind: "cut", made_at: "2026-11-20T15:00:00Z", recorded_at: "2026-11-20T15:01:00Z", trade_id: "t-1", price: 7600.25 });
  assert.equal(!halfPrice.ok && halfPrice.error.code, "invalid");
});

test("plans need a session date", async () => {
  const commands = createJournalCommands(memoryRepos());
  const result = await commands.create("plans", { id: "p-1", name: "Open plan" });
  assert.equal(!result.ok && result.error.code, "invalid");

  const badLevel = await commands.create("plans", {
    id: "p-2", name: "Open plan", session_date: "2026-11-20",
    levels: [{ id: "l-1", label: "Shelf", price: 7600.25, price_ticks: 1.5 }], revisions: [],
  });
  assert.equal(!badLevel.ok && badLevel.error.code, "invalid");
});

test("removing a trade removes its cascade children first", async () => {
  const commands = createJournalCommands(memoryRepos());
  await commands.create("trades", trade());
  const drill = { id: "d-1", trade_id: "t-1", kind: "take_it", answer: "take", answered_at: "2026-11-20T16:00:00Z", hidden: [] };
  assert.equal((await commands.create("drills", drill)).ok, true);
  assert.equal((await commands.remove("trades", "t-1")).ok, true);
  assert.equal((await commands.read("drills", "d-1")).ok, false);
  assert.equal((await commands.read("trades", "t-1")).ok, false);
});

test("singletons: null before the first write, then sanitized; a bad prompt library is invalid", async () => {
  const commands = createJournalCommands(memoryRepos());
  const before = await commands.readSingleton("prefs");
  assert.equal(before.ok && before.value, null);

  const written = await commands.writeSingleton("prefs", { shield: true, goldPreset: "not-a-preset" });
  assert.equal(written.ok && written.value.record.shield, true);
  assert.equal(written.ok && written.value.record.goldPreset, "bullion");

  const badRisk = await commands.writeSingleton("prefs", { riskBudgetUsd: Number.NaN });
  assert.equal(!badRisk.ok && badRisk.error.code, "invalid");

  const library = await commands.writeSingleton("prompt_library", { schema: "something-else", prompts: [] } as unknown);
  assert.equal(!library.ok && library.error.code, "invalid");
});

test("a stop move before entry or after exit is invalid (05 §3.1)", async () => {
  const commands = createJournalCommands(memoryRepos());
  const early = await commands.create("trades", trade({ stop_moves: [{ price: 7598.25, time: "2026-11-20T14:59:00Z" }], stop_loss_price: 7598.25 }));
  assert.equal(early.ok, false);
  assert.equal(early.ok ? "" : early.error.code, "invalid");
  assert.equal(early.ok ? "" : early.error.message, "A stop move must fall between entry and exit.");

  const late = await commands.create("trades", trade({ id: "t-late", stop_moves: [{ price: 7598.25, time: "2026-11-20T15:31:00Z" }], stop_loss_price: 7598.25 }));
  assert.equal(late.ok, false);
  assert.equal(late.ok ? "" : late.error.message, "A stop move must fall between entry and exit.");
});

test("the working stop must equal the last stop move (05 §3.1)", async () => {
  const commands = createJournalCommands(memoryRepos());
  const mismatch = await commands.create("trades", trade({
    entry_price: 7255, exit_price: 7258, stop_loss_price: 7250,
    stop_moves: [{ price: 7260, time: "2026-11-20T15:10:00Z" }],
  }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.ok ? "" : mismatch.error.code, "invalid");
  assert.equal(mismatch.ok ? "" : mismatch.error.message, "The working stop must equal the last stop move (7260.00).");
});

test("two stop moves at the same minute keep input order, so the later one in the input is the working stop", async () => {
  const commands = createJournalCommands(memoryRepos());
  const moves = [
    { price: 7601.25, time: "2026-11-20T15:10:00Z" },
    { price: 7601.5, time: "2026-11-20T15:10:00Z" },
  ];
  const kept = await commands.create("trades", trade({ stop_moves: moves, stop_loss_price: 7601.5 }));
  assert.equal(kept.ok, true);
  assert.deepEqual(kept.ok && kept.value.record.stop_moves, moves);

  const reversed = await commands.create("trades", trade({
    id: "t-rev",
    stop_moves: [moves[1], moves[0]],
    stop_loss_price: 7601.5,
  }));
  assert.equal(reversed.ok, false);
  assert.equal(reversed.ok ? "" : reversed.error.message, "The working stop must equal the last stop move (7601.25).");
});

test("an initial stop sent without its set time defaults the time to entry (02 §2.6)", async () => {
  const commands = createJournalCommands(memoryRepos());
  const created = await commands.create("trades", trade({ initial_stop_price: 7598.25 }));
  assert.equal(created.ok, true);
  assert.equal(created.ok && created.value.record.initial_stop_set_at, "2026-11-20T15:00:00Z");
});

test("a set time without an initial stop price is still refused", async () => {
  const commands = createJournalCommands(memoryRepos());
  const result = await commands.create("trades", trade({ initial_stop_set_at: "2026-11-20T15:05:00Z" }));
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.error.message, "Initial stop price and set time go together.");
});
