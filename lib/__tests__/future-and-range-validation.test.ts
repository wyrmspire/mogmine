// UX-09 (02 §2.3): a future-dated trade time is refused (422 invalid); a far-off price only warns and never blocks a save.
import test from "node:test";
import assert from "node:assert/strict";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { FUTURE_ALLOWANCE_MS, checkPriceAgainstDayRange, validateFutureTimes } from "../entry-form.ts";
import type { CollectionRepository, JournalRepositories, Stored } from "../persistence/contract.ts";

// Clock fixed so the tests are deterministic (createJournalCommands takes an injectable `now`).
const NOW_ISO = "2026-11-24T15:00:00Z";
const NOW_MS = Date.parse(NOW_ISO);
const minutesAfterNow = (minutes: number) => new Date(NOW_MS + minutes * 60_000).toISOString();
const missing = { ok: false as const, error: { code: "not_found" as const, message: "Not found." } };

// In-memory collections, enough for the trades and accounts/prefs reads the command layer makes.
function memoryCollection<T extends { id: string }>(): CollectionRepository<T> {
  const rows = new Map<string, Stored<T>>();
  const keyOf = (owner: string, id: string) => `${owner}\u0000${id}`;
  return {
    async list(owner) {
      return { ok: true, value: [...rows.values()].filter((row) => row.meta.user_id === owner).map((row) => structuredClone(row.record)) };
    },
    async get(owner, id) {
      const row = rows.get(keyOf(owner, id));
      return row ? { ok: true, value: structuredClone(row) } : missing;
    },
    async put(owner, record) {
      const stamp = new Date(NOW_MS).toISOString();
      const stored: Stored<T> = { record: structuredClone(record), meta: { user_id: owner, created_at: stamp, updated_at: stamp } };
      rows.set(keyOf(owner, record.id), stored);
      return { ok: true, value: structuredClone(stored) };
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
  return {
    async get() {
      return { ok: true as const, value: null };
    },
    async put(owner: string, value: T) {
      const stamp = new Date(NOW_MS).toISOString();
      return { ok: true as const, value: { record: structuredClone(value), meta: { user_id: owner, created_at: stamp, updated_at: stamp } } };
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
const commandsAtNow = (repos = memoryRepos()) => createJournalCommands(repos, undefined, { now: () => NOW_MS });

// A valid past closed MES long. Times are overridable per test.
const closedTrade = (over: Record<string, unknown> = {}) => ({
  id: "t-future", symbol: "MES", direction: "LONG", quantity: 1, status: "closed",
  entry_time: "2026-11-20T15:00:00Z", exit_time: "2026-11-20T15:30:00Z",
  entry_price: 7600.25, exit_price: 7602.25, stop_loss_price: 7598.25,
  ...over,
});
const openTrade = (over: Record<string, unknown> = {}) => closedTrade({ status: "open", exit_time: null, exit_price: null, ...over });

test("an entry dated tomorrow is refused by validateFutureTimes and rejected as invalid on create and update", async () => {
  const tomorrow = "2026-11-25T15:10:00Z";
  assert.match(validateFutureTimes(Date.parse(tomorrow), null, NOW_MS).entry ?? "", /^This entry is in the future \(.+\)\. Check the date\.$/);

  const commands = commandsAtNow();
  const created = await commands.create("trades", openTrade({ entry_time: tomorrow }));
  assert.equal(!created.ok && created.error.code, "invalid");
  assert.match(!created.ok ? created.error.message : "", /This entry is in the future .*Check the date\./);

  // An existing past trade cannot be moved into the future either.
  assert.equal((await commands.create("trades", openTrade())).ok, true);
  const moved = await commands.update("trades", "t-future", { entry_time: tomorrow });
  assert.equal(!moved.ok && moved.error.code, "invalid");
});

test("the 5-minute clock allowance: an entry at now + 4 min is allowed, now + 6 min is refused", async () => {
  assert.equal(FUTURE_ALLOWANCE_MS, 5 * 60_000);
  const commands = commandsAtNow();
  assert.equal((await commands.create("trades", openTrade({ entry_time: minutesAfterNow(4) }))).ok, true);
  const refused = await commands.create("trades", openTrade({ id: "t-6", entry_time: minutesAfterNow(6) }));
  assert.equal(!refused.ok && refused.error.code, "invalid");
  assert.equal(validateFutureTimes(NOW_MS + 4 * 60_000, null, NOW_MS).entry, undefined);
  assert.notEqual(validateFutureTimes(NOW_MS + 6 * 60_000, null, NOW_MS).entry, undefined);
});

test("a closed trade with a future exit (now + 10 min) is refused; an open trade one minute ahead is allowed", async () => {
  assert.match(validateFutureTimes(Date.parse("2026-11-20T15:00:00Z"), NOW_MS + 10 * 60_000, NOW_MS).exit ?? "", /This exit is in the future/);
  const commands = commandsAtNow();
  const closedFuture = await commands.create("trades", closedTrade({ exit_time: minutesAfterNow(10) }));
  assert.equal(!closedFuture.ok && closedFuture.error.code, "invalid");
  const openSoon = await commands.create("trades", openTrade({ entry_time: minutesAfterNow(1) }));
  assert.equal(openSoon.ok, true);
});

test("a typed price far off the day's bars warns only: a past-dated trade at 4866.25 still saves", async () => {
  const dayBars = [{ low: 6935, high: 7410 }];
  assert.equal(checkPriceAgainstDayRange(4866.25, "MES", dayBars), "4866.25 is far from where MES traded that day (6935.00–7410.00). Typo?");

  const commands = commandsAtNow();
  const saved = await commands.create("trades", closedTrade({ id: "t-typo", entry_price: 4866.25, exit_price: 4867.25, stop_loss_price: 4865.25 }));
  assert.equal(saved.ok, true, "a far-off price is a warning, never a block (Q-10)");
});

test("a price 0.5% outside the day's range is not flagged; an empty day or a missing price is not flagged", () => {
  const dayBars = [{ low: 6935, high: 7410 }];
  assert.equal(checkPriceAgainstDayRange(6900, "MES", dayBars), null);
  assert.equal(checkPriceAgainstDayRange(4866.25, "MES", []), null);
  assert.equal(checkPriceAgainstDayRange(null, "MES", dayBars), null);
});
